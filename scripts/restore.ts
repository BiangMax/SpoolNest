import 'dotenv/config';
import { SCHEMA_VERSION } from '../apps/server/src/database';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const source = process.argv[2],
  destination = process.env.DATABASE_PATH || './data/spoolnest.db';
if (!source || !process.argv.includes('--server-stopped'))
  throw new Error('先停止服务，再执行 npm run restore -- /path/backup.db --server-stopped');
if (resolve(source) === resolve(destination)) throw new Error('备份与目标路径不能相同');
if (existsSync(`${destination}-wal`) || existsSync(`${destination}-shm`))
  throw new Error('检测到 WAL/SHM；请确保服务正常退出并完成 checkpoint 后重试。不要删除 WAL。');
const check = new DatabaseSync(source, { readOnly: true });
const result = check.prepare('PRAGMA integrity_check').get() as any;
const version = check.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as any;
const fk = check.prepare('PRAGMA foreign_key_check').all();
check.close();
if (
  result.integrity_check !== 'ok' ||
  version.version < 1 ||
  version.version > SCHEMA_VERSION ||
  fk.length
)
  throw new Error('备份校验失败');
mkdirSync(dirname(destination), { recursive: true });
if (existsSync(destination))
  copyFileSync(destination, `${destination}.before-restore-${Date.now()}.db`);
copyFileSync(source, destination);
console.log('恢复完成。原数据库已另存备份。');
