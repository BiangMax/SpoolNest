import { it, expect, vi, afterEach } from 'vitest';
import { createApp } from '../apps/server/src/app';
import { spoolInput, reviewInput } from './helpers';
const apps: ReturnType<typeof createApp>[] = [];
afterEach(async () => {
  for (const { app } of apps.splice(0)) await app.close();
  vi.unstubAllGlobals();
});
const hit = (id: number) => ({
  id,
  deviceId: 'synthetic-device',
  title: `TEST ONLY ${id}`,
  status: 2, // 实机对照（2026-11-18 cn 区）：2=成功
  weight: 55,
  amsDetailMapping: [{ ams: 0, filamentType: 'PLA', sourceColor: 'FFFFFF', weight: 55 }],
});
async function setup() {
  const instance = createApp({
    databasePath: ':memory:',
    serveStatic: false,
    experimental: true,
    bambuToken: 'synthetic-test-token',
  });
  apps.push(instance);
  const enabled = await instance.app.inject({
    method: 'POST',
    url: '/api/integration/enable',
    payload: { acknowledgeExperimental: true },
  });
  expect(enabled.statusCode).toBe(200);
  return instance;
}
it('合成云端分页同步幂等，重同步不覆盖已核对数据', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const offset = Number(new URL(input).searchParams.get('offset'));
      return new Response(
        JSON.stringify({
          hits: Array.from({ length: offset === 0 ? 50 : 1 }, (_, i) => hit(offset + i)),
          total: 51,
        }),
        { status: 200 },
      );
    }),
  );
  const { app, store } = await setup();
  const s = store.addSpools(spoolInput())[0];
  const first = await app.inject({ method: 'POST', url: '/api/sync', payload: {} });
  expect(first.json().created).toBe(51);
  expect(store.spool(s.id).remainingMg).toBe(800000);
  const j = store.jobs()[0];
  store.review(j.id, reviewInput(store, j.id, [s.id]));
  const second = await app.inject({ method: 'POST', url: '/api/sync', payload: {} });
  expect(second.json().duplicates).toBe(51);
  expect(store.jobs()).toHaveLength(51);
  expect(store.spool(s.id).remainingMg).toBe(745000);
  expect(store.job(j.id).reviewStatus).toBe('reviewed');
});
it('打印机后补：重同步回填未核对任务的设备关联，已核对任务不回填', async () => {
  const hitOn = (id: number, deviceId: string) => ({ ...hit(id), deviceId });
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            hits: [hitOn(1, 'synthetic-device-a'), hitOn(2, 'synthetic-device-b')],
            total: 2,
          }),
          { status: 200 },
        ),
    ),
  );
  const { app, store } = await setup();
  const s = store.addSpools(spoolInput())[0];
  const first = await app.inject({ method: 'POST', url: '/api/sync', payload: {} });
  expect(first.json().created).toBe(2);
  expect(store.jobs().every((j) => j.printerId === null)).toBe(true);
  const reviewed = store.jobs().find((j) => j.externalId === '1')!;
  store.review(reviewed.id, reviewInput(store, reviewed.id, [s.id]));
  const pa = store.addPrinter({
    name: 'PA',
    model: 'A1 mini',
    serial: 'synthetic-device-a',
    connection: 'cloud',
  });
  const pb = store.addPrinter({
    name: 'PB',
    model: 'A1 mini',
    serial: 'synthetic-device-b',
    connection: 'cloud',
  });
  const second = await app.inject({ method: 'POST', url: '/api/sync', payload: {} });
  expect(second.json().duplicates).toBe(2);
  expect(store.job(reviewed.id).printerId).toBe(null);
  const linked = store.jobs().find((j) => j.externalId === '2')!;
  expect(linked.printerId).toBe(pb.id);
  expect(store.job(linked.id).printerName).toBe('PB');
  expect(pa.serial).toBe('synthetic-device-a');
});
it('合成云端认证失效有明确状态，不影响离线库存', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('do not expose secret provider body', { status: 401 })),
  );
  const { app, store } = await setup();
  const s = store.addSpools(spoolInput())[0];
  const result = await app.inject({ method: 'POST', url: '/api/sync', payload: {} });
  expect(result.statusCode).toBe(502);
  expect(store.syncState().status).toBe('auth_expired');
  expect(result.body).not.toContain('secret provider');
  expect(store.spool(s.id).remainingMg).toBe(800000);
});
it('重复分页终止并保留断点，不假报全部成功', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ hits: Array.from({ length: 50 }, (_, i) => hit(i)), total: 500 }),
          { status: 200 },
        ),
    ),
  );
  const { app, store } = await setup();
  const result = await app.inject({ method: 'POST', url: '/api/sync', payload: {} });
  expect(result.statusCode).toBe(502);
  expect(store.syncState().status).toBe('partial');
  expect(store.syncState().cursor).toBe('50');
  expect(store.jobs()).toHaveLength(50);
});
