import { describe, expect, it, vi } from 'vitest';
import worker, { type WorkerEnvironment } from '../worker/index.mjs';

function environment(signedIn = false) {
  const assets = vi.fn(async (_request: Request) => new Response('asset', { headers: { 'Content-Type': 'application/octet-stream' } }));
  const auth = vi.fn(async (_request: Request) => Response.json({ authenticated: signedIn }, { status: signedIn ? 200 : 401 }));
  const env: WorkerEnvironment = { ASSETS: { fetch: assets }, AUTH_STORE: { idFromName: name => name, get: () => ({ fetch: auth }) } };
  return { env, assets, auth };
}

describe('Cloudflare release boundary', () => {
  it('checks encoded and normalized model paths before requesting any asset', async () => {
    const { env, assets } = environment();
    for (const path of ['/data/campuses/mit/campus.glb', '/%64ata/campuses/mit/campus.glb', '/%2Fdata/campuses/mit/campus.glb', '/assets/%63haracters/pixiv/character.glb', '/assets/people/nathan.glb', '/assets/bu-cds-interior/manifest.json', '/assets/bu-cds-interior/interior-desktop.glb', '/assets/bu-cds-interior/interior-mobile.glb', '/assets/bu-cds-interior/physics.glb', '/assets/%62u-cds-interior/physics.glb']) {
      expect((await worker.fetch(new Request(`https://world.pulsetact.ai${path}`), env)).status).toBe(401);
    }
    expect(assets).not.toHaveBeenCalled();
  });

  it('serves CDS room assets after login with private caching', async () => {
    const { env, assets, auth } = environment(true);
    const response = await worker.fetch(new Request('https://world.pulsetact.ai/assets/bu-cds-interior/interior-mobile.glb', { headers: { Cookie: 'pulsetact_session=test' } }), env);
    expect(response.status).toBe(200);
    expect(auth.mock.calls[0][0].headers.get('Cookie')).toBe('pulsetact_session=test');
    expect(assets).toHaveBeenCalledTimes(1);
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=3600');
  });

  it('serves the legacy oversized model URL from gzip only after session validation', async () => {
    const { env, assets, auth } = environment(true);
    const response = await worker.fetch(new Request('https://world.pulsetact.ai/data/killian/detail.glb', { headers: { Cookie: 'pulsetact_session=test' } }), env);
    expect(response.status).toBe(200);
    expect(auth.mock.calls[0][0].url).toBe('https://world.pulsetact.ai/api/auth/session');
    expect(auth.mock.calls[0][0].headers.get('Cookie')).toBe('pulsetact_session=test');
    expect(assets.mock.calls[0][0].url).toBe('https://world.pulsetact.ai/data/killian/detail.glb.gz');
    expect(response.headers.get('Content-Encoding')).toBe('gzip');
    expect(response.headers.get('Cache-Control')).toContain('private');
  });

  it('serves the login bundle while keeping source and malformed paths unavailable', async () => {
    const { env, assets, auth } = environment();
    expect((await worker.fetch(new Request('https://world.pulsetact.ai/assets/index.js'), env)).status).toBe(200);
    expect(auth).not.toHaveBeenCalled();
    expect(assets).toHaveBeenCalledTimes(1);
    for (const path of ['/server/auth-credentials.mjs', '/%73erver/auth-credentials.mjs', '/worker/auth.mjs']) {
      expect((await worker.fetch(new Request(`https://world.pulsetact.ai${path}`), env)).status).toBe(404);
    }
    expect((await worker.fetch(new Request('https://world.pulsetact.ai/%zz'), env)).status).toBe(400);
    expect(assets).toHaveBeenCalledTimes(1);
  });
});
