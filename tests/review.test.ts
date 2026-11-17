import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Database } from '../apps/server/src/database';
import { Store } from '../apps/server/src/service';
import { spoolInput, jobInput, reviewInput } from './helpers';
let db: Database, store: Store;
beforeEach(() => {
  db = new Database(':memory:');
  store = new Store(db);
});
afterEach(() => db.close());
describe('库存与原子核对', () => {
  it('新增独立料卷与初始流水，产品规格复用', () => {
    const spools = store.addSpools({ ...spoolInput(), count: 3 });
    expect(spools).toHaveLength(3);
    expect(new Set(spools.map((s) => s.id)).size).toBe(3);
    expect(new Set(spools.map((s) => s.productId)).size).toBe(1);
    expect(spools.every((s) => s.remainingMg === 800000)).toBe(true);
    expect(store.transactions()).toHaveLength(3);
  });
  it('单材料 800g → 745g，重复请求与新幂等键均不能二扣', () => {
    const s = store.addSpools(spoolInput())[0],
      j = store.addJob(jobInput()).job,
      r = reviewInput(store, j.id, [s.id]);
    const first = store.review(j.id, r);
    expect(store.spool(s.id).remainingMg).toBe(745000);
    expect(store.review(j.id, r)).toEqual(first);
    expect(() => store.review(j.id, { ...r, requestId: randomUUID(), expectedVersion: 1 })).toThrow(
      '已核对',
    );
    expect(store.spool(s.id).remainingMg).toBe(745000);
    expect(store.transactions().filter((t) => t.kind === 'consumption')).toHaveLength(1);
  });
  it('幂等键不同内容必须拒绝', () => {
    const s = store.addSpools(spoolInput())[0],
      j = store.addJob(jobInput()).job,
      r = reviewInput(store, j.id, [s.id]);
    store.review(j.id, r);
    expect(() => store.review(j.id, { ...r, notes: 'different' })).toThrow('幂等键');
  });
  it('多材料原子扣减 55g + 20g', () => {
    const a = store.addSpools(spoolInput())[0],
      b = store.addSpools(spoolInput(620000, 'eSUN'))[0],
      j = store.addJob(jobInput([55000, 20000])).job;
    store.review(j.id, reviewInput(store, j.id, [a.id, b.id], [55000, 20000]));
    expect(store.spool(a.id).remainingMg).toBe(745000);
    expect(store.spool(b.id).remainingMg).toBe(600000);
  });
  it('任意一卷库存不足，所有变更和核对记录回滚', () => {
    const a = store.addSpools(spoolInput())[0],
      b = store.addSpools(spoolInput(10000, 'eSUN'))[0],
      j = store.addJob(jobInput([55000, 20000])).job;
    expect(() =>
      store.review(j.id, reviewInput(store, j.id, [a.id, b.id], [55000, 20000])),
    ).toThrow('库存不足');
    expect(store.spool(a.id).remainingMg).toBe(800000);
    expect(store.spool(b.id).remainingMg).toBe(10000);
    expect(store.job(j.id).reviews).toHaveLength(0);
    expect(store.transactions()).toHaveLength(2);
  });
  it('同卷跨材料分配需合并校验', () => {
    const s = store.addSpools(spoolInput(60000))[0],
      j = store.addJob(jobInput([55000, 20000])).job;
    expect(() =>
      store.review(j.id, reviewInput(store, j.id, [s.id, s.id], [55000, 20000])),
    ).toThrow('库存不足');
    expect(store.spool(s.id).remainingMg).toBe(60000);
  });
  it('修改重量与更换料卷后正确恢复并重扣，旧流水保留', () => {
    const a = store.addSpools(spoolInput())[0],
      b = store.addSpools(spoolInput(620000, 'eSUN'))[0],
      j = store.addJob(jobInput()).job;
    store.review(j.id, reviewInput(store, j.id, [a.id]));
    store.review(j.id, reviewInput(store, j.id, [a.id], [60000], { mode: 'correct' }));
    expect(store.spool(a.id).remainingMg).toBe(740000);
    store.review(j.id, reviewInput(store, j.id, [b.id], [50000], { mode: 'correct' }));
    expect(store.spool(a.id).remainingMg).toBe(800000);
    expect(store.spool(b.id).remainingMg).toBe(570000);
    expect(store.job(j.id).reviews).toHaveLength(3);
    expect(store.transactions().filter((t) => t.kind === 'restore')).toHaveLength(2);
    expect(
      store
        .transactions()
        .filter((t) => t.jobId)
        .reduce((s, t) => s + (t.costCents || 0), 0),
    ).toBe(300);
  });
  it('更正失败回滚恢复过程和新 review', () => {
    const a = store.addSpools(spoolInput())[0],
      b = store.addSpools(spoolInput(10000, 'eSUN'))[0],
      j = store.addJob(jobInput()).job;
    store.review(j.id, reviewInput(store, j.id, [a.id]));
    expect(() =>
      store.review(j.id, reviewInput(store, j.id, [b.id], [55000], { mode: 'correct' })),
    ).toThrow('库存不足');
    expect(store.spool(a.id).remainingMg).toBe(745000);
    expect(store.job(j.id).reviews).toHaveLength(1);
  });
  it('撤销恢复 800g，重复撤销幂等，再核对不会再次恢复', () => {
    const s = store.addSpools(spoolInput())[0],
      j = store.addJob(jobInput()).job;
    store.review(j.id, reviewInput(store, j.id, [s.id]));
    const r = { requestId: randomUUID(), expectedVersion: 1 };
    store.undo(j.id, r);
    store.undo(j.id, r);
    expect(store.spool(s.id).remainingMg).toBe(800000);
    store.review(j.id, reviewInput(store, j.id, [s.id], [20000]));
    expect(store.spool(s.id).remainingMg).toBe(780000);
    expect(store.transactions().filter((t) => t.kind === 'restore')).toHaveLength(1);
  });
  it('同材同色不自动分配；不存在的料卷拒绝', () => {
    store.addSpools({ ...spoolInput(), count: 3 });
    const j = store.addJob(jobInput()).job;
    expect(store.transactions()).toHaveLength(3);
    expect(j.reviews).toHaveLength(0);
    expect(() => store.review(j.id, reviewInput(store, j.id, ['missing']))).toThrow('料卷不存在');
  });
  it('AMS 续料可将同材料拆分到两卷', () => {
    const [a, b] = store.addSpools({ ...spoolInput(), count: 2 }),
      j = store.addJob(jobInput()).job;
    const r = reviewInput(store, j.id, [a.id], [30000]);
    r.allocations.push({ ...r.allocations[0], spoolId: b.id, amountMg: 25000 });
    store.review(j.id, r);
    expect(store.spool(a.id).remainingMg).toBe(770000);
    expect(store.spool(b.id).remainingMg).toBe(775000);
  });
  it('失败任务必须人工确认，打印中禁止核对', () => {
    const s = store.addSpools(spoolInput())[0],
      j = store.addJob(jobInput([55000], 'failed')).job;
    expect(() => store.review(j.id, reviewInput(store, j.id, [s.id]))).toThrow('手动核实');
    store.review(j.id, reviewInput(store, j.id, [s.id], [10000], { acknowledgeNonSuccess: true }));
    expect(store.spool(s.id).remainingMg).toBe(790000);
    const live = store.addJob(jobInput([55000], 'printing')).job;
    expect(() =>
      store.review(
        live.id,
        reviewInput(store, live.id, [s.id], [10000], { acknowledgeNonSuccess: true }),
      ),
    ).toThrow('尚未结束');
  });
  it('只知总用量保留未知材料，必须人工分配', () => {
    const s = store.addSpools(spoolInput())[0],
      j = store.addJob({ ...jobInput([]), totalMg: 100000 }).job;
    expect(j.incomplete).toBe(true);
    expect(j.materials[0].suggestedMg).toBeNull();
    expect(() => store.review(j.id, reviewInput(store, j.id, [s.id], [100000]))).toThrow('不完整');
    store.review(j.id, reviewInput(store, j.id, [s.id], [100000], { acknowledgeIncomplete: true }));
    expect(store.spool(s.id).remainingMg).toBe(700000);
  });
  it('重复同步 100 次只保留一条任务；人工更正不被覆盖', () => {
    const s = store.addSpools(spoolInput())[0];
    const j = store.addJob(jobInput(), 'bambu_cloud', 'cloud-id', 'device').job;
    store.review(j.id, reviewInput(store, j.id, [s.id]));
    for (let i = 0; i < 100; i++)
      store.addJob(jobInput([999999], 'failed'), 'bambu_cloud', 'cloud-id', 'device');
    expect(store.jobs()).toHaveLength(1);
    expect(store.job(j.id).materials[0].suggestedMg).toBe(55000);
    expect(store.job(j.id).reviewStatus).toBe('reviewed');
    expect(store.spool(s.id).remainingMg).toBe(745000);
  });
  it('不同设备同外部ID不合并；无外部ID不按名称时间合并', () => {
    store.addJob(jobInput(), 'bambu_cloud', 'id', 'a');
    store.addJob(jobInput(), 'bambu_cloud', 'id', 'b');
    store.addJob(jobInput());
    store.addJob(jobInput());
    expect(store.jobs()).toHaveLength(4);
  });
  it('X2D 双喷嘴可独立映射；历史绑定在换卷后保持', () => {
    const p = store.addPrinter({ name: 'TEST X2D', model: 'X2D' });
    expect(p.extruders).toHaveLength(2);
    expect(p.slots).toHaveLength(0);
    for (const e of p.extruders)
      store.addSlot(p.id, { name: e.name, kind: 'external', extruderId: e.id });
    const slots = store.printers()[0].slots;
    const [a, b, c] = store.addSpools({ ...spoolInput(), count: 3 });
    store.assign(slots[0].id, { spoolId: a.id });
    store.assign(slots[1].id, { spoolId: b.id });
    const start = new Date(Date.now() + 1).toISOString();
    const input = jobInput([55000, 20000]);
    const j = store.addJob({
      ...input,
      printerId: p.id,
      startedAt: start,
      materials: input.materials.map((m, i) => ({
        ...m,
        sourceSlot: slots[i].name,
        sourceNozzle: p.extruders[i].name,
      })),
    }).job;
    store.assign(slots[0].id, { spoolId: c.id });
    expect(
      store
        .job(j.id)
        .slotSnapshot.map((s) => s.spoolId)
        .sort(),
    ).toEqual([a.id, b.id].sort());
    store.review(j.id, reviewInput(store, j.id, [a.id, b.id], [55000, 20000]));
    expect(store.spool(c.id).remainingMg).toBe(800000);
  });
  it('校准具版本保护；未知价格不算零成本；价格快照用于撤销', () => {
    const s = store.addSpools({ ...spoolInput(), priceCents: null })[0];
    store.calibrate(s.id, {
      remainingMg: 700000,
      expectedVersion: s.version,
      source: 'weighed',
      notes: 'test',
    });
    expect(() =>
      store.calibrate(s.id, {
        remainingMg: 600000,
        expectedVersion: s.version,
        source: 'weighed',
        notes: 'test',
      }),
    ).toThrow('已更新');
    const j = store.addJob(jobInput()).job;
    store.review(j.id, reviewInput(store, j.id, [s.id]));
    expect(store.transactions().find((t) => t.jobId)?.costCents).toBeNull();
  });
  it('批量 CSV 输入有一行无效时全部拒绝', () => {
    expect(() =>
      store.importSpools([spoolInput(), { ...spoolInput(), remainingMg: -1 }]),
    ).toThrow();
    expect(store.spools()).toHaveLength(0);
  });
});

it('修改产品规格与价格不改历史归属，撤销按原快照冲销', () => {
  const s = store.addSpools(spoolInput())[0],
    j = store.addJob(jobInput()).job;
  store.review(j.id, reviewInput(store, j.id, [s.id]));
  const current = store.spool(s.id);
  store.editSpool(s.id, {
    ...current,
    product: { ...current.product, brand: 'NEW BRAND', material: 'PETG' },
    priceCents: 9999,
    expectedVersion: current.version,
  });
  expect(store.transactions().find((t) => t.kind === 'consumption')?.brand).toBe('SUNLU');
  store.undo(j.id, { requestId: randomUUID(), expectedVersion: store.job(j.id).version });
  const txs = store.transactions().filter((t) => t.jobId === j.id);
  expect(txs.every((t) => t.brand === 'SUNLU')).toBe(true);
  expect(txs.reduce((sum, t) => sum + (t.costCents || 0), 0)).toBe(0);
  expect(() => db.run('DELETE FROM inventory_transaction')).toThrow('append-only');
});
