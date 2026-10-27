export { AuthStore } from './auth.mjs';

// Logical model URLs remain stable; staging emits lossless gzip bodies.
const GZIP_MODEL_PATHS = new Set([
  '/data/killian/detail.glb',
  '/data/mobile/boston.glb',
  '/assets/mit-stata/boston-without-stata.glb',
  '/assets/mit-residences/boston-without-residences.glb',
]);

function json(status, data) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
function authStore(env) {
  return env.AUTH_STORE.get(env.AUTH_STORE.idFromName('fixed-account-v1'));
}
async function authenticated(request, env) {
  const url = new URL(request.url);
  url.pathname = '/api/auth/session'; url.search = '';
  const response = await authStore(env).fetch(new Request(url, { headers: { Cookie: request.headers.get('Cookie') ?? '' } }));
  return response.ok;
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      let decoded;
      try { decoded = decodeURIComponent(url.pathname); } catch { return json(400, { error: '请求路径无效。' }); }
      // Authorize the same canonical path that the asset binding will receive.
      url.pathname = decoded.replaceAll('\\', '/').replace(/\/+/g, '/');
      const path = url.pathname;
      request = new Request(url, request);
      if (path.startsWith('/api/auth/')) return await authStore(env).fetch(request);
      if (path === '/api/health' && request.method === 'GET') return json(200, { ok: true, mode: 'solo', version: env.CF_VERSION_METADATA?.id ?? 'local' });
      // Source/config files are never part of the release and never get an SPA fallback.
      if (/^\/(?:server|worker|src|scripts|node_modules|@fs|\.git|\.env|\.world-data)(?:\/|\.|$)/i.test(path)) return json(404, { error: 'Not found' });
      const protectedResource = path.startsWith('/api/') || path.startsWith('/data/') || /^\/assets\/(?:people|characters|environment|bu-cds-interior)\//.test(path);
      if (protectedResource && !await authenticated(request, env)) return json(401, { authenticated: false, error: '请先登录。' });
      // Multiplayer is deliberately outside the currently shipped single-player experience.
      if (path.startsWith('/api/world/')) return json(503, { error: '当前版本为单人校园探索。' });
      if (path.startsWith('/api/')) return json(404, { error: '请求不存在。' });
      if (!['GET', 'HEAD'].includes(request.method)) return json(405, { error: '不支持的请求方式。' });

      const gzipModel = GZIP_MODEL_PATHS.has(path);
      if (gzipModel) url.pathname += '.gz';
      const asset = await env.ASSETS.fetch(gzipModel ? new Request(url, request) : request);
      const headers = new Headers(asset.headers);
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('X-Frame-Options', 'DENY');
      headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
      if (headers.get('Content-Type')?.includes('text/html')) headers.set('Cache-Control', 'no-store');
      else if (protectedResource) headers.set('Cache-Control', 'private, max-age=3600');
      if (gzipModel && (asset.ok || asset.status === 304) && !headers.get('Content-Type')?.includes('text/html')) {
        // Conditional headers and the asset ETag identify the same gzip representation.
        // HEAD and 304 retain its metadata without returning a body.
        headers.set('Content-Type', 'model/gltf-binary');
        headers.set('Content-Encoding', 'gzip');
        return new Response(request.method === 'HEAD' || asset.status === 304 ? null : asset.body, { status: asset.status, headers, encodeBody: 'manual' });
      }
      return new Response(asset.body, { status: asset.status, headers });
    } catch {
      return json(503, { error: '校园服务暂时不可用，请稍后重试。' });
    }
  },
};
