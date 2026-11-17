import { existsSync } from 'node:fs';
import { describe, it, expect, afterEach } from 'vitest';
import { createApp } from '../apps/server/src/app';
import { jobInput, spoolInput, reviewInput } from './helpers';
const apps: ReturnType<typeof createApp>[] = [];
const setup = (options = {}) => {
  const app = createApp({ databasePath: ':memory:', serveStatic: false, ...options });
  apps.push(app);
  return app;
};
afterEach(async () => {
  for (const { app } of apps.splice(0)) await app.close();
});
describe('API 集成与安全', () => {
  it('设备未连/云端禁用时本地库存可用', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'POST', url: '/api/sync', payload: {} })).statusCode).toBe(
      409,
    );
    const res = await app.inject({ method: 'POST', url: '/api/spools', payload: spoolInput() });
    expect(res.statusCode).toBe(201);
    expect(res.json()[0].remainingMg).toBe(800000);
    expect((await app.inject('/api/overview')).json().spools).toHaveLength(1);
  });
  it('并发不同任务竞争同卷不会超扣，事务失败无部分写入', async () => {
    const { app, store } = setup();
    const s = store.addSpools(spoolInput(80000))[0],
      a = store.addJob(jobInput()).job,
      b = store.addJob(jobInput()).job;
    const responses = await Promise.all(
      [a, b].map((j) =>
        app.inject({
          method: 'POST',
          url: `/api/jobs/${j.id}/review`,
          payload: reviewInput(store, j.id, [s.id]),
        }),
      ),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(store.spool(s.id).remainingMg).toBe(25000);
    expect(store.transactions().filter((t) => t.kind === 'consumption')).toHaveLength(1);
  });
  it('并发同任务不同幂等键只有一笔扣减', async () => {
    const { app, store } = setup();
    const s = store.addSpools(spoolInput())[0],
      j = store.addJob(jobInput()).job;
    const responses = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: 'POST',
          url: `/api/jobs/${j.id}/review`,
          payload: reviewInput(store, j.id, [s.id]),
        }),
      ),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(store.spool(s.id).remainingMg).toBe(745000);
  });
  it('令牌验证、CSRF/Host 检查、schema 校验', async () => {
    const { app } = setup({ adminToken: 'test-secret-only' });
    expect((await app.inject('/api/overview')).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: '/api/overview',
          headers: { authorization: 'Bearer test-secret-only' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/spools',
          headers: { origin: 'https://evil.invalid', authorization: 'Bearer test-secret-only' },
          payload: spoolInput(),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: '/api/health', headers: { host: 'evil.invalid' } })).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/spools',
          headers: { authorization: 'Bearer test-secret-only' },
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
  });
  it('禁止默认云端启用；所有设置和 overview 都不返回 Token', async () => {
    const { app } = setup({ bambuToken: 'secret-test-token' });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/integration/enable',
          payload: { acknowledgeExperimental: true },
        })
      ).statusCode,
    ).toBe(400);
    expect((await app.inject('/api/overview')).body).not.toContain('secret-test-token');
  });
  it('CSV 导出防公式注入，不允许直接重导有 ID 的库存', async () => {
    const { app, store } = setup();
    store.addSpools({ ...spoolInput(), location: '=HYPERLINK("bad")' });
    const res = await app.inject('/api/export/spools.csv');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("'=HYPERLINK");
  });
});

it('已切片 3MF 通过真实 multipart 路由导入并去重，不改变库存', async () => {
  const { zipFile, sliceXml } = await import('./helpers');
  const { app, store } = setup();
  store.addSpools(spoolInput());
  const boundary = 'spoolnest-synthetic-boundary';
  const zip = zipFile('Metadata/slice_info.config', sliceXml);
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.3mf"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    zip,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const first = await app.inject({
    method: 'POST',
    url: '/api/import/3mf',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
  expect(first.statusCode).toBe(200);
  expect(first.json().created).toBe(1);
  expect(first.json().jobs[0].materials).toHaveLength(2);
  const again = await app.inject({
    method: 'POST',
    url: '/api/import/3mf',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
  expect(again.json().duplicates).toBe(1);
  expect(store.spools()[0].remainingMg).toBe(800000);
  expect(store.transactions()).toHaveLength(1);
});

it.skipIf(!existsSync('dist/web/index.html'))(
  '生产静态资源正常提供，管理 API 仍需令牌',
  async () => {
    const { app } = setup({ serveStatic: true, adminToken: 'test-secret' });
    expect((await app.inject('/')).statusCode).toBe(200);
    expect((await app.inject('/inventory')).statusCode).toBe(200);
    expect((await app.inject('/api/overview')).statusCode).toBe(401);
    expect((await app.inject('/%61pi/overview')).statusCode).not.toBe(200);
  },
);
