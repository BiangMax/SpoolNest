import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, unlink, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { backup } from 'node:sqlite';
import { z, ZodError } from 'zod';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { Database, DomainError } from './database';
import { Store } from './service';
import { BambuCloudAdapter, parse3mf } from '../../../packages/printer-adapters/src';
export type AppOptions = {
  databasePath?: string;
  adminToken?: string;
  experimental?: boolean;
  bambuToken?: string;
  region?: 'cn' | 'global';
  publicOrigin?: string;
  serveStatic?: boolean;
};
export function createApp(options: AppOptions = {}) {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  const db = new Database(options.databasePath ?? './data/spoolnest.db');
  const store = new Store(db);
  const adapter = new BambuCloudAdapter(options.bambuToken, options.region);
  let syncing = false;
  db.run(
    "UPDATE sync_state SET status='failed',error='上次同步被中断，可继续历史批次或重新刷新' WHERE status='syncing'",
  );
  const syncState = () => ({
    ...store.syncState(),
    configured: adapter.configured,
    enabled:
      !!db.one<any>("SELECT enabled FROM integration_config WHERE id='bambu_cloud'")?.enabled &&
      !!options.experimental,
    region: adapter.region,
  });
  app.addHook('onClose', async () => db.close());
  app.addHook('onRequest', async (req, reply) => {
    // API paths and generated asset names are ASCII; reject alternate encodings before guards.
    const rawPath = req.raw.url?.split('?')[0] || '/';
    if (
      rawPath.includes('%') ||
      rawPath.includes('\\') ||
      rawPath.includes('//') ||
      rawPath.split('/').some((segment) => segment === '.' || segment === '..')
    )
      return reply.code(400).send({ message: '请求路径必须使用规范形式' });
    let host: string;
    try {
      host = new URL(`http://${req.headers.host}`).hostname;
    } catch {
      return reply.code(403).send({ message: '无效的 Host' });
    }
    const allowedHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
    if (options.publicOrigin) allowedHosts.add(new URL(options.publicOrigin).hostname);
    if (!host || !allowedHosts.has(host))
      return reply.code(403).send({ message: 'Host 不受信任，请配置 PUBLIC_ORIGIN' });
    const origin = req.headers.origin;
    const allowedOrigins = new Set([
      `http://${req.headers.host}`,
      'http://127.0.0.1:5173',
      'http://localhost:5173',
    ]);
    if (options.publicOrigin) allowedOrigins.add(options.publicOrigin);
    if (origin && !allowedOrigins.has(origin))
      return reply.code(403).send({ message: '拒绝跨源请求' });
    if (req.url.startsWith('/api/') && req.url !== '/api/health' && options.adminToken) {
      const actual = Buffer.from(req.headers.authorization?.replace(/^Bearer /, '') || '');
      const expected = Buffer.from(options.adminToken);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        return reply.code(401).send({ message: '请输入管理员访问令牌' });
    }
  });
  app.addHook('onSend', async (req, reply, payload) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY');
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError)
      return reply
        .code(400)
        .send({ message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；') });
    if (error instanceof DomainError)
      return reply.code(error.statusCode).send({ message: error.message });
    const e = error as Error & { code?: string; statusCode?: number };
    if (e.code?.startsWith('SQLITE_CONSTRAINT') || e.message?.includes('UNIQUE constraint'))
      return reply.code(409).send({ message: '记录冲突，可能存在重复序列号或绑定' });
    if (e.statusCode && e.statusCode < 500)
      return reply.code(e.statusCode).send({ message: e.message });
    return reply
      .code(500)
      .send({ message: '操作失败；数据未确认时不会扣减库存。请检查服务配置。' });
  });
  app.register(multipart, { limits: { fileSize: 32 * 1024 * 1024, files: 1, fields: 5 } });
  app.get('/api/health', async () => ({ status: 'ok', version: '0.1.0' }));
  app.get('/api/overview', async () => ({
    spools: store.spools(),
    jobs: store.jobs(),
    printers: store.printers(),
    transactions: store.transactions(),
    sync: syncState(),
    settings: store.preferences(),
  }));
  app.get('/api/spools', async () => store.spools());
  app.post('/api/spools', async (req, reply) => reply.code(201).send(store.addSpools(req.body)));
  app.put<{ Params: { id: string } }>('/api/spools/:id', async (req) =>
    store.editSpool(req.params.id, req.body),
  );
  app.post<{ Params: { id: string } }>('/api/spools/:id/calibrate', async (req) =>
    store.calibrate(req.params.id, req.body),
  );
  app.post<{ Params: { id: string } }>('/api/spools/:id/cloud-decision', async (req) =>
    store.decideCloudSpool(req.params.id, req.body),
  );
  app.get('/api/jobs', async () => store.jobs());
  app.post('/api/jobs', async (req, reply) => reply.code(201).send(store.addJob(req.body).job));
  app.post<{ Params: { id: string } }>('/api/jobs/:id/review', async (req) =>
    store.review(req.params.id, req.body),
  );
  app.post<{ Params: { id: string } }>('/api/jobs/:id/undo', async (req) =>
    store.undo(req.params.id, req.body),
  );
  app.patch<{ Params: { id: string } }>('/api/jobs/:id', async (req) =>
    store.setJobStatus(req.params.id, req.body),
  );
  app.post<{ Params: { id: string } }>('/api/jobs/:id/duplicate', async (req) => {
    const old = store.job(req.params.id);
    return store.addJob({
      ...old,
      name: `${old.name} · 再次打印`,
      startedAt: null,
      finishedAt: null,
      printStatus: 'unknown',
      notes: '用户明确创建新一次打印；沿用建议用量，仍须人工核对。',
      materials: old.materials.map((m) => ({ ...m, source: m.source })),
    }).job;
  });
  app.post('/api/import/3mf', async (req, reply) => {
    const file = await req.file();
    if (!file || !file.filename.toLowerCase().endsWith('.3mf'))
      throw new DomainError('请选择 .3mf 切片文件');
    const buffer = await file.toBuffer();
    let jobs;
    try {
      jobs = await parse3mf(buffer, file.filename);
    } catch (e) {
      throw new DomainError((e as Error).message);
    }
    const printerId =
      typeof (file.fields.printerId as any)?.value === 'string'
        ? (file.fields.printerId as any).value
        : null;
    let created = 0;
    const imported = [];
    for (const job of jobs) {
      const result = store.addJob(
        { ...job, printerId: printerId || null },
        'three_mf',
        job.externalId,
        job.externalDeviceId,
      );
      if (result.created) created++;
      imported.push(result.job);
    }
    return reply.send({ created, duplicates: jobs.length - created, jobs: imported });
  });
  app.get('/api/printers', async () => store.printers());
  app.post('/api/printers', async (req) => store.addPrinter(req.body));
  app.put<{ Params: { id: string } }>('/api/printers/:id', async (req) =>
    store.editPrinter(req.params.id, req.body),
  );
  app.post<{ Params: { id: string } }>('/api/printers/:id/slots', async (req) =>
    store.addSlot(req.params.id, req.body),
  );
  app.put<{ Params: { id: string } }>('/api/slots/:id/assignment', async (req) =>
    store.assign(req.params.id, req.body),
  );
  app.get('/api/assignments', async () => store.assignments());
  app.get('/api/transactions', async () => store.transactions());
  app.put('/api/settings', async (req) => store.setPreferences(req.body));
  app.get('/api/sync', async () => syncState());
  app.post('/api/integration/enable', async (req) => {
    const body = z.object({ acknowledgeExperimental: z.literal(true) }).parse(req.body);
    if (!options.experimental || !adapter.configured)
      throw new DomainError(
        '请先在服务环境中设置 BAMBU_EXPERIMENTAL=true 和 BAMBU_ACCESS_TOKEN，再重启服务',
      );
    db.run("UPDATE integration_config SET enabled=1 WHERE id='bambu_cloud'");
    db.run("UPDATE sync_state SET status='ready',error=NULL WHERE id='bambu_cloud'");
    return syncState();
  });
  app.post('/api/integration/disconnect', async () => {
    if (syncing) throw new DomainError('同步进行中，请结束后断开', 409);
    adapter.disconnect();
    db.run("UPDATE integration_config SET enabled=0 WHERE id='bambu_cloud'");
    db.run("UPDATE sync_state SET status='unavailable',error=NULL WHERE id='bambu_cloud'");
    return syncState();
  });
  app.post('/api/sync', async (req) => {
    const input = z.object({ resume: z.boolean().default(false) }).parse(req.body ?? {});
    const state = syncState();
    if (!state.enabled || !state.configured)
      throw new DomainError('拓竹云端尚未启用。可先使用 3MF 导入或手动添加任务。', 409);
    if (syncing) throw new DomainError('已有同步正在进行', 409);
    syncing = true;
    let offset = input.resume ? Number(state.cursor || 0) : 0;
    let created = 0,
      duplicates = 0;
    const warnings: string[] = [];
    db.run(
      "UPDATE sync_state SET status='syncing',last_attempt_at=?,error=NULL WHERE id='bambu_cloud'",
      new Date().toISOString(),
    );
    try {
      const seenPages = new Set<string>();
      for (let page = 0; page < 5; page++) {
        const result = await adapter.history(offset);
        const fingerprint = result.jobs
          .map((j) => `${j.externalDeviceId}:${j.externalId}`)
          .join('|');
        if (fingerprint && seenPages.has(fingerprint)) throw new Error('云端返回重复分页，已停止');
        seenPages.add(fingerprint);
        warnings.push(...result.warnings);
        for (const job of result.jobs) {
          const printer = db.one<any>(
            'SELECT id FROM printer WHERE serial=?',
            job.externalDeviceId,
          );
          const saved = store.addJob(
            { ...job, printerId: printer?.id ?? null },
            'bambu_cloud',
            job.externalId,
            job.externalDeviceId,
            job.thumbnail,
          );
          saved.created ? created++ : duplicates++;
          if (printer)
            db.run(
              'UPDATE printer SET last_sync_at=? WHERE id=?',
              new Date().toISOString(),
              printer.id,
            );
        }
        const cursor = result.nextOffset;
        db.run(
          "UPDATE sync_state SET cursor=? WHERE id='bambu_cloud'",
          cursor === null ? null : String(cursor),
        );
        if (cursor === null) break;
        offset = cursor;
      }
      const partial = !!store.syncState().cursor || warnings.length > 0;
      db.run(
        "UPDATE sync_state SET status=?,last_success_at=?,error=? WHERE id='bambu_cloud'",
        partial ? 'partial' : 'success',
        new Date().toISOString(),
        warnings.length ? warnings.join('；') : null,
      );
      return { created, duplicates, warnings, state: syncState() };
    } catch (e) {
      const message = (e as Error).message;
      const safe = message.includes('认证')
        ? '认证失效，请重新配置令牌'
        : message.includes('HTTP')
          ? message
          : '云端请求失败或响应格式不兼容，请检查网络与授权';
      db.run(
        "UPDATE sync_state SET status=?,error=? WHERE id='bambu_cloud'",
        message.includes('认证') ? 'auth_expired' : created ? 'partial' : 'failed',
        safe,
      );
      throw new DomainError(safe, 502);
    } finally {
      syncing = false;
    }
  });
  app.post('/api/sync/spools', async () => {
    const state = syncState();
    if (!state.enabled || !state.configured)
      throw new DomainError('拓竹云端尚未启用；CSV 与手动录入仍可正常使用。', 409);
    if (syncing) throw new DomainError('已有同步正在进行', 409);
    syncing = true;
    try {
      const result = await adapter.filament();
      const summary = store.syncCloudSpools(result.spools);
      return { ...summary, warnings: [...result.warnings, ...summary.warnings] };
    } catch (e) {
      const message = (e as Error).message;
      throw new DomainError(
        message.includes('认证')
          ? '认证失效，请重新配置令牌；未更改任何库存'
          : message.includes('HTTP')
            ? message
            : '云端请求失败或响应格式不兼容，未更改任何库存',
        502,
      );
    } finally {
      syncing = false;
    }
  });
  app.get('/api/export/spools.csv', async (req, reply) => {
    const rows = store.spools().map((s) => ({
      spoolId: s.id,
      brand: s.product.brand,
      productName: s.product.name,
      material: s.product.material,
      subtype: s.product.subtype,
      colorName: s.product.colorName,
      colorHex: s.product.colorHex,
      colorCode: s.product.colorCode,
      netG: s.product.netMg / 1000,
      remainingG: s.remainingMg / 1000,
      emptyG: s.emptyMg === null ? '' : s.emptyMg / 1000,
      price: s.priceCents === null ? '' : s.priceCents / 100,
      purchasedAt: s.purchasedAt ?? '',
      openedAt: s.openedAt ?? '',
      location: s.location,
      status: s.status,
      notes: s.notes,
    }));
    const columns = [
      'spoolId',
      'brand',
      'productName',
      'material',
      'subtype',
      'colorName',
      'colorHex',
      'colorCode',
      'netG',
      'remainingG',
      'emptyG',
      'price',
      'purchasedAt',
      'openedAt',
      'location',
      'status',
      'notes',
    ];
    const safe = rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k,
          typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v,
        ]),
      ),
    );
    return reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="spoolnest-spools.csv"')
      .send('\uFEFF' + stringify(safe, { header: true, columns }));
  });
  app.post('/api/import/csv', async (req) => {
    const file = await req.file();
    if (!file) throw new DomainError('请选择 CSV 文件');
    const content = await file.toBuffer();
    if (content.length > 2 * 1024 * 1024) throw new DomainError('CSV 超过 2MB');
    let rows: any[];
    try {
      rows = parse(content, {
        columns: true,
        bom: true,
        skip_empty_lines: true,
        max_record_size: 10000,
      });
    } catch {
      throw new DomainError('CSV 格式不正确');
    }
    if (rows.some((r) => r.spoolId))
      throw new DomainError(
        '检测到已有料卷 ID。CSV 仅新增；为避免重复库存，请先移除 spoolId 列并确认这是新料卷。数据库恢复请使用备份恢复命令。',
      );
    const numeric = (s: any) => (s === '' || s === undefined ? null : Number(s));
    const inputs = rows.map((r) => ({
      product: {
        brand: r.brand,
        name: r.productName,
        material: r.material,
        subtype: r.subtype || '',
        colorName: r.colorName || '',
        colorHex: r.colorHex,
        colorCode: r.colorCode || '',
        netMg: Math.round(Number(r.netG) * 1000),
      },
      remainingMg: Math.round(Number(r.remainingG) * 1000),
      emptyMg: numeric(r.emptyG) === null ? null : Math.round(Number(r.emptyG) * 1000),
      priceCents: numeric(r.price) === null ? null : Math.round(Number(r.price) * 100),
      purchasedAt: r.purchasedAt || null,
      openedAt: r.openedAt || null,
      location: r.location || '',
      status: r.status || 'opened',
      notes: r.notes || '',
    }));
    return { created: store.importSpools(inputs).length };
  });
  app.get('/api/backup', async (req, reply) => {
    const dir = await mkdtemp(join(tmpdir(), 'spoolnest-backup-'));
    const path = join(dir, 'backup.db');
    try {
      await backup(db.raw, path);
      const data = await readFile(path);
      return reply
        .type('application/octet-stream')
        .header(
          'Content-Disposition',
          `attachment; filename="spoolnest-${new Date().toISOString().slice(0, 10)}.db"`,
        )
        .send(data);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  if (options.serveStatic !== false && existsSync(resolve('dist/web/index.html'))) {
    app.register(staticFiles, { root: resolve('dist/web') });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/')
        ? reply.code(404).send({ message: '接口不存在' })
        : reply.sendFile('index.html'),
    );
  }
  return { app, db, store };
}
