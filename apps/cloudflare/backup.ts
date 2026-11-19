import type { SqlValue } from '../server/src/storage';
import { DomainError } from '../server/src/database';

// The SQL download remains usable with SQLite. Import only the data grammar emitted by
// our exporter; no uploaded SQL is ever executed, including the schema preamble.
export const backupTables = [
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
  'restock_rule',
] as const;
export const seededTables = new Set<string>([
  'schema_migration',
  'sync_state',
  'integration_config',
  'settings',
]);
export const identifier = (name: string) => '"' + name.replaceAll('"', '""') + '"';
export const backupLimit = 16 * 1024 * 1024;

export function readBackup(
  source: string,
  schemas: string[],
  columns: (table: string) => string[],
  insert: (table: string, cols: string[], values: SqlValue[]) => void,
) {
  const invalid = () =>
    new DomainError('备份格式、版本或表数据不完整，请选择 SpoolNest 云端导出的 SQL 文件');
  if (Buffer.byteLength(source) > backupLimit)
    throw new DomainError('备份超过 16 MiB 的在线恢复上限', 413);
  const stamp = /^-- SpoolNest backup (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)\n/.exec(source);
  let cursor = stamp?.[0].length ?? 0;
  function take(value: string) {
    if (!source.startsWith(value, cursor)) throw invalid();
    cursor += value.length;
  }
  take('PRAGMA foreign_keys=ON;\nBEGIN IMMEDIATE;\n');
  let version = 0;
  for (const schema of schemas) {
    if (!source.startsWith(schema + '\n', cursor)) break;
    take(schema + '\n');
    version++;
  }
  if (version < 5) throw invalid();
  const token =
    /(?:NULL|CAST\(X'([a-fA-F0-9]*)' AS TEXT\)|X'([a-fA-F0-9]*)'|'((?:[^']|'')*)'|(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?))/iy;
  for (const table of backupTables) {
    if (table === 'restock_rule' && version < 6) continue;
    const name = identifier(table);
    if (seededTables.has(table)) take('DELETE FROM ' + name + ';\n');
    const cols = columns(table);
    const prefix = 'INSERT INTO ' + name + ' (' + cols.map(identifier).join(',') + ') VALUES (';
    while (source.startsWith(prefix, cursor)) {
      take(prefix);
      const values = cols.map((_, i) => {
        if (i) take(',');
        token.lastIndex = cursor;
        const match = token.exec(source);
        if (!match) throw invalid();
        cursor = token.lastIndex;
        const [, text, blob, str, num] = match;
        if (text !== undefined || blob !== undefined) {
          const hex = text ?? blob;
          if (hex.length % 2) throw invalid();
          const bytes = Buffer.from(hex, 'hex');
          return text === undefined ? bytes : bytes.toString('utf8');
        }
        if (str !== undefined) return str.replaceAll("''", "'");
        if (num !== undefined) {
          const n = Number(num);
          if (!Number.isFinite(n)) throw invalid();
          return n;
        }
        return null;
      });
      take(');\n');
      insert(table, cols, values);
    }
  }
  take('COMMIT;');
  if (source.slice(cursor).trim()) throw invalid();
  return { capturedAt: stamp?.[1] ?? null, version };
}
