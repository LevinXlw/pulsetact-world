import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
// Release scripts are Node-only modules, not part of the application TS build.
// @ts-expect-error Node script has no TypeScript declaration
import { CLOUDFLARE_ASSET_LIMIT, GZIP_ASSET_PATHS, prepareCloudflare } from '../scripts/prepare-cloudflare.mjs';
// @ts-expect-error Node script has no TypeScript declaration
import { BOSTON_GZIP_RELEASE_PATHS, BU_RELEASE_DESTINATIONS, readReleaseAsset } from '../scripts/check-release-bu.mjs';
import { WORLD_DESTINATIONS } from '../src/features/world/world-destinations';

const roots: string[] = [];
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pulsetact-gzip-')); roots.push(root);
  const originals = new Map<string, Buffer>();
  for (const path of GZIP_ASSET_PATHS as string[]) {
    const raw = path === 'data/mobile/boston.glb' ? Buffer.alloc(CLOUDFLARE_ASSET_LIMIT + 1024, 17) : Buffer.from(`glTF lossless ${path}`);
    const target = join(root, 'dist', path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, raw);
    await writeFile(target + '.gz', gzipSync(Buffer.from('stale gzip must not ship')));
    originals.set(path, raw);
  }
  await writeFile(join(root, 'dist/index.html'), '<!doctype html><title>fixture</title>');
  await writeFile(join(root, 'dist/data/killian/vegetation.glb'), 'unused vegetation');
  return { root, originals };
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('Cloudflare gzip staging and release integrity', () => {
  it('stages every mapped model below the limit with exact original hashes and fresh gzip', async () => {
    const { root, originals } = await fixture(), manifest = await prepareCloudflare(root);
    expect(manifest.gzip).toHaveLength(4);
    for (const [path, raw] of originals) {
      const staged = await readFile(join(root, 'dist-cloud', path + '.gz'));
      expect(staged.length).toBeLessThan(CLOUDFLARE_ASSET_LIMIT);
      expect(hash(gunzipSync(staged))).toBe(hash(raw));
      expect(manifest.gzip.find((entry: { url: string }) => entry.url === '/' + path)).toMatchObject({ rawBytes: raw.length, rawSha256: hash(raw), gzipSha256: hash(staged), bytes: staged.length });
      expect((await readReleaseAsset(join(root, 'dist-cloud'), '/' + path)).equals(raw)).toBe(true);
      await expect(stat(join(root, 'dist-cloud', path))).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await readFile(join(root, 'dist', path))).equals(raw)).toBe(true);
    }
    await expect(stat(join(root, 'dist-cloud/data/killian/vegetation.glb'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(String(await readReleaseAsset(join(root, 'dist-cloud'), '/index.html'))).toContain('<!doctype html>');
    const repeated = await prepareCloudflare(root); expect(repeated.gzip).toEqual(manifest.gzip);
  });
  it('requires each raw model, rejecting stale gzip-only inputs before replacing staging', async () => {
    const { root } = await fixture();
    await mkdir(join(root, 'dist-cloud')); await writeFile(join(root, 'dist-cloud/previous-release'), 'keep');
    await rm(join(root, 'dist', GZIP_ASSET_PATHS[2]));
    await expect(prepareCloudflare(root)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(String(await readFile(join(root, 'dist-cloud/previous-release')))).toBe('keep');
  });
  it('does not silently gzip unrelated oversized assets', async () => {
    const { root } = await fixture();
    await writeFile(join(root, 'dist/unmapped.glb'), Buffer.alloc(CLOUDFLARE_ASSET_LIMIT + 1));
    await expect(prepareCloudflare(root)).rejects.toThrow('Cloudflare asset too large: unmapped.glb');
  });
  it('rejects escaping paths and never treats arbitrary gzip files as logical assets', async () => {
    const { root } = await fixture();
    await expect(readReleaseAsset(root, '/../outside')).rejects.toThrow('escaped');
    await expect(readReleaseAsset(root, '/..\\outside')).rejects.toThrow('escaped');
    await expect(readReleaseAsset(root, 'relative')).rejects.toThrow('escaped');
    await writeFile(join(root, 'unmapped.glb.gz'), gzipSync(Buffer.from('not mapped')));
    await expect(readReleaseAsset(root, '/unmapped.glb')).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('covers all three Boston URLs and actual Questrom/West map destinations while retaining Warren HD order', () => {
    expect(BOSTON_GZIP_RELEASE_PATHS).toEqual(['/data/mobile/boston.glb', '/assets/mit-stata/boston-without-stata.glb', '/assets/mit-residences/boston-without-residences.glb']);
    const destinations = BU_RELEASE_DESTINATIONS as [string, string][];
    for (const [id, title] of destinations) expect(WORLD_DESTINATIONS.find(point => point.id === id)?.title).toBe(title);
    expect(destinations.map(([id]) => id)).toEqual(expect.arrayContaining(['bu-mugar', 'bu-gsu', 'bu-warren', 'bu-questrom', 'bu-agganis', 'bu-nickerson']));
    expect(destinations.at(-1)?.[0]).toBe('bu-warren');
  });
});
