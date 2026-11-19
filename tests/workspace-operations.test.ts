import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Database } from '../apps/server/src/database';
import { Store } from '../apps/server/src/service';
import { spoolInput } from './helpers';

it('resumes the latest comparison after reopening and rejects decisions on a superseded report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spoolnest-comparison-'));
  const file = join(dir, 'fixture.db');
  let db = new Database(file);
  try {
    let store = new Store(db);
    const [s] = store.addSpools(spoolInput());
    const first = store.syncCloudSpools([]);
    const latest = store.syncCloudSpools([], ['fixture warning']);
    db.close();
    db = new Database(file);
    store = new Store(db);
    expect(store.comparison()).toEqual(latest);
    const decision = { decision: 'keep', expectedVersion: s.version };
    expect(() => store.decideCloudSpool(s.id, { ...decision, comparisonId: first.id })).toThrow(
      '新的库存对照',
    );
    expect(store.comparison()?.localOnly[0].kept).toBe(false);
    store.decideCloudSpool(s.id, { ...decision, comparisonId: latest.id });
    expect(store.comparison()).toMatchObject({
      id: latest.id,
      warnings: ['fixture warning'],
      localOnly: [{ spoolId: s.id, kept: true }],
    });
  } finally {
    db.close();
    rmSync(dir, { force: true, recursive: true });
  }
});

it('groups restock across brands, keeps a configured empty spec and rejects overlapping rule edits', () => {
  const db = new Database(':memory:');
  try {
    const store = new Store(db);
    const a = spoolInput(95000);
    const b = spoolInput(35000, 'Other');
    b.product.material = 'pla';
    b.product.colorHex = '#ffffff';
    const [first] = store.addSpools({ ...a, status: 'sealed' });
    const [other] = store.addSpools(b);
    const [row] = store.restock();
    expect(row).toMatchObject({
      material: 'PLA',
      colorHex: '#FFFFFF',
      remainingMg: 130000,
      count: 2,
      sealed: 1,
      minimumMg: null,
      ordered: false,
      version: 0,
    });
    const edit = { ...row, minimumMg: 200000, ordered: true, expectedVersion: row.version };
    store.updateRestock(edit);
    expect(() => store.updateRestock(edit)).toThrow('已更新');
    for (const s of [first, other])
      store.decideCloudSpool(s.id, { expectedVersion: s.version, decision: 'archive' });
    const [tracked] = store.restock();
    expect(tracked).toMatchObject({ minimumMg: 200000, ordered: true, count: 0, remainingMg: 0 });
    store.updateRestock({
      ...edit,
      ordered: false,
      minimumMg: 0,
      expectedVersion: tracked.version,
    });
    expect(store.restock()[0]).toMatchObject({ minimumMg: 0, ordered: false });
  } finally {
    db.close();
  }
});
