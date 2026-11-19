export const migrations = [
  '001_initial.sql',
  '002_ledger_snapshot.sql',
  '003_spool_cloud_id.sql',
  '004_cloud_keep_local.sql',
  '005_spool_change_batch.sql',
  '006_restock_rule.sql',
];
export const SCHEMA_VERSION = migrations.length;

export type SqlValue = string | number | null | Uint8Array;

export interface WorkspaceStorage {
  all<T = Record<string, unknown>>(sql: string, ...args: SqlValue[]): T[];
  one<T = Record<string, unknown>>(sql: string, ...args: SqlValue[]): T | undefined;
  run(sql: string, ...args: SqlValue[]): void;
  transaction<T>(fn: () => T): T;
  close(): void;
}

export function migrateStorage(
  db: WorkspaceStorage,
  readMigration: (file: string) => string,
  executeMigration: (sql: string) => void,
) {
  db.run(
    'CREATE TABLE IF NOT EXISTS schema_migration (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  const current = db.one<{ v: number }>(
    'SELECT COALESCE(MAX(version),0) AS v FROM schema_migration',
  );
  if (current && current.v > SCHEMA_VERSION)
    throw new Error('数据库来自更新版本，请先升级 SpoolNest');
  for (const [index, file] of migrations.entries()) {
    const version = index + 1;
    db.transaction(() => {
      if (db.one('SELECT version FROM schema_migration WHERE version=?', version)) return;
      executeMigration(readMigration(file));
      db.run('INSERT INTO schema_migration VALUES(?,?)', version, new Date().toISOString());
    });
  }
}
