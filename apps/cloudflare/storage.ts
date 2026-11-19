import { createHash } from 'node:crypto';
import { DomainError } from '../server/src/database';
import { spoolComparisonSchema } from '../../packages/shared/src';
import { backupTables, seededTables, identifier, readBackup, backupLimit } from './backup';
import {
  migrations,
  migrateStorage,
  type SqlValue,
  type WorkspaceStorage,
} from '../server/src/storage';

export interface DurableSqlStorage {
  sql: {
    exec(sql: string, ...args: SqlValue[]): { toArray(): Record<string, SqlValue>[] };
  };
  transactionSync<T>(fn: () => T): T;
}

function literal(value: SqlValue | ArrayBuffer): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot export a non-finite SQLite value');
    return String(value);
  }
  if (typeof value === 'string') {
    if (value.includes('\0')) return `CAST(X'${Buffer.from(value).toString('hex')}' AS TEXT)`;
    return "'" + value.replaceAll("'", "''") + "'";
  }
  return `X'${Buffer.from(new Uint8Array(value)).toString('hex')}'`;
}

export class DurableDatabase implements WorkspaceStorage {
  constructor(
    private readonly storage: DurableSqlStorage,
    private readonly readMigration: (file: string) => string,
  ) {
    migrateStorage(this, readMigration, (sql) => this.storage.sql.exec(sql));
  }

  all<T = Record<string, unknown>>(sql: string, ...args: SqlValue[]): T[] {
    return this.storage.sql.exec(sql, ...args).toArray() as T[];
  }

  one<T = Record<string, unknown>>(sql: string, ...args: SqlValue[]): T | undefined {
    return this.all<T>(sql, ...args)[0];
  }

  run(sql: string, ...args: SqlValue[]) {
    this.storage.sql.exec(sql, ...args).toArray();
  }

  transaction<T>(fn: () => T): T {
    return this.storage.transactionSync(fn);
  }

  close() {
    // Cloudflare manages the storage object's lifecycle.
  }

  counts() {
    return this.all<{ spools: number; jobs: number; transactions: number }>(
      'SELECT (SELECT count(*) FROM spool) AS spools,(SELECT count(*) FROM print_job) AS jobs,(SELECT count(*) FROM inventory_transaction) AS transactions',
    )[0];
  }

  private dump(): Buffer {
    const statements = [
      'PRAGMA foreign_keys=ON;',
      'BEGIN IMMEDIATE;',
      ...migrations.map(this.readMigration),
    ];
    for (const table of backupTables) {
      const name = identifier(table);
      if (seededTables.has(table)) statements.push(`DELETE FROM ${name};`);
      for (const row of this.all<Record<string, SqlValue | ArrayBuffer>>(
        `SELECT * FROM ${name} ORDER BY rowid`,
      )) {
        const columns = Object.keys(row).map(identifier).join(',');
        const values = Object.values(row).map(literal).join(',');
        statements.push(`INSERT INTO ${name} (${columns}) VALUES (${values});`);
      }
    }
    statements.push('COMMIT;', '');
    return Buffer.from(statements.join('\n'));
  }
  backup(): Buffer {
    return this.transaction(() =>
      Buffer.concat([
        Buffer.from('-- SpoolNest backup ' + new Date().toISOString() + '\n'),
        this.dump(),
      ]),
    );
  }
  fingerprint() {
    return createHash('sha256').update(this.dump()).digest('hex');
  }

