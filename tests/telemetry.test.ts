import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../apps/server/src/app';
import { BambuCloudAdapter } from '../packages/printer-adapters/src';
import { parseTelemetry } from '../packages/printer-adapters/src/telemetry';

const snapshot = {
  command: 'push_status',
  gcode_state: 'RUNNING',
  mc_percent: 24,
  mc_remaining_time: 43,
  layer_num: 30,
  total_layer_num: 160,
  nozzle_temper: 225,
  bed_temper: 50,
  device: {
    extruder: {
      info: [
        { id: 1, temp: (225 << 16) + 221 },
        { id: 0, temp: 20 },
      ],
    },
    bed: { info: { temp: (60 << 16) + 57 } },
    ctc: { info: { temp: 28 } },
  },
};
afterEach(() => vi.restoreAllMocks());
it('keeps dual nozzle channels separate and decodes zero targets, bed, chamber and progress', () => {
  const result = parseTelemetry(snapshot, 'X2D')!;
  expect(result).toMatchObject({
    state: 'RUNNING',
    progress: 24,
    remainingMinutes: 43,
    layer: 30,
    layers: 160,
    temperatures: [
      { name: '喷嘴 0', current: 20, target: 0 },
      { name: '喷嘴 1', current: 221, target: 225 },
      { name: '热床', current: 57, target: 60 },
      { name: '腔体', current: 28, target: 0 },
    ],
  });
  expect(parseTelemetry({ ...snapshot, msg: 1 }, 'X2D')).toBeNull();
  const partial = parseTelemetry({ ...snapshot, device: undefined, mc_remaining_time: -1 }, 'X2D')!;
  expect(partial.remainingMinutes).toBeNull();
  expect(partial.temperatures).toEqual([{ name: '热床', current: 50, target: null }]);
  expect(parseTelemetry({ ...snapshot, device: undefined }, 'A1 mini')!.temperatures[0]).toEqual({
    name: '喷嘴',
    current: 225,
    target: null,
  });
});
it('gates reads on cloud integration and shares snapshots for simultaneous callers', async () => {
  const { app, store } = createApp({
    databasePath: ':memory:',
    experimental: true,
    bambuToken: 'fixture',
  });
  try {
    const p = store.addPrinter({ model: 'X2D', serial: 'fixture', name: 'test' });
    const lookup = () => app.inject('/api/printers/' + p.id + '/telemetry');
    const read = vi
      .spyOn(BambuCloudAdapter.prototype, 'telemetry')
      .mockResolvedValue(parseTelemetry(snapshot, 'X2D')!);
    expect((await lookup()).statusCode).toBe(409);
    await app.inject({
      method: 'POST',
      url: '/api/integration/enable',
      payload: { acknowledgeExperimental: true },
    });
    const [one, two] = await Promise.all([lookup(), lookup()]);
    expect(one.statusCode).toBe(200);
    expect(two.json()).toEqual(one.json());
    expect(read).toHaveBeenCalledTimes(1);
    await app.inject({ method: 'POST', url: '/api/integration/disconnect' });
    expect((await lookup()).statusCode).toBe(409);
  } finally {
    await app.close();
  }
});
