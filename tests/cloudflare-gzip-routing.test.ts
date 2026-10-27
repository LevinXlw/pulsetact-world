import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import worker, { type WorkerEnvironment } from '../worker/index.mjs';

const paths = ['/data/killian/detail.glb', '/data/mobile/boston.glb', '/assets/mit-stata/boston-without-stata.glb', '/assets/mit-residences/boston-without-residences.glb'];
const raw = Buffer.from('glTF\0original geometry and material bytes, unchanged');
const gzip = gzipSync(raw, { level: 9 });
const etag = `"${createHash('sha256').update(gzip).digest('hex')}"`;
const modified = 'Tue, 27 Oct 2026 10:00:00 GMT';
function fixture(signedIn = true) {
  const auth = vi.fn(async () => new Response(null, { status: signedIn ? 200 : 401 }));
  const assets = vi.fn(async (request: Request) => {
    const status = request.headers.get('If-None-Match') === etag ? 304 : 200;
    const headers: Record<string, string> = { ETag: etag, 'Cache-Control': 'public, max-age=0, must-revalidate', 'Last-Modified': modified, Vary: 'Accept-Encoding' };
    if (status === 200) Object.assign(headers, { 'Content-Type': 'application/gzip', 'Content-Length': String(gzip.length) });
    return new Response(status === 304 || request.method === 'HEAD' ? null : gzip, { status, headers });
  });
  const env: WorkerEnvironment = { ASSETS: { fetch: assets }, AUTH_STORE: { idFromName: name => name, get: () => ({ fetch: auth }) } };
  return { env, auth, assets };
}

describe('lossless Boston model gzip routing', () => {
  for (const path of paths) {
    it(`preserves bytes, logical auth boundary and GET/HEAD/304 cache identity: ${path}`, async () => {
      const { env, auth, assets } = fixture();
      const requestHeaders = { Cookie: 'pulsetact_session=test', 'Accept-Encoding': 'gzip' };
      const get = await worker.fetch(new Request(`https://world.pulsetact.ai${path}?revision=current`, { headers: requestHeaders }), env);
      expect(get.status).toBe(200);
      expect(Buffer.from(gunzipSync(Buffer.from(await get.arrayBuffer())))).toEqual(raw);
      const cache = path.startsWith('/data/') ? 'private, max-age=3600' : 'public, max-age=0, must-revalidate';
      const head = await worker.fetch(new Request(`https://world.pulsetact.ai${path}?revision=current`, { method: 'HEAD', headers: requestHeaders }), env);
      const conditional = await worker.fetch(new Request(`https://world.pulsetact.ai${path}?revision=current`, { headers: { ...requestHeaders, 'If-None-Match': etag } }), env);
      expect(head.status).toBe(200); expect(await head.text()).toBe('');
      expect(conditional.status).toBe(304); expect(await conditional.text()).toBe('');
      for (const response of [get, head, conditional]) {
        expect(response.headers.get('Content-Type')).toBe('model/gltf-binary');
        expect(response.headers.get('Content-Encoding')).toBe('gzip');
        expect(response.headers.get('ETag')).toBe(etag);
        expect(response.headers.get('Cache-Control')).toBe(cache);
        expect(response.headers.get('Last-Modified')).toBe(modified);
        expect(response.headers.get('Vary')).toBe('Accept-Encoding');
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      }
      expect(head.headers.get('Content-Length')).toBe(String(gzip.length));
      for (const [request] of assets.mock.calls) expect(request.url).toBe(`https://world.pulsetact.ai${path}.gz?revision=current`);
      expect(assets.mock.calls[1][0].method).toBe('HEAD');
      expect(assets.mock.calls[2][0].headers.get('If-None-Match')).toBe(etag);
      expect(auth).toHaveBeenCalledTimes(path.startsWith('/data/') ? 3 : 0);
    });
  }
  it('rejects anonymous fallback GET, HEAD and conditional requests before fetching gzip', async () => {
    const { env, assets } = fixture(false);
    for (const path of ['/data/mobile/boston.glb', '/%64ata/mobile/boston.glb', '/data/mobile/boston.glb.gz']) {
      for (const method of ['GET', 'HEAD']) expect((await worker.fetch(new Request(`https://world.pulsetact.ai${path}`, { method, headers: { 'If-None-Match': etag } }), env)).status).toBe(401);
    }
    expect(assets).not.toHaveBeenCalled();
  });
  it('keeps architectural replacement models public as before', async () => {
    const { env, auth } = fixture(false);
    for (const path of paths.filter(path => path.startsWith('/assets/'))) expect((await worker.fetch(new Request(`https://world.pulsetact.ai${path}`), env)).status).toBe(200);
    expect(auth).not.toHaveBeenCalled();
  });
  it('does not label an HTML fallback or a missing model as gzip', async () => {
    const { env } = fixture();
    for (const status of [200, 404]) {
      env.ASSETS.fetch = async () => new Response('missing asset', { status, headers: { 'Content-Type': 'text/html' } });
      const response = await worker.fetch(new Request('https://world.pulsetact.ai/data/mobile/boston.glb'), env);
      expect(response.status).toBe(status); expect(response.headers.get('Content-Encoding')).toBeNull();
      expect(response.headers.get('Cache-Control')).toBe('no-store'); expect(await response.text()).toBe('missing asset');
    }
  });
});
