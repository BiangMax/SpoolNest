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
        { id: 0, temp: 20 },
        { id: 1, temp: (225 << 16) + 221 },
      ],
    },
    bed: { info: { temp: (60 << 16) + 57 } },
    ctc: { info: { temp: 28 } },
  },
};
afterEach(() => vi.restoreAllMocks());
it('maps X2D nozzle channels left to right and decodes zero targets, bed, chamber and progress', () => {
  const result = parseTelemetry(snapshot, 'X2D')!;
  expect(result).toMatchObject({
    state: 'RUNNING',
    progress: 24,
    remainingMinutes: 43,
    layer: 30,
    layers: 160,
    temperatures: [
      { name: '左喷嘴', current: 221, target: 225 },
      { name: '右喷嘴', current: 20, target: 0 },
      { name: '热床', current: 57, target: 60 },
      { name: '仓温', current: 28, target: 0 },
    ],
  });
  expect(parseTelemetry({ ...snapshot, msg: 1 }, 'X2D')).toBeNull();
  const partial = parseTelemetry({ ...snapshot, device: undefined, mc_remaining_time: -1 }, 'X2D')!;
  expect(partial.remainingMinutes).toBeNull();
  expect(partial.temperatures).toEqual([{ name: '热床', current: 50, target: null }]);
  expect(
    parseTelemetry({ ...snapshot, device: undefined, chamber_temper: 5 }, 'A1 mini')!.temperatures,
  ).toEqual([
    { name: '喷嘴', current: 225, target: null },
    { name: '热床', current: 50, target: null },
  ]);
});
it('reads X2D AMS 2 Pro climate, drying and physical slots without including an external spool', () => {
  const amsSnapshot = {
    ...snapshot,
    ams: {
      tray_exist_bits: '7',
      ams: [
        null,
        { id: '1', info: '2' },
        {
          id: '0',
          info: '11002123',
          temp: '19.1',
          humidity_raw: '25',
          dry_time: 36,
          tray: [
            { id: '2', tray_type: 'PETG', tray_color: 'A03CF7FF' },
            { id: '0', tray_type: 'PLA', tray_color: '161616FF' },
            { id: '3', tray_type: 'PLA', tray_color: 'FFFF00FF' },
          ],
        },
      ],
    },
    vt_tray: { id: '254', tray_type: 'PLA', tray_color: 'FFFF00FF' },
  };
  expect(parseTelemetry(amsSnapshot, 'X2D')?.ams2Pro).toEqual([
    {
      id: 0,
      temperature: 19.1,
      humidityPercent: 25,
      dryingStatus: 2,
      dryingMinutes: 36,
      slots: [
        { number: 1, occupied: true, material: 'PLA', colorHex: '#161616' },
        { number: 2, occupied: true, material: null, colorHex: null },
        { number: 3, occupied: true, material: 'PETG', colorHex: '#A03CF7' },
        { number: 4, occupied: false, material: null, colorHex: null },
      ],
    },
  ]);
  expect(parseTelemetry(amsSnapshot, 'A1 mini')?.ams2Pro).toBeUndefined();
  expect(parseTelemetry({ ...snapshot, ams: 'invalid' }, 'X2D')?.temperatures).toHaveLength(4);
});

it('reads A1 mini BMCU slots from AMS Lite reports without exposing placeholder climate fields', () => {
  const unit = {
    id: '0',
    temp: '0.0',
    humidity: '5',
    tray: [{ id: '2', tray_type: 'PLA', tray_color: 'BCBCBCFF' }],
  };
  for (const info of [undefined, '2']) {
    const report = {
      ...snapshot,
      ams: { tray_exist_bits: 'c', ams: [{ ...unit, info }] },
    };
    expect(parseTelemetry(report, 'A1 mini')?.bmcu).toEqual([
      {
        id: 0,
        slots: [
          { number: 1, occupied: false, material: null, colorHex: null },
          { number: 2, occupied: false, material: null, colorHex: null },
          { number: 3, occupied: true, material: 'PLA', colorHex: '#BCBCBC' },
          { number: 4, occupied: true, material: null, colorHex: null },
        ],
      },
    ]);
    expect(parseTelemetry(report, 'X2D')?.ams2Pro).toEqual([]);
  }
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
