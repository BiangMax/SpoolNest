type PagesEnvironment = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  BACKEND?: { fetch(request: Request): Promise<Response> };
};

export default {
  async fetch(request: Request, env: PagesEnvironment): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname !== 'spoolnest.pages.dev') {
      return new Response('请使用 spoolnest.pages.dev', { status: 404 });
    }
    if (url.pathname.startsWith('/api/')) {
      if (!env.BACKEND) {
        return Response.json({ message: '工作空间服务尚未配置' }, { status: 503 });
      }
      return env.BACKEND.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
