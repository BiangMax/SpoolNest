import initial from '../server/migrations/001_initial.sql';
import ledger from '../server/migrations/002_ledger_snapshot.sql';
import cloudId from '../server/migrations/003_spool_cloud_id.sql';
import keepLocal from '../server/migrations/004_cloud_keep_local.sql';
import spoolChangeBatch from '../server/migrations/005_spool_change_batch.sql';

import restock from '../server/migrations/006_restock_rule.sql';

const migrations: Record<string, string> = {
  '001_initial.sql': initial,
  '002_ledger_snapshot.sql': ledger,
  '003_spool_cloud_id.sql': cloudId,
  '004_cloud_keep_local.sql': keepLocal,
  '005_spool_change_batch.sql': spoolChangeBatch,
  '006_restock_rule.sql': restock,
};

export function readMigration(file: string): string {
  const sql = migrations[file];
  if (!sql) throw new Error(`缺少数据库迁移：${file}`);
  return sql;
}
