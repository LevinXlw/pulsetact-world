import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { FIXED_ACCOUNT } from '../server/auth-credentials.mjs';

const COOKIE = 'pulsetact_session';
const SESSION_TTL = 8 * 60 * 60 * 1000;
const ATTEMPT_WINDOW = 15 * 60 * 1000;
const digest = value => createHash('sha256').update(value).digest();
const keyFor = value => digest(value).toString('hex');
const expectedUser = digest(FIXED_ACCOUNT.username);
const expectedPassword = digest(FIXED_ACCOUNT.password);
// Changing the server-side fixed account also invalidates sessions from earlier deployments.
const accountRevision = keyFor(`${FIXED_ACCOUNT.username}\0${FIXED_ACCOUNT.password}`);
const fail = (status, message, headers = {}) => Object.assign(new Error(message), { status, headers });

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

function errorResponse(error) {
  return json(error.status ?? 500, { error: error.status ? error.message : '登录服务暂时不可用，请稍后重试。' }, error.headers);
}

function cookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function sessionKey(request) {
  const token = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? `session:${keyFor(token)}` : null;
}

function checkOrigin(request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw fail(403, '请从当前网站登录。');
  const value = request.headers.get('origin');
  if (!value) return;
  let origin;
  try { origin = new URL(value); } catch { throw fail(403, '请求来源无效。'); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== new URL(request.url).origin) throw fail(403, '请从当前网站登录。');
}

async function readBody(request, allowEmpty = false) {
  const isJson = /^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '');
  if (!allowEmpty && !isJson) throw fail(415, '请使用 JSON 请求。');
  if (Number(request.headers.get('content-length')) > 8192) throw fail(413, '登录请求过大。');
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) { await reader.cancel(); throw fail(413, '登录请求过大。'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  if (allowEmpty && size === 0) return null;
  if (!isJson) throw fail(415, '请使用 JSON 请求。');
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw fail(400, '登录请求格式不正确。'); }
}

function identity(session) {
  return { authenticated: true, user: { username: FIXED_ACCOUNT.username }, expiresAt: session.expiresAt };
}

/** One SQLite-backed Durable Object keeps revocation and rate limits consistent across edge isolates. */
export class AuthStore {
  constructor(ctx) { this.ctx = ctx; this.storage = ctx.storage; }

  async fetch(request) {
    try {
      const pathname = new URL(request.url).pathname;
      if (pathname === '/api/auth/session' && request.method === 'GET') {
        return this.serialized(() => this.getSession(request));
      }
      if (!['/api/auth/login', '/api/auth/logout'].includes(pathname)) return json(404, { error: '请求不存在。' });
      if (request.method !== 'POST') throw fail(405, '请使用 POST 请求。', { Allow: 'POST' });
      checkOrigin(request);
      if (pathname === '/api/auth/logout') {
        // Finish the forwarded upload before replying; Workerd otherwise keeps pumping its body.
        if (request.body) await readBody(request, true);
        return this.serialized(() => this.logout(request));
      }
      // Read the bounded body before locking the object, so slow uploads cannot block other sessions.
      const body = await readBody(request);
      return this.serialized(() => this.login(request, body));
    } catch (error) { return errorResponse(error); }
    finally {
      // Rejections before parsing (origin, method, content length) must also finish the body stream.
      if (request.body && !request.bodyUsed) {
        try { await request.body.cancel(); } catch { /* The peer may already have closed its upload. */ }
      }
    }
  }

  serialized(action) {
    // All reads and writes for a login/logout complete before another request can observe the state.
    return this.ctx.blockConcurrencyWhile(async () => {
      try { return await action(); } catch (error) { return errorResponse(error); }
    });
  }

  async getSession(request) {
    const key = sessionKey(request);
    const session = key ? await this.storage.get(key) : null;
    if (session && session.expiresAt > Date.now() && session.accountRevision === accountRevision) return json(200, identity(session));
    if (key && session) await this.storage.delete(key);
    return json(401, { authenticated: false });
  }

  async logout(request) {
    const key = sessionKey(request);
    if (key) await this.storage.delete(key);
    return json(200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
  }

  async login(request, body) {
    const now = Date.now();
    // CF-Connecting-IP is assigned by Cloudflare at ingress; the Worker forwards the original request.
    const attemptKey = `attempt:${keyFor(request.headers.get('cf-connecting-ip') ?? 'local')}`;
    let attempt = await this.storage.get(attemptKey);
    if (attempt?.until <= now) { await this.storage.delete(attemptKey); attempt = undefined; }
    if (attempt?.count >= 10) {
      throw fail(429, '尝试次数过多，请 15 分钟后再试。', { 'Retry-After': String(Math.max(1, Math.ceil((attempt.until - now) / 1000))) });
    }
    const userMatches = timingSafeEqual(digest(typeof body.username === 'string' ? body.username : ''), expectedUser);
    const passwordMatches = timingSafeEqual(digest(typeof body.password === 'string' ? body.password : ''), expectedPassword);
    if (!userMatches || !passwordMatches) {
      const next = { count: (attempt?.count ?? 0) + 1, until: attempt?.until ?? now + ATTEMPT_WINDOW };
      await this.storage.put(attemptKey, next);
      await this.scheduleCleanup(next.until);
      throw fail(401, '账号或密码不正确。');
    }
    await this.storage.delete(attemptKey);
    const previous = sessionKey(request);
    if (previous) await this.storage.delete(previous);
    const sessions = await this.storage.list({ prefix: 'session:' });
    for (const [key, session] of sessions) {
      if (session.expiresAt <= now) { await this.storage.delete(key); sessions.delete(key); }
    }
    if (sessions.size >= 256) {
      const oldest = [...sessions].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0][0];
      await this.storage.delete(oldest);
    }
    const token = randomBytes(32).toString('base64url');
    const session = { expiresAt: now + SESSION_TTL, accountRevision };
    await this.storage.put(`session:${keyFor(token)}`, session);
    await this.scheduleCleanup(session.expiresAt);
    return json(200, identity(session), { 'Set-Cookie': cookie(token, SESSION_TTL / 1000) });
  }

  async scheduleCleanup(at) {
    const scheduled = await this.storage.getAlarm();
    if (scheduled === null || scheduled > at) await this.storage.setAlarm(at);
  }

  async alarm() {
    await this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now();
      let next = Infinity;
      let startAfter;
      while (true) {
        const entries = await this.storage.list({ limit: 1000, ...(startAfter ? { startAfter } : {}) });
        for (const [key, value] of entries) {
          const until = value.expiresAt ?? value.until;
          if (until <= now) await this.storage.delete(key);
          else next = Math.min(next, until);
          startAfter = key;
        }
        if (entries.size < 1000) break;
      }
      if (Number.isFinite(next)) await this.storage.setAlarm(next);
    });
  }
}
