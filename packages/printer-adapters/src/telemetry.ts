import { connect } from 'node:tls';
import { randomUUID } from 'node:crypto';
import mqtt from 'mqtt-packet';
import { z } from 'zod';
import type {
  Ams2ProTelemetry,
  FeederTelemetry,
  PrinterTelemetry,
  PrinterTemperature,
} from '../../shared/src';

mqtt.writeToStream.cacheNumbers = false;

const packed = z.number().int().min(0).max(0xffffffff);
const temperatureBlock = z.object({ info: z.object({ temp: packed.optional() }).optional() });
const amsTray = z.object({
  id: z.unknown(),
  tray_type: z.string().trim().min(1).max(32).optional().catch(undefined),
  tray_color: z
    .string()
    .regex(/^[0-9a-f]{6}(?:[0-9a-f]{2})?$/i)
    .optional()
    .catch(undefined),
});
const amsUnit = z.object({
  id: z.unknown(),
  info: z
    .string()
    .regex(/^[0-9a-f]{1,12}$/i)
    .optional(),
  temp: z.unknown().optional(),
  humidity_raw: z.unknown().optional(),
  dry_time: z.unknown().optional(),
  tray: z.array(z.unknown()).max(16).optional().catch(undefined),
});
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
  ams: z
    .object({
      ams: z.array(z.unknown()).max(16),
      tray_exist_bits: z
        .string()
        .regex(/^[0-9a-f]{1,16}$/i)
        .optional()
        .catch(undefined),
    })
    .optional()
    .catch(undefined),
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

function readNumber(raw: unknown, min: number, max: number) {
  const value = typeof raw === 'string' && /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : raw;
  return typeof value === 'number' && value >= min && value <= max ? value : null;
}

function parseFeeders(ams: z.infer<typeof snapshot>['ams'], model: string) {
  if (!ams) return;
  const occupiedBits =
    ams.tray_exist_bits === undefined ? null : BigInt('0x' + ams.tray_exist_bits);
  const ams2Pro = new Map<number, Ams2ProTelemetry>();
  const bmcu = new Map<number, FeederTelemetry>();
  for (const entry of ams.ams) {
    const parsed = amsUnit.safeParse(entry);
    if (!parsed.success) continue;
    const unit = parsed.data;
    const id = readNumber(unit.id, 0, 15);
    if (id === null || !Number.isInteger(id)) continue;
    // Bambu Studio's DevFilaSystem uses the low nibble for AMS type and the next for drying.
    const info = unit.info === undefined ? null : Number.parseInt(unit.info, 16);
    const isAms2Pro = model === 'X2D' && info !== null && (info & 0xf) === 3;
    // The configured A1 mini has a BMCU reporting through the AMS Lite protocol.
    const isBmcu = model === 'A1 mini' && (info === null || (info & 0xf) === 2);
    if (!isAms2Pro && !isBmcu) continue;
    const trays = new Map<number, z.infer<typeof amsTray>>();
    for (const entry of unit.tray ?? []) {
      const tray = amsTray.safeParse(entry);
      if (!tray.success) continue;
      const index = readNumber(tray.data.id, 0, 3);
      if (index !== null && Number.isInteger(index)) trays.set(index, tray.data);
    }
    const slots = Array.from({ length: 4 }, (_, index) => {
      const tray = trays.get(index);
      const occupied =
        occupiedBits === null ? null : (occupiedBits & (1n << BigInt(id * 4 + index))) !== 0n;
      return {
        number: index + 1,
        occupied,
        material: occupied === false ? null : (tray?.tray_type ?? null),
        colorHex: occupied !== false && tray?.tray_color ? '#' + tray.tray_color.slice(0, 6) : null,
      };
    });
    if (isAms2Pro) {
      ams2Pro.set(id, {
        id,
        slots,
        temperature: readNumber(unit.temp, -40, 100),
        humidityPercent: readNumber(unit.humidity_raw, 0, 100),
        dryingStatus: (info >> 4) & 0xf,
        dryingMinutes: readNumber(unit.dry_time, 0, 1440),
      });
    } else bmcu.set(id, { id, slots });
  }
  return model === 'X2D'
    ? { ams2Pro: [...ams2Pro.values()].sort((left, right) => left.id - right.id) }
    : { bmcu: [...bmcu.values()].sort((left, right) => left.id - right.id) };
}

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
    const extruders = p.device?.extruder?.info;
    add('左喷嘴', extruders?.find((extruder) => extruder.id === 1)?.temp);
    add('右喷嘴', extruders?.find((extruder) => extruder.id === 0)?.temp);
  } else add('喷嘴', undefined, p.nozzle_temper, p.nozzle_target_temper);
  add('热床', p.device?.bed?.info?.temp, p.bed_temper, p.bed_target_temper);
  if (model !== 'A1 mini')
    add(model === 'X2D' ? '仓温' : '腔体', p.device?.ctc?.info?.temp, p.chamber_temper);
  if (!temperatures.length) return null;
  return {
    reportedAt: new Date().toISOString(),
    state: p.gcode_state,
    progress: p.mc_percent ?? null,
    remainingMinutes: p.mc_remaining_time ?? null,
    layer: p.layer_num ?? null,
    layers: p.total_layer_num ?? null,
    temperatures,
    ...(model === 'X2D' || model === 'A1 mini' ? parseFeeders(p.ams, model) : undefined),
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
