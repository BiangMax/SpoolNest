import 'dotenv/config';
import { Database } from '../apps/server/src/database';
const db = new Database(process.env.DATABASE_PATH || './data/spoolnest.db');
db.close();
console.log('SQLite schema is up to date.');
