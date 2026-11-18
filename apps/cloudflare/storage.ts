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

// Tables are ordered so foreign keys and append-only ledger triggers remain active during backup.
const tables = [
  'schema_migration',
  'filament_product',
  'spool',
  'printer',
  'printer_extruder',
  'printer_slot',
  'slot_assignment',
  'print_job',
  'print_job_material',
  'job_review',
  'review_allocation',
  'inventory_transaction',
  'sync_state',
  'integration_config',
  'settings',
];
const seededTables = new Set(['schema_migration', 'sync_state', 'integration_config', 'settings']);
const identifier = (name: string) => '"' + name.replaceAll('"', '""') + '"';

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

  backup(): Buffer {
    return this.transaction(() => {
      const statements = [
        'PRAGMA foreign_keys=ON;',
        'BEGIN IMMEDIATE;',
        ...migrations.map(this.readMigration),
      ];
      for (const table of tables) {
        const name = identifier(table);
        if (seededTables.has(table)) statements.push(`DELETE FROM ${name};`);
        for (const row of this.all<Record<string, SqlValue | ArrayBuffer>>(
          `SELECT * FROM ${name}`,
        )) {
          const columns = Object.keys(row).map(identifier).join(',');
          const values = Object.values(row).map(literal).join(',');
          statements.push(`INSERT INTO ${name} (${columns}) VALUES (${values});`);
        }
      }
      statements.push('COMMIT;', '');
      return Buffer.from(statements.join('\n'));
    });
  }
}
