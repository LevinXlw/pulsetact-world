import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type RequestListener, type Server } from 'node:http';
import { createAuthService } from '../server/auth-service.mjs';
import { createAppService } from '../server/app-service.mjs';
import { FIXED_ACCOUNT } from '../server/auth-credentials.mjs';

const EIGHT_HOURS = 8 * 60 * 60 * 1000;
let clock: number;
let server: Server;
let base: string;
let closeService: () => void | Promise<void>;

async function listen(handler: RequestListener) {
  server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a local HTTP server');
  base = `http://127.0.0.1:${address.port}`;
}

async function stop() {
  await closeService();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, init);
  return { status: response.status, headers: response.headers, data: await response.json() };
}

function login(body: unknown = FIXED_ACCOUNT, headers: Record<string, string> = {}) {
  return request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
}

function sessionCookie(headers: Headers) {
  const cookie = headers.get('set-cookie');
  expect(cookie).toBeTruthy();
  return cookie!.split(';')[0];
}

beforeEach(async () => {
  clock = Date.UTC(2026, 9, 15, 12);
  const auth = createAuthService({ now: () => clock });
  closeService = auth.close;
  await listen((req, res) => auth.handler(req, res, () => auth.requireSession(req, res, () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ protected: true }));
  })));
});

afterEach(stop);

