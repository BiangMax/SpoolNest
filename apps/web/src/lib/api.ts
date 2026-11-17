let token = '';
export function setToken(value: string) {
  token = value;
}
export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`/api${path}`, { ...options, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: '网络请求失败' }));
    const e = new Error(error.message || '请求失败') as Error & { status: number };
    e.status = response.status;
    throw e;
  }
  return response.json();
}
export const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });
export async function download(path: string, filename: string) {
  const response = await fetch(`/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error('下载失败，请检查访问令牌');
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
