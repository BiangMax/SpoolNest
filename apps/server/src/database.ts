import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrateStorage, type SqlValue, type WorkspaceStorage } from './storage';
export { SCHEMA_VERSION } from './storage';

export class Database implements WorkspaceStorage {
  readonly raw: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    try {
      this.raw.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
      migrateStorage(
        this,
        (file) => readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'),
        (sql) => this.raw.exec(sql),
      );
    } catch (error) {
      this.raw.close();
      throw error;
    }
  }
  all<T = Record<string, unknown>>(sql: string, ...args: SqlValue[]): T[] {
    return this.raw.prepare(sql).all(...args) as T[];
  }
  one<T = Record<string, unknown>>(sql: string, ...args: SqlValue[]): T | undefined {
    return this.raw.prepare(sql).get(...args) as T | undefined;
  }
  run(sql: string, ...args: SqlValue[]) {
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
