import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthStore, type AuthContext, type AuthStorage } from '../worker/auth.mjs';
import { FIXED_ACCOUNT } from '../server/auth-credentials.mjs';

const ORIGIN = 'https://world.pulsetact.ai';
const TTL = 8 * 60 * 60 * 1000;
let now: number;
let records: Map<string, unknown>;
let alarmAt: number | null;
let auth: AuthStore;

function restoreObject() {
  let queue: Promise<unknown> = Promise.resolve();
  const storage: AuthStorage = {
    async get(key) { return structuredClone(records.get(key)); },
    async put(key, value) { records.set(key, structuredClone(value)); },
    async delete(key) { return records.delete(key); },
    async list(options = {}) {
      return new Map([...records].sort(([a], [b]) => a.localeCompare(b)).filter(([key]) =>
        (!options.prefix || key.startsWith(options.prefix)) && (!options.startAfter || key > options.startAfter),
      ).slice(0, options.limit ?? Infinity).map(([key, value]) => [key, structuredClone(value)]));
    },
    async getAlarm() { return alarmAt; },
    async setAlarm(at) { alarmAt = at; },
  };
  const ctx: AuthContext = {
    storage,
    blockConcurrencyWhile<T>(callback: () => Promise<T>) {
      const result = queue.then(callback);
      queue = result.catch(() => {});
      return result;
    },
  };
  auth = new AuthStore(ctx);
}

function request(path: string, init: RequestInit = {}) {
  return auth.fetch(new Request(`${ORIGIN}${path}`, init));
}

function login(body: unknown = FIXED_ACCOUNT, headers: Record<string, string> = {}) {
  return request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': '192.0.2.10', ...headers },
    body: JSON.stringify(body),
  });
}

function cookie(response: Response) { return response.headers.get('set-cookie')!.split(';')[0]; }
function session(value: string) { return request('/api/auth/session', { headers: { Cookie: value } }); }

beforeEach(() => {
  now = Date.UTC(2026, 9, 15, 12);
  records = new Map();
  alarmAt = null;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  restoreObject();
});
afterEach(() => vi.restoreAllMocks());

