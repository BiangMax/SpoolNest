declare module 'cloudflare:workers' {
  export interface WorkspaceDurableState {
    readonly storage: import('./storage').DurableSqlStorage;
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  }

  export class DurableObject<Env> {
    constructor(ctx: WorkspaceDurableState, env: Env);
  }
}

declare module 'cloudflare:node' {
  export function httpServerHandler(server: import('node:http').Server): {
    fetch(request: Request): Promise<Response>;
  };
}