  private replaceContents(source: string) {
    // Remove and reinstate the delete guard inside this one transaction. All other
    // connections see either the old protected ledger or the new protected ledger.
    this.run('DROP TRIGGER ledger_immutable_delete');
    for (const table of [...backupTables].reverse()) this.run('DELETE FROM ' + identifier(table));
    this.run(
      "CREATE TRIGGER ledger_immutable_delete BEFORE DELETE ON inventory_transaction BEGIN SELECT RAISE(ABORT,'inventory ledger is append-only'); END",
    );
    const info = readBackup(
      source,
      migrations.map(this.readMigration),
      (table) =>
        this.all<{ name: string }>('SELECT name FROM pragma_table_info(?) ORDER BY cid', table).map(
          (c) => c.name,
        ),
      (table, cols, values) =>
        this.run(
          'INSERT INTO ' +
            identifier(table) +
            ' (' +
            cols.map(identifier).join(',') +
            ') VALUES (' +
            cols.map(() => '?').join(',') +
            ')',
          ...values,
        ),
    );
    const versions = this.all<{ version: number }>(
      'SELECT version FROM schema_migration ORDER BY version',
    );
    if (versions.length !== info.version || versions.some((v, i) => v.version !== i + 1))
      throw new DomainError('备份迁移记录不完整');
    for (let i = info.version; i < migrations.length; i++)
      this.run('INSERT INTO schema_migration VALUES(?,?)', i + 1, new Date().toISOString());
    const prefs = this.one<{ value: string }>("SELECT value FROM settings WHERE id='preferences'");
    if (
      !prefs ||
      !this.one("SELECT id FROM sync_state WHERE id='bambu_cloud'") ||
      !this.one("SELECT id FROM integration_config WHERE id='bambu_cloud'")
    )
      throw new DomainError('备份缺少工作空间配置');
    const parsed = JSON.parse(prefs.value);
    if (
      !Number.isSafeInteger(parsed.lowStockMg) ||
      parsed.lowStockMg < 0 ||
      typeof parsed.timezone !== 'string'
    )
      throw new DomainError('库存提醒或时区设置无效');
    new Intl.DateTimeFormat('zh-CN', { timeZone: parsed.timezone });
    const report = this.one<{ value: string }>(
      "SELECT value FROM settings WHERE id='spool-comparison'",
    );
    if (report) spoolComparisonSchema.parse(JSON.parse(report.value));
    if (
      this.one(
        'SELECT id FROM spool s WHERE remaining_mg != coalesce((SELECT sum(delta_mg) FROM inventory_transaction t WHERE t.spool_id=s.id),0) LIMIT 1',
      )
    )
      throw new DomainError('备份中料卷余量与流水不一致');
    for (const row of this.all<{ value: string }>(
      'SELECT slot_snapshot AS value FROM print_job UNION ALL SELECT result FROM job_review',
    ))
      JSON.parse(row.value);
    return { capturedAt: info.capturedAt, counts: this.counts() };
  }
  verify(source: string) {
    // Roll back the scratch object's trial import, including all DDL.
    let result: ReturnType<DurableDatabase['replaceContents']> | undefined;
    const rollback = new Error('validated');
    try {
      this.transaction(() => {
        result = this.replaceContents(source);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    return result!;
  }
  restore(source: string, expectedFingerprint: string) {
    return this.transaction(() => {
      const before = this.dump();
      if (createHash('sha256').update(before).digest('hex') !== expectedFingerprint)
        throw new DomainError('验证后工作空间已有变更，请重新验证备份', 409);
      const previous = Buffer.concat([
        Buffer.from('-- SpoolNest backup ' + new Date().toISOString() + '\n'),
        before,
      ]);
      if (previous.length > backupLimit)
        throw new DomainError('当前工作空间超过在线恢复上限，请使用离线恢复');
      this.run(
        'CREATE TABLE IF NOT EXISTS restore_safety_copy(part INTEGER PRIMARY KEY, data BLOB NOT NULL)',
      );
      this.run('DELETE FROM restore_safety_copy');
      const chunk = 512 * 1024;
      for (let i = 0; i < previous.length; i += chunk)
        this.run(
          'INSERT INTO restore_safety_copy VALUES(?,?)',
          i / chunk,
          previous.subarray(i, i + chunk),
        );
      const restored = this.replaceContents(source);
      this.run(
        "UPDATE sync_state SET status='failed',error='备份包含未完成的同步，请重新同步' WHERE status='syncing'",
      );
      return restored;
    });
  }
  previousBackup(): Buffer {
    if (!this.hasPreviousBackup()) throw new DomainError('还没有恢复前备份', 404);
    return Buffer.concat(
      this.all<{ data: ArrayBuffer }>('SELECT data FROM restore_safety_copy ORDER BY part').map(
        (r) => Buffer.from(r.data),
      ),
    );
  }
  hasPreviousBackup(): boolean {
    return !!this.one(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='restore_safety_copy'",
    );
  }
}
