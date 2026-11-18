export interface AccessOptions {
  ACCESS_TEAM_URL?: string;
  ACCESS_AUD?: string;
  ACCESS_EMAIL?: string;
}

const decode = (text: string) =>
  Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (char) =>
    char.charCodeAt(0),
  );
const readJson = <T>(text: string) => JSON.parse(new TextDecoder().decode(decode(text))) as T;

export async function isAuthorized(request: Request, env: AccessOptions): Promise<boolean> {
  const issuer = env.ACCESS_TEAM_URL;
  const audience = env.ACCESS_AUD;
  const email = env.ACCESS_EMAIL?.toLowerCase();
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (
    !issuer ||
    !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) ||
    !audience ||
    !email ||
    !token
  )
    return false;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [header, payload, signature] = parts;
    const { alg, kid } = readJson<{ alg?: string; kid?: string }>(header);
    const claims = readJson<{
      iss?: string;
      aud?: string[];
      exp?: number;
      nbf?: number;
      email?: string;
    }>(payload);
    const now = Math.floor(Date.now() / 1000);
    if (
      alg !== 'RS256' ||
      !kid ||
      claims.iss !== issuer ||
      !Array.isArray(claims.aud) ||
      !claims.aud.includes(audience) ||
      typeof claims.exp !== 'number' ||
      claims.exp <= now ||
      (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now)) ||
      typeof claims.email !== 'string' ||
      claims.email.toLowerCase() !== email
    )
      return false;

    const response = await fetch(`${issuer}/cdn-cgi/access/certs`, { redirect: 'manual' });
    if (!response.ok) return false;
    const { keys } = (await response.json()) as { keys: (JsonWebKey & { kid?: string })[] };
    const jwk = keys.find((key) => key.kid === kid && key.kty === 'RSA');
    if (!jwk) return false;
    const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
    const key = await crypto.subtle.importKey('jwk', jwk, algorithm, false, ['verify']);
    return await crypto.subtle.verify(
      algorithm,
      key,
      decode(signature),
      new TextEncoder().encode(`${header}.${payload}`),
    );
  } catch {
    return false;
  }
}
