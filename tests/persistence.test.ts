import { it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database, SCHEMA_VERSION } from '../apps/server/src/database';
import { Store } from '../apps/server/src/service';
import { createApp } from '../apps/server/src/app';
import { spoolInput, jobInput, reviewInput } from './helpers';
it('磁盘持久化、在线备份、重新打开以及迁移版本正确', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spoolnest-test-'));
  try {
    const path = join(dir, 'workspace.db');
    const { app, store } = createApp({ databasePath: path, serveStatic: false });
    const s = store.addSpools(spoolInput())[0],
      j = store.addJob(jobInput()).job;
    store.review(j.id, reviewInput(store, j.id, [s.id]));
    const response = await app.inject('/api/backup');
    expect(response.statusCode).toBe(200);
    const backupPath = join(dir, 'backup.db');
    await writeFile(backupPath, response.rawPayload);
    await app.close();
    for (const file of [path, backupPath]) {
      const db = new Database(file),
        saved = new Store(db);
      expect(saved.spool(s.id).remainingMg).toBe(745000);
      expect(saved.job(j.id).reviewStatus).toBe('reviewed');
      expect(saved.transactions()).toHaveLength(2);
      expect(db.one<any>('SELECT MAX(version) AS version FROM schema_migration')?.version).toBe(
        SCHEMA_VERSION,
      );
      db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
