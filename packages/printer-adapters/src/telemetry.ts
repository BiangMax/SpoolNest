import { connect } from 'node:tls';
import { randomUUID } from 'node:crypto';
import mqtt from 'mqtt-packet';
import { z } from 'zod';
import type { PrinterTelemetry, PrinterTemperature } from '../../shared/src';

mqtt.writeToStream.cacheNumbers = false;

const packed = z.number().int().min(0).max(0xffffffff);
const temperatureBlock = z.object({ info: z.object({ temp: packed.optional() }).optional() });
const snapshot = z.object({
  command: z.literal('push_status'),
  msg: z.literal(0).optional(),
  gcode_state: z.string().min(1).max(32),
  mc_percent: z.number().min(0).max(100).nullish().catch(null),
  mc_remaining_time: z.number().nonnegative().nullish().catch(null),
  layer_num: z.number().int().nonnegative().nullish().catch(null),
  total_layer_num: z.number().int().nonnegative().nullish().catch(null),
  nozzle_temper: z.number().optional(),
  nozzle_target_temper: z.number().optional(),
  bed_temper: z.number().optional(),
  bed_target_temper: z.number().optional(),
  chamber_temper: z.number().optional(),
  device: z
    .object({
      extruder: z
        .object({
          info: z.array(z.object({ id: z.number().int(), temp: packed.optional() })).optional(),
        })
        .optional(),
      bed: temperatureBlock.optional(),
      ctc: temperatureBlock.optional(),
    })
    .optional(),
});
export function parseTelemetry(raw: unknown, model: string): PrinterTelemetry | null {
  const result = snapshot.safeParse(raw);
  if (!result.success) return null;
  const p = result.data;
  const temperatures: PrinterTemperature[] = [];
  function add(name: string, word?: number, actual?: number, goal?: number) {
    const valid = (v?: number) => (v !== undefined && v >= -40 && v <= 500 ? v : null);
    const current = valid(word === undefined ? actual : word & 0xffff);
    const target = valid(word === undefined ? goal : word >>> 16);
    if (current !== null || target !== null) temperatures.push({ name, current, target });
  }
  if (model === 'X2D') {
    for (const id of [0, 1])
      add('喷嘴 ' + id, p.device?.extruder?.info?.find((e) => e.id === id)?.temp);
  } else add('喷嘴', undefined, p.nozzle_temper, p.nozzle_target_temper);
  add('热床', p.device?.bed?.info?.temp, p.bed_temper, p.bed_target_temper);
  add('腔体', p.device?.ctc?.info?.temp, p.chamber_temper);
  if (!temperatures.length) return null;
  return {
    reportedAt: new Date().toISOString(),
    state: p.gcode_state,
    progress: p.mc_percent ?? null,
    remainingMinutes: p.mc_remaining_time ?? null,
    layer: p.layer_num ?? null,
    layers: p.total_layer_num ?? null,
    temperatures,
  };
}

// A bounded MQTT 3.1.1 session works inside one Worker request as well as on Node.
// Subscribe first, then ask for a fresh full report; ignore retained and partial messages.
export function readTelemetry(
  host: string,
  username: string,
  token: string,
  serial: string,
  model: string,
) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(serial)) throw new Error('设备标识无效');
  return new Promise<PrinterTelemetry>((resolve, reject) => {
    const socket = connect({ host, port: 8883, servername: host, rejectUnauthorized: true });
    const parser = mqtt.parser();
    const topic = 'device/' + serial + '/report';
    let requested = false,
      done = false,
      received = 0;
    function finish(value?: PrinterTelemetry) {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      socket.destroy();
      if (value) resolve(value);
      else reject(new Error('未收到设备状态快照'));
    }
    const timeout = setTimeout(() => finish(), 12_000);
    const send = (packet: mqtt.Packet) => socket.write(mqtt.generate(packet));
    socket.once('secureConnect', () =>
      send({
        cmd: 'connect',
        protocolId: 'MQTT',
        protocolVersion: 4,
        clean: true,
        keepalive: 30,
        clientId: 'spool-' + randomUUID().slice(0, 16),
        username,
        password: Buffer.from(token),
      }),
    );
    socket.on('data', (chunk) => {
      received += chunk.length;
      if (received > 2_000_000) return finish();
      try {
        parser.parse(chunk);
      } catch {
        finish();
      }
    });
    parser.on('packet', (packet: mqtt.Packet) => {
      if (done) return;
      if (packet.cmd === 'connack') {
        if (packet.returnCode !== 0) return finish();
        send({ cmd: 'subscribe', messageId: 1, subscriptions: [{ topic, qos: 0 }] });
      } else if (packet.cmd === 'suback') {
        if (packet.messageId !== 1 || packet.granted[0] !== 0) return finish();
        requested = true;
        send({
          cmd: 'publish',
          qos: 0,
          retain: false,
          dup: false,
          topic: 'device/' + serial + '/request',
          payload: JSON.stringify({ pushing: { sequence_id: '0', command: 'pushall' } }),
        });
      } else if (
        requested &&
        packet.cmd === 'publish' &&
        packet.topic === topic &&
        !packet.retain
      ) {
        const value = parseTelemetry(JSON.parse(packet.payload.toString())?.print, model);
        if (value) finish(value);
      }
    });
    parser.on('error', () => finish());
    socket.once('error', () => finish());
    socket.once('close', () => finish());
  });
}
