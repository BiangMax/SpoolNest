import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
export const SCHEMA_VERSION = 4;
export class Database {
  readonly raw: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.raw.exec(
      'CREATE TABLE IF NOT EXISTS schema_migration (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
    );
    const migrations = [
      '001_initial.sql',
      '002_ledger_snapshot.sql',
      '003_spool_cloud_id.sql',
      '004_cloud_keep_local.sql',
    ];
    const version = this.raw
      .prepare('SELECT COALESCE(MAX(version),0) AS v FROM schema_migration')
      .get() as { v: number };
    if (version.v > SCHEMA_VERSION) throw new Error('数据库来自更新版本，请先升级 SpoolNest');
    for (const [index, file] of migrations.entries())
      this.transaction(() => {
        if (this.raw.prepare('SELECT version FROM schema_migration WHERE version=?').get(index + 1))
          return;
        this.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
        this.raw
          .prepare('INSERT INTO schema_migration VALUES(?,?)')
          .run(index + 1, new Date().toISOString());
      });
  }
  all<T = Record<string, unknown>>(sql: string, ...args: any[]): T[] {
    return this.raw.prepare(sql).all(...args) as T[];
  }
  one<T = Record<string, unknown>>(sql: string, ...args: any[]): T | undefined {
    return this.raw.prepare(sql).get(...args) as T | undefined;
  }
  run(sql: string, ...args: any[]) {
    return this.raw.prepare(sql).run(...args);
  }
  transaction<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }
  close() {
    this.raw.close();
  }
}
export class DomainError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message);
  }
}
export function required<T>(item: T | undefined, message = '记录不存在'): T {
  if (!item) throw new DomainError(message, 404);
  return item;
}