describe('fixed account authentication over HTTP', () => {
  it('logs in with a private cookie and restores identity on refresh without exposing credentials', async () => {
    const anonymous = await request('/api/auth/session');
    expect(anonymous.status).toBe(401);
    expect(anonymous.data).toEqual({ authenticated: false });

    const result = await login(FIXED_ACCOUNT, { Origin: base });
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ authenticated: true, user: { username: 'tony' }, expiresAt: clock + EIGHT_HOURS });
    expect(result.headers.get('cache-control')).toBe('no-store');
    const cookieHeader = result.headers.get('set-cookie')!;
    expect(cookieHeader).toMatch(/^pulsetact_session=[^;]+;/);
    expect(cookieHeader).toMatch(/; HttpOnly(?:;|$)/);
    expect(cookieHeader).toMatch(/; SameSite=Lax(?:;|$)/);
    expect(cookieHeader).toMatch(/; Path=\/(?:;|$)/);
    expect(cookieHeader).toMatch(/; Max-Age=28800(?:;|$)/);
    const cookie = sessionCookie(result.headers);
    const token = cookie.slice(cookie.indexOf('=') + 1);
    expect(JSON.stringify(result.data)).not.toContain(FIXED_ACCOUNT.password);
    expect(JSON.stringify(result.data)).not.toContain(token);

    clock += 60_000;
    const restored = await request('/api/auth/session', { headers: { Cookie: cookie } });
    expect(restored.status).toBe(200);
    expect(restored.data).toEqual(result.data);
    expect(restored.headers.get('cache-control')).toBe('no-store');
    expect((await request('/api/private', { headers: { Cookie: cookie } })).data).toEqual({ protected: true });
  });

  it('rejects incorrect, missing and non-string credentials with the same generic error', async () => {
    const invalid = [
      { username: 'tony', password: 'incorrect' },
      { username: 'unknown', password: FIXED_ACCOUNT.password },
      { username: 'TONY', password: FIXED_ACCOUNT.password },
      {},
      { username: ['tony'], password: FIXED_ACCOUNT.password },
      { username: 'tony', password: 123456 },
    ];
    let error: unknown;
    for (const body of invalid) {
      const result = await login(body);
      expect(result.status).toBe(401);
      expect(result.headers.get('set-cookie')).toBeNull();
      if (error === undefined) error = result.data;
      expect(result.data).toEqual(error);
      expect(JSON.stringify(result.data)).not.toContain(FIXED_ACCOUNT.password);
    }
    expect((await request('/api/auth/session')).status).toBe(401);
  });

  it('rejects malformed, non-object, oversized and non-JSON login requests', async () => {
    for (const body of ['', '{', 'null', '[]', '"tony"']) {
      const result = await request('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      });
      expect(result.status).toBe(400);
      expect(result.headers.get('set-cookie')).toBeNull();
    }
    expect((await request('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(FIXED_ACCOUNT),
    })).status).toBe(415);
    expect((await login({ username: 'tony', password: 'a'.repeat(8192) })).status).toBe(413);
    expect((await login()).status).toBe(200);
  });

  it('protects APIs against missing, forged and expired sessions', async () => {
    for (const cookie of ['', 'pulsetact_session=invalid', `pulsetact_session=${'a'.repeat(43)}`]) {
      const result = await request('/api/private', { headers: { Cookie: cookie } });
      expect(result.status).toBe(401);
      expect(result.data.authenticated).toBe(false);
    }
    const result = await login();
    const cookie = sessionCookie(result.headers);
    clock += EIGHT_HOURS - 1;
    expect((await request('/api/private', { headers: { Cookie: cookie } })).status).toBe(200);
    clock += 1;
    expect((await request('/api/private', { headers: { Cookie: cookie } })).status).toBe(401);
    expect((await request('/api/auth/session', { headers: { Cookie: cookie } })).status).toBe(401);
  });

  it('revokes a session on logout so replaying the original cookie cannot restore it', async () => {
    const cookie = sessionCookie((await login()).headers);
    const loggedOut = await request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: base } });
    expect(loggedOut.status).toBe(200);
    expect(loggedOut.headers.get('set-cookie')).toMatch(/^pulsetact_session=;/);
    expect(loggedOut.headers.get('set-cookie')).toMatch(/; Max-Age=0(?:;|$)/);
    expect((await request('/api/auth/session', { headers: { Cookie: cookie } })).status).toBe(401);
    expect((await request('/api/private', { headers: { Cookie: cookie } })).status).toBe(401);
    expect((await request('/api/auth/logout', { method: 'POST' })).status).toBe(200);
  });

  it('rotates an existing browser session on login and revokes its previous cookie', async () => {
    const original = sessionCookie((await login()).headers);
    const replacement = sessionCookie((await login(FIXED_ACCOUNT, { Cookie: original })).headers);
    expect(replacement).not.toBe(original);
    expect((await request('/api/auth/session', { headers: { Cookie: original } })).status).toBe(401);
    expect((await request('/api/auth/session', { headers: { Cookie: replacement } })).status).toBe(200);
  });

  it('blocks cross-site login and logout without invalidating a legitimate session', async () => {
    const cookie = sessionCookie((await login()).headers);
    const crossSiteHeaders: Record<string, string>[] = [
      { Origin: 'https://unrelated.example' },
      { Origin: 'null' },
      { Origin: base, 'Sec-Fetch-Site': 'cross-site' },
    ];
    for (const headers of crossSiteHeaders) {
      expect((await login(FIXED_ACCOUNT, headers)).status).toBe(403);
      expect((await request('/api/auth/logout', { method: 'POST', headers: { ...headers, Cookie: cookie } })).status).toBe(403);
    }
    expect((await request('/api/auth/session', { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await login(FIXED_ACCOUNT, { Origin: base, 'Sec-Fetch-Site': 'same-origin' })).status).toBe(200);
  });

  it('rate limits repeated failures and permits login after the retry window', async () => {
    for (let attempt = 0; attempt < 10; attempt++) expect((await login({ username: 'tony', password: 'wrong' })).status).toBe(401);
    const blocked = await login();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(blocked.headers.get('set-cookie')).toBeNull();
    clock += 15 * 60 * 1000;
    expect((await login()).status).toBe(200);
  });

  it('gates the real application world API while leaving authentication reachable', async () => {
    await stop();
    const app = createAppService({ storagePath: null });
    closeService = () => app.close();
    await listen(app.handler);

    expect((await request('/api/world/health')).status).toBe(401);
    const cookie = sessionCookie((await login()).headers);
    const health = await request('/api/world/health', { headers: { Cookie: cookie } });
    expect(health.status).toBe(200);
    expect(health.data.ok).toBe(true);
    expect(health.data.online).toBe(0);
    await request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } });
    expect((await request('/api/world/health', { headers: { Cookie: cookie } })).status).toBe(401);
  });
});