describe('durable fixed-account authentication', () => {
  it('keeps a private, expiring session across isolate recreation while storing only the token hash', async () => {
    expect((await request('/api/auth/session')).status).toBe(401);
    const result = await login();
    expect(result.status).toBe(200);
    const value = cookie(result);
    const token = value.split('=')[1];
    expect(result.headers.get('set-cookie')).toMatch(/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800$/);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(await result.json()).toEqual({ authenticated: true, user: { username: 'tony' }, expiresAt: now + TTL });
    expect([...records.keys()]).toHaveLength(1);
    expect([...records.keys()][0]).toMatch(/^session:[a-f0-9]{64}$/);
    expect(JSON.stringify([...records])).not.toContain(token);
    expect(JSON.stringify([...records])).not.toContain(FIXED_ACCOUNT.password);
    restoreObject();
    expect((await session(value)).status).toBe(200);
    now += TTL;
    expect((await session(value)).status).toBe(401);
  });

  it('persists logout and rotation so replayed old cookies stay invalid after a new isolate starts', async () => {
    const original = cookie(await login());
    const replacement = cookie(await login(FIXED_ACCOUNT, { Cookie: original }));
    expect(replacement).not.toBe(original);
    restoreObject();
    expect((await session(original)).status).toBe(401);
    expect((await session(replacement)).status).toBe(200);
    const logout = await request('/api/auth/logout', { method: 'POST', headers: { Cookie: replacement, Origin: ORIGIN } });
    expect(logout.status).toBe(200);
    expect(logout.headers.get('set-cookie')).toMatch(/^pulsetact_session=;.*Max-Age=0$/);
    restoreObject();
    expect((await session(replacement)).status).toBe(401);
  });

  it('invalidates otherwise unexpired sessions saved under an older fixed account revision', async () => {
    const value = cookie(await login());
    const key = [...records.keys()][0];
    records.set(key, { ...(records.get(key) as object), accountRevision: 'previous-account-revision' });
    restoreObject();
    expect((await session(value)).status).toBe(401);
    expect(records.has(key)).toBe(false);
  });

  it('consumes forwarded logout bodies before responding and still accepts empty logout requests', async () => {
    const value = cookie(await login());
    const logout = new Request(`${ORIGIN}/api/auth/logout`, {
      method: 'POST', headers: { Cookie: value, Origin: ORIGIN, 'Content-Type': 'application/json' }, body: '{}',
    });
    expect((await auth.fetch(logout)).status).toBe(200);
    expect(logout.bodyUsed).toBe(true);
    expect((await session(value)).status).toBe(401);
    expect((await request('/api/auth/logout', { method: 'POST', body: '' })).status).toBe(200);
    expect((await request('/api/auth/logout', { method: 'POST' })).status).toBe(200);
    const rejected = new Request(`${ORIGIN}/api/auth/login`, {
      method: 'POST', headers: { Origin: 'https://unrelated.example', 'Content-Type': 'application/json' }, body: '{}',
    });
    expect((await auth.fetch(rejected)).status).toBe(403);
    expect(rejected.bodyUsed).toBe(true);
  });

  it('serializes concurrent failed attempts and persists per-IP lockouts without blocking another IP', async () => {
    const responses = await Promise.all(Array.from({ length: 12 }, () => login({ username: 'tony', password: 'wrong' })));
    expect(responses.filter(response => response.status === 401)).toHaveLength(10);
    expect(responses.filter(response => response.status === 429)).toHaveLength(2);
    restoreObject();
    const locked = await login();
    expect(locked.status).toBe(429);
    expect(locked.headers.get('retry-after')).toBe('900');
    expect((await login(FIXED_ACCOUNT, { 'CF-Connecting-IP': '192.0.2.11' })).status).toBe(200);
    now += 15 * 60 * 1000;
    expect((await login()).status).toBe(200);
  });

  it('rejects cross-origin writes, invalid method and malformed or oversized bodies', async () => {
    expect((await login(FIXED_ACCOUNT, { Origin: 'https://unrelated.example' })).status).toBe(403);
    expect((await login(FIXED_ACCOUNT, { Origin: 'http://world.pulsetact.ai' })).status).toBe(403);
    expect((await login(FIXED_ACCOUNT, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect((await request('/api/auth/logout', { method: 'GET' })).status).toBe(405);
    for (const body of ['{', 'null', '[]', '"tony"']) {
      expect((await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status).toBe(400);
    }
    expect((await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415);
    expect((await login({ username: 'tony', password: 'a'.repeat(8192) })).status).toBe(413);
    expect((await login()).status).toBe(200);
  });

  it('does not accept fabricated cookies or reveal which part of the credential is incorrect', async () => {
    const badUser = await login({ username: 'someone', password: FIXED_ACCOUNT.password });
    const badPass = await login({ username: 'tony', password: 'incorrect' });
    expect(badUser.status).toBe(401);
    expect(badPass.status).toBe(401);
    expect(await badUser.json()).toEqual(await badPass.json());
    expect((await session(`pulsetact_session=${'a'.repeat(43)}`)).status).toBe(401);
    expect((await session('pulsetact_session=malformed')).status).toBe(401);
  });

  it('caps retained sessions and cleans expired records through the durable alarm', async () => {
    for (let i = 0; i < 256; i++) records.set(`session:${i.toString(16).padStart(64, '0')}`, { expiresAt: now + i + 1 });
    const current = cookie(await login());
    expect([...records.keys()].filter(key => key.startsWith('session:'))).toHaveLength(256);
    expect(records.has(`session:${'0'.repeat(64)}`)).toBe(false);
    await login({ username: 'tony', password: 'wrong' });
    now += 15 * 60 * 1000;
    alarmAt = null; // The runtime removes a delivered alarm before calling its handler.
    await auth.alarm();
    expect(records.size).toBe(1);
    expect((await session(current)).status).toBe(200);
    expect(alarmAt).toBe(now - 15 * 60 * 1000 + TTL);
    now += TTL;
    alarmAt = null;
    await auth.alarm();
    expect(records.size).toBe(0);
    expect(alarmAt).toBeNull();
  });
});
