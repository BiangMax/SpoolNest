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
  status: 4,
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
