import { DurableObject, type WorkspaceDurableState } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { createStorageApp } from '../server/src/app';
import { isAuthorized, type AccessOptions } from './access';
import { readMigration } from './schema';
import { DurableDatabase } from './storage';

const productionOrigin = 'https://spoolnest.pages.dev';
const privateHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
type BackendEnvironment = AccessOptions & {
  WORKSPACE: {
    getByName(name: string): {
      serve(request: Request): Promise<Response>;
      verifyBackup(source: string): Promise<ReturnType<DurableDatabase['verify']>>;
    };
  };
  BAMBU_ACCESS_TOKEN?: string;
  BAMBU_REGION?: 'cn' | 'global';
  BAMBU_EXPERIMENTAL?: string;
};

export class Workspace extends DurableObject<BackendEnvironment> {
  private db!: DurableDatabase;
  private handler!: ReturnType<typeof httpServerHandler>;

  constructor(state: WorkspaceDurableState, env: BackendEnvironment) {
    super(state, env);
    void state.blockConcurrencyWhile(async () => {
      const db = new DurableDatabase(state.storage, readMigration);
      this.db = db;
      const { app } = createStorageApp(
        {
          publicOrigin: productionOrigin,
          serveStatic: false,
          backupFormat: 'sql',
          recovery: {
            verify: (source) =>
              env.WORKSPACE.getByName('spoolnest-backup-verifier').verifyBackup(source),
            counts: () => db.counts(),
            fingerprint: () => db.fingerprint(),
            restore: (source, stamp) => db.restore(source, stamp),
            hasPreviousBackup: () => db.hasPreviousBackup(),
            previousBackup: () => db.previousBackup(),
          },
          bambuToken: env.BAMBU_ACCESS_TOKEN,
          region: env.BAMBU_REGION,
          experimental: env.BAMBU_EXPERIMENTAL === 'true',
        },
        db,
        async () => db.backup(),
      );
      await app.ready();
      this.handler = httpServerHandler(app.server);
    });
  }

  async verifyBackup(source: string) {
    return this.db.verify(source);
  }

  async serve(request: Request): Promise<Response> {
    const forwarded = new Request(request);
    forwarded.headers.delete('cf-access-jwt-assertion');
    forwarded.headers.delete('cookie');
    forwarded.headers.delete('authorization');
    return this.handler.fetch(forwarded);
  }
}

export default {
  async fetch(request: Request, env: BackendEnvironment): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin !== productionOrigin || !url.pathname.startsWith('/api/')) {
      return Response.json({ message: '接口不存在' }, { status: 404, headers: privateHeaders });
    }
    if (!(await isAuthorized(request, env))) {
      return Response.json(
        { message: '请先登录工作空间' },
        { status: 403, headers: privateHeaders },
      );
    }
    return env.WORKSPACE.getByName('spoolnest-owner').serve(request);
  },
};
