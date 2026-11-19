import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { isAuthorized } from '../apps/cloudflare/access';
import { DurableDatabase } from '../apps/cloudflare/storage';
import { Store } from '../apps/server/src/service';
import type { SqlValue } from '../apps/server/src/storage';

afterEach(() => vi.unstubAllGlobals());

it('requires an unexpired Access assertion signed for the intended app and owner', async () => {
  const env = {
    ACCESS_TEAM_URL: 'https://fixture.cloudflareaccess.com',
    ACCESS_AUD: 'fixture-audience',
    ACCESS_EMAIL: 'owner@example.com',
  };
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const fetchKeys = vi.fn(async () =>
    Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key' }] }),
  );
  vi.stubGlobal('fetch', fetchKeys);
  const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = segment({ alg: 'RS256', kid: 'test-key' });
  const payload = {
    iss: env.ACCESS_TEAM_URL,
    aud: [env.ACCESS_AUD],
    exp: Math.floor(Date.now() / 1000) + 60,
    email: env.ACCESS_EMAIL,
  };
  const request = (assertion?: string) =>
    new Request('https://spoolnest.pages.dev/api/overview', {
      headers: assertion ? { 'Cf-Access-Jwt-Assertion': assertion } : {},
    });
  const assertion = (claims: typeof payload) => {
    const data = `${header}.${segment(claims)}`;
    return `${data}.${sign('sha256', Buffer.from(data), privateKey).toString('base64url')}`;
  };

  expect(await isAuthorized(request(), env)).toBe(false);
  expect(
    await isAuthorized(request(assertion({ ...payload, email: 'other@example.com' })), env),
  ).toBe(false);
  expect(await isAuthorized(request(assertion({ ...payload, aud: ['other-app'] })), env)).toBe(
    false,
  );
  expect(await isAuthorized(request(assertion({ ...payload, exp: 0 })), env)).toBe(false);
  expect(await isAuthorized(request(assertion(payload)), {})).toBe(false);
  expect(fetchKeys).not.toHaveBeenCalled();
  const valid = assertion(payload);
  expect(await isAuthorized(request(valid), env)).toBe(true);
  const [first, second] = valid.split('.');
  expect(await isAuthorized(request(`${first}.${second}.AAAA`), env)).toBe(false);
});

it('exports a portable SQLite backup from the Durable Object storage adapter', () => {
  const source = new DatabaseSync(':memory:');
  source.exec('PRAGMA foreign_keys=ON');
  const db = new DurableDatabase(
    {
      sql: {
        exec(sql, ...args) {
          if (/^SELECT\b/i.test(sql.trim())) {
            return {
              toArray: () => source.prepare(sql).all(...args) as Record<string, SqlValue>[],
            };
          }
          if (args.length) source.prepare(sql).run(...args);
          else source.exec(sql);
          return { toArray: () => [] };
        },
      },
      transactionSync(fn) {
        source.exec('BEGIN');
        try {
          const result = fn();
          source.exec('COMMIT');
          return result;
        } catch (error) {
          source.exec('ROLLBACK');
          throw error;
        }
      },
    },
    (name) => readFileSync(new URL(`../apps/server/migrations/${name}`, import.meta.url), 'utf8'),
  );
  try {
    new Store(db).addSpools({
      product: {
        brand: "Test's",
        name: 'PLA',
        material: 'PLA',
        colorHex: '#ffffff',
        netMg: 1000000,
      },
      remainingMg: 800000,
    });
    expect(db.one('SELECT remaining_mg FROM spool')).toEqual({ remaining_mg: 800000 });
    expect(db.one('SELECT COUNT(*) AS n FROM inventory_transaction')).toEqual({ n: 1 });
    const notes = '备注\0打印';
    db.run('UPDATE spool SET notes=?', notes);
    const snapshot = db.backup().toString();
    const before = db.fingerprint();
    expect(db.verify(snapshot).counts).toEqual({ spools: 1, jobs: 0, transactions: 1 });
    expect(() => db.verify(snapshot.replace('COMMIT;', ''))).toThrow();
    expect(db.fingerprint()).toBe(before);
    db.run('UPDATE spool SET notes=?', 'updated');
    expect(() => db.restore(snapshot, before)).toThrow('重新验证');
    expect(db.hasPreviousBackup()).toBe(false);
    const updated = db.fingerprint();
    expect(() => db.restore(snapshot.replace('COMMIT;', ''), updated)).toThrow();
    expect(db.fingerprint()).toBe(updated);
    expect(db.hasPreviousBackup()).toBe(false);
    db.restore(snapshot, updated);
    expect(db.previousBackup().toString()).toContain("'updated'");
    expect(db.fingerprint()).toBe(before);
    expect(() => db.run('DELETE FROM inventory_transaction')).toThrow('append-only');
    const restored = new DatabaseSync(':memory:');
    try {
      restored.exec(db.backup().toString());
      expect(restored.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      expect(restored.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(restored.prepare('SELECT brand FROM filament_product').get()).toEqual({
        brand: "Test's",
      });
      expect(restored.prepare('SELECT hex(notes) AS notes, remaining_mg FROM spool').get()).toEqual(
        {
          notes: Buffer.from(notes).toString('hex').toUpperCase(),
          remaining_mg: 800000,
        },
      );
      expect(restored.prepare('SELECT COUNT(*) AS n FROM inventory_transaction').get()).toEqual({
        n: 1,
      });
    } finally {
      restored.close();
    }
  } finally {
    source.close();
  }
});
