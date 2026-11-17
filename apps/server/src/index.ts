import 'dotenv/config';
import { createApp } from './app';
const host = process.env.HOST || '127.0.0.1';
const token = process.env.ADMIN_TOKEN || undefined;
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && (!token || token.length < 32))
  throw new Error('非本机监听必须设置至少 32 字符的 ADMIN_TOKEN');
const { app } = createApp({
  databasePath: process.env.DATABASE_PATH,
  adminToken: token,
  experimental: process.env.BAMBU_EXPERIMENTAL === 'true',
  bambuToken: process.env.BAMBU_ACCESS_TOKEN,
  region: process.env.BAMBU_REGION === 'global' ? 'global' : 'cn',
  publicOrigin: process.env.PUBLIC_ORIGIN,
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
await app.listen({ host, port: Number(process.env.PORT) || 4310 });
console.log(`SpoolNest ready: http://${host}:${Number(process.env.PORT) || 4310}`);
