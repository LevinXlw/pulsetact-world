import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { FIXED_ACCOUNT } from './auth-credentials.mjs';

const COOKIE = 'pulsetact_session';
const ATTEMPT_WINDOW = 15 * 60 * 1000;
const digest = value => createHash('sha256').update(value).digest();
const fail = (status, message) => Object.assign(new Error(message), { status });

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}

function sameOrigin(request) {
  if (request.headers['sec-fetch-site'] === 'cross-site') throw fail(403, '请从当前网站登录。');
  if (!request.headers.origin) return;
  let origin;
  try { origin = new URL(request.headers.origin); } catch { throw fail(403, '请求来源无效。'); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== request.headers.host) throw fail(403, '请从当前网站登录。');
}

function readBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw fail(415, '请使用 JSON 请求。');
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    request.on('data', chunk => {
      size += chunk.length;
      if (rejected) return;
      if (size > 8192) { rejected = true; chunks.length = 0; reject(fail(413, '登录请求过大。')); return; }
      chunks.push(chunk);
    });
    request.on('error', reject);
    request.on('end', () => {
      if (rejected) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
        resolve(body);
      } catch { reject(fail(400, '登录请求格式不正确。')); }
    });
  });
}

/** Single fixed account with revocable, opaque, server-held sessions. */
export function createAuthService({ sessionTtlMs = 8 * 60 * 60 * 1000, now = Date.now } = {}) {
  const sessions = new Map();
  const attempts = new Map();
  const expectedUser = digest(FIXED_ACCOUNT.username);
  const expectedPassword = digest(FIXED_ACCOUNT.password);
  const keyFor = token => digest(token).toString('hex');
  function tokenFor(request) {
    const value = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  }
  function prune() {
    const time = now();
    for (const [key, session] of sessions) if (session.expiresAt <= time) sessions.delete(key);
    for (const [key, attempt] of attempts) if (attempt.until <= time) attempts.delete(key);
  }
  function sessionFor(request) {
    const token = tokenFor(request);
    const session = token ? sessions.get(keyFor(token)) : null;
    if (session && session.expiresAt > now()) return session;
    if (token) sessions.delete(keyFor(token));
    return null;
  }
  function cookie(request, response, value, maxAge) {
    // Explicit AUTH_SECURE_COOKIE=1 supports HTTPS behind a trusted reverse proxy.
    const secure = request.socket.encrypted || process.env.AUTH_SECURE_COOKIE === '1';
    response.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
  }
  function revoke(request) {
    const token = tokenFor(request);
    if (token) sessions.delete(keyFor(token));
  }
  function identity(session) {
    return { authenticated: true, user: { username: FIXED_ACCOUNT.username }, expiresAt: session.expiresAt };
  }
  function attemptFor(address, response) {
    const attempt = attempts.get(address);
    if (attempt?.until <= now()) { attempts.delete(address); return undefined; }
    if (attempt && attempt.count >= 10) {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil((attempt.until - now()) / 1000))));
      throw fail(429, '尝试次数过多，请 15 分钟后再试。');
    }
    return attempt;
  }
  async function handle(request, response, next) {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (!pathname.startsWith('/api/auth/')) return next ? next() : json(response, 404, { error: '请求不存在。' });
    prune();
    if (pathname === '/api/auth/session' && request.method === 'GET') {
      const session = sessionFor(request);
      return json(response, session ? 200 : 401, session ? identity(session) : { authenticated: false });
    }
    if (!['/api/auth/login', '/api/auth/logout'].includes(pathname)) return json(response, 404, { error: '请求不存在。' });
    if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); throw fail(405, '请使用 POST 请求。'); }
    sameOrigin(request);
    if (pathname === '/api/auth/logout') {
      revoke(request);
      cookie(request, response, '', 0);
      return json(response, 200, { ok: true });
    }
    const address = request.socket.remoteAddress ?? 'local';
    attemptFor(address, response);
    const body = await readBody(request);
    // Re-read after receiving the body so concurrent requests cannot share an old counter.
    const attempt = attemptFor(address, response);
    const username = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const userMatches = timingSafeEqual(digest(username), expectedUser);
    const passwordMatches = timingSafeEqual(digest(password), expectedPassword);
    if (!userMatches || !passwordMatches) {
      attempts.set(address, { count: (attempt?.count ?? 0) + 1, until: attempt?.until ?? now() + ATTEMPT_WINDOW });
      throw fail(401, '账号或密码不正确。');
    }
    attempts.delete(address);
    revoke(request);
    // Limit retained sessions in this intentionally small single-account service.
    if (sessions.size >= 256) sessions.delete(sessions.keys().next().value);
    const token = randomBytes(32).toString('base64url');
    const session = { expiresAt: now() + sessionTtlMs };
    sessions.set(keyFor(token), session);
    cookie(request, response, token, Math.ceil(sessionTtlMs / 1000));
    return json(response, 200, identity(session));
  }
  return {
    handler(request, response, next) {
      void handle(request, response, next).catch(error => {
        if (response.headersSent) return response.end();
        json(response, error.status ?? 500, { error: error.status ? error.message : '登录服务暂时不可用，请稍后重试。' });
      });
    },
    requireSession(request, response, next) {
      if (!sessionFor(request)) return json(response, 401, { authenticated: false, error: '请先登录。' });
      return next ? next() : json(response, 200, identity(sessionFor(request)));
    },
    close() { sessions.clear(); attempts.clear(); },
  };
}
