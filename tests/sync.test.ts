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
it('云端库存同步：新增、唯一回链、差异只报告、永不覆盖本地数值', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            hits: [
              {
                id: 9001,
                filamentVendor: 'TEST',
                filamentName: 'PLA White',
                filamentType: 'PLA',
                color: '#FFFFFFCC',
                netWeight: 661,
                totalNetWeight: 1000,
              },
              {
                id: 9002,
                filamentVendor: 'TEST',
                filamentName: 'PETG Black',
                filamentType: 'PETG',
                color: '#161616FF',
                netWeight: 745,
                totalNetWeight: 1000,
              },
              {
                id: 9003,
                filamentVendor: 'TEST',
                filamentName: 'ABS Blue',
                filamentType: 'ABS',
                color: '#2856E0FF',
                netWeight: 500,
                totalNetWeight: 1000,
              },
              {
                id: 9004,
                filamentVendor: 'TEST',
                filamentName: 'PETG Gray',
                filamentType: 'PETG',
                color: '#8C8C8CFF',
                netWeight: 900,
                totalNetWeight: 1000,
              },
            ],
          }),
          { status: 200 },
        ),
    ),
  );
  const { app, store } = await setup();
  store.addSpools({
    ...spoolInput(806000, 'TEST'),
    product: {
      brand: 'TEST',
      name: 'PLA White',
      material: 'PLA',
      colorHex: '#FFFFFF',
      colorName: '',
      netMg: 1000000,
    },
  });
  store.addSpools({
    ...spoolInput(745000, 'TEST'),
    product: {
      brand: 'TEST',
      name: 'PETG Black',
      material: 'PETG',
      colorHex: '#161616',
      colorName: '',
      netMg: 1000000,
    },
    count: 2,
  });
  store.addSpools({
    ...spoolInput(900000, 'TEST'),
    product: {
      brand: 'TEST',
      name: 'PETG Gray',
      material: 'PETG',
      colorHex: '#8C8C8C',
      colorName: '',
      netMg: 1000000,
    },
    count: 1,
  });
  store.addSpools({
    ...spoolInput(745000, 'TEST'),
    product: {
      brand: 'TEST',
      name: 'PETG Gray',
      material: 'PETG',
      colorHex: '#8C8C8C',
      colorName: '',
      netMg: 1000000,
    },
    count: 1,
  });
  const first = await app.inject({ method: 'POST', url: '/api/sync/spools', payload: {} });
  expect(first.statusCode).toBe(200);
  const r = first.json();
  expect(r.added).toBe(1);
  expect(r.linkedCount).toBe(2);
  expect(r.differences).toHaveLength(1);
  expect(r.differences[0].localRemainingMg).toBe(806000);
  expect(r.differences[0].cloudRemainingMg).toBe(661000);
  expect(r.warnings).toHaveLength(0);
  const spools = store.spools();
  const white = spools.find((s) => s.product.name === 'PLA White')!;
  expect(white.remainingMg).toBe(806000);
  expect(white.cloudSpoolId).toBe(9001);
  expect(spools.find((s) => s.product.name === 'ABS Blue')!.remainingMg).toBe(500000);
  // 完全等价的同规格叠加（同克重两卷）：按本地添加顺序确定性对应第一卷
  const blackLinked = spools.filter((s) => s.product.name === 'PETG Black');
  expect(blackLinked.filter((s) => s.cloudSpoolId === 9002)).toHaveLength(1);
  expect(blackLinked.filter((s) => s.cloudSpoolId === null)).toHaveLength(1);
  const grayLinked = spools.filter(
    (s) => s.product.name === 'PETG Gray' && s.cloudSpoolId === 9004,
  );
  expect(grayLinked).toHaveLength(1);
  expect(grayLinked[0].remainingMg).toBe(900000);
  const second = await app.inject({ method: 'POST', url: '/api/sync/spools', payload: {} });
  expect(second.statusCode).toBe(200);
  expect(second.json().added).toBe(0);
  expect(second.json().differences).toHaveLength(1);
  expect(store.spools().filter((s) => s.product.name === 'ABS Blue')).toHaveLength(1);
});
it('逐卷采用云端重量保留流水，并拒绝重复提交和过期对照', async () => {
  const { app, store } = await setup();
  const [s, untouched] = store.addSpools({ ...spoolInput(), count: 2 });
  const raw = {
    id: 99001,
    vendor: s.product.brand,
    name: s.product.name,
    material: s.product.material,
    color: s.product.colorHex,
    remainingMg: 661000,
    totalNetWeightMg: s.product.netMg,
  };
  // 给测试目标明确关联，避免同规格多卷猜测；同步读取本身不改重量。
  store.db.run('UPDATE spool SET cloud_spool_id=? WHERE id=?', raw.id, s.id);
  const d = store.syncCloudSpools([raw]).differences[0];
  expect(store.spool(s.id).remainingMg).toBe(800000);
  const payload = {
    remainingMg: d.cloudRemainingMg,
    expectedVersion: d.expectedVersion,
    source: 'cloud_report',
    notes: '测试用户确认采用云端报告值',
  };
  const url = `/api/spools/${s.id}/calibrate`;
  expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(200);
  expect(store.spool(s.id).remainingMg).toBe(661000);
  expect(store.spool(untouched.id).remainingMg).toBe(800000);
  const ledger = () =>
    store.db.all<any>(
      "SELECT * FROM inventory_transaction WHERE spool_id=? AND source='cloud_report'",
      s.id,
    );
  expect(ledger()).toHaveLength(1);
  expect(ledger()[0]).toMatchObject({
    kind: 'calibration',
    delta_mg: -139000,
    before_mg: 800000,
    after_mg: 661000,
  });
  expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(409);
  expect(ledger()).toHaveLength(1);
  const stale = store.syncCloudSpools([{ ...raw, remainingMg: 0 }]).differences[0];
  store.calibrate(s.id, {
    remainingMg: 700000,
    expectedVersion: stale.expectedVersion,
    source: 'weighed',
    notes: '对照后重新称重',
  });
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        payload: { ...payload, remainingMg: 0, expectedVersion: stale.expectedVersion },
      })
    ).statusCode,
  ).toBe(409);
  expect(store.spool(s.id).remainingMg).toBe(700000);
  const zero = store.syncCloudSpools([{ ...raw, remainingMg: 0 }]).differences[0];
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        payload: { ...payload, remainingMg: 0, expectedVersion: zero.expectedVersion },
      })
    ).statusCode,
  ).toBe(200);
  expect(store.spool(s.id).remainingMg).toBe(0);
  expect(store.syncCloudSpools([{ ...raw, remainingMg: 0 }]).differences).toHaveLength(0);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/spools/${untouched.id}/calibrate`,
        payload: { ...payload, expectedVersion: store.spool(untouched.id).version },
      })
    ).statusCode,
  ).toBe(409);
});
it('云端对照列出本地未对应料卷，保留决定可重复读取，归档不删除历史', async () => {
  const { app, store } = await setup();
  const localInput = spoolInput(800000, 'LOCAL');
  localInput.product.colorName = '';
  const local = store.addSpools(localInput)[0];
  const missing = store.addSpools(spoolInput(500000, 'MISSING'))[0];
  store.db.run('UPDATE spool SET cloud_spool_id=? WHERE id=?', 123, missing.id);
  const beforeLedger = store.transactions().length;
  const first = store.syncCloudSpools([]);
  expect(first).toMatchObject({ localCount: 2, cloudCount: 0 });
  expect(first.localOnly).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ spoolId: local.id, reason: 'unlinked', kept: false }),
      expect.objectContaining({ spoolId: missing.id, reason: 'not_returned', kept: false }),
    ]),
  );
  const choose = (id: string, decision: string, expectedVersion: number) =>
    app.inject({
      method: 'POST',
      url: `/api/spools/${id}/cloud-decision`,
      payload: { decision, expectedVersion },
    });
  expect((await choose(local.id, 'keep', local.version)).statusCode).toBe(200);
  expect(store.spool(local.id).remainingMg).toBe(800000);
  expect(store.syncCloudSpools([]).localOnly.find((s) => s.spoolId === local.id)?.kept).toBe(true);
  expect((await choose(local.id, 'archive', local.version)).statusCode).toBe(409);
  expect((await choose(missing.id, 'archive', missing.version)).statusCode).toBe(200);
  const archived = store.spool(missing.id);
  expect(archived.status).toBe('archived');
  expect(archived.remainingMg).toBe(500000);
  expect(store.transactions()).toHaveLength(beforeLedger);
  expect(store.syncCloudSpools([])).toMatchObject({
    localCount: 1,
    localOnly: [expect.objectContaining({ spoolId: local.id, kept: true })],
  });
  // 云端再次返回已归档卷时，不自动恢复、创建重复卷或要求校准。
  const cloudHit = {
    id: 123,
    vendor: missing.product.brand,
    name: missing.product.name,
    material: missing.product.material,
    color: missing.product.colorHex,
    remainingMg: 400000,
    totalNetWeightMg: missing.product.netMg,
  };
  expect(store.syncCloudSpools([cloudHit])).toMatchObject({ added: 0, differences: [] });
  expect(store.spool(missing.id).status).toBe('archived');
  store.editSpool(missing.id, { ...archived, expectedVersion: archived.version, status: 'opened' });
  expect(store.spool(missing.id).status).toBe('opened');
  // 用户保留的本地卷后来获得真实云端关联，旧保留决定重置。
  const localHit = {
    id: 456,
    vendor: local.product.brand,
    name: local.product.name,
    material: local.product.material,
    color: local.product.colorHex,
    remainingMg: 800000,
    totalNetWeightMg: local.product.netMg,
  };
  expect(store.syncCloudSpools([localHit, cloudHit]).localOnly).toHaveLength(0);
  expect(store.syncCloudSpools([]).localOnly.find((s) => s.spoolId === local.id)?.kept).toBe(false);
});
it('本地料卷裁定不能归档已安装料卷，失败不修改重量或保留决定', async () => {
  const { app, store } = await setup();
  const s = store.addSpools(spoolInput())[0];
  const p = store.addPrinter({
    name: 'TEST',
    model: 'A1 mini',
    serial: 'decision-test',
    connection: 'manual',
  });
  const slots = store.printers().find((printer) => printer.id === p.id)!.slots;
  store.assign(slots[0].id, { spoolId: s.id });
  const current = store.spool(s.id);
  const response = await app.inject({
    method: 'POST',
    url: `/api/spools/${s.id}/cloud-decision`,
    payload: { decision: 'archive', expectedVersion: current.version },
  });
  expect(response.statusCode).toBe(409);
  expect(store.spool(s.id).status).not.toBe('archived');
  expect(store.spool(s.id).remainingMg).toBe(800000);
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
