import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

export const GZIP_ASSET_PATHS = [
  'data/killian/detail.glb',
  'data/mobile/boston.glb',
  'assets/mit-stata/boston-without-stata.glb',
  'assets/mit-residences/boston-without-residences.glb',
];
export const CLOUDFLARE_ASSET_LIMIT = 25 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Accept a fixture root for isolated tests; inputs and output names stay fixed.
export async function prepareCloudflare(root = resolve(fileURLToPath(new URL('../', import.meta.url)))) {
  root = resolve(root);
  const source = resolve(root, 'dist');
  const destination = resolve(root, 'dist-cloud');
  // Only this generated build directory can be replaced, never an input/source directory.
  if (relative(root, destination) !== 'dist-cloud' || !destination.startsWith(`${root}${sep}`)) throw new Error('Unsafe staging directory');
  await stat(resolve(source, 'index.html'));
  // Generate from this build's raw bytes, never a potentially stale checked-in .gz.
  const compressed = await Promise.all(GZIP_ASSET_PATHS.map(async path => {
    const raw = await readFile(resolve(source, path));
    const bytes = gzipSync(raw, { level: 9 });
    if (bytes.length > CLOUDFLARE_ASSET_LIMIT) throw new Error(`Cloudflare asset too large after gzip: ${path}`);
    return { path, bytes, rawBytes: raw.length, rawSha256: hash(raw), gzipSha256: hash(bytes) };
  }));
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const omitted = new Set([...GZIP_ASSET_PATHS, 'data/killian/vegetation.glb', 'data/killian/vegetation.glb.gz']);
  const generated = new Set(GZIP_ASSET_PATHS.map(path => `${path}.gz`));
  const files = [];
  for (const entry of await readdir(source, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const from = resolve(entry.parentPath, entry.name);
    const path = relative(source, from).split(sep).join('/');
    if (omitted.has(path) || generated.has(path)) continue;
    const size = (await stat(from)).size;
    if (size > CLOUDFLARE_ASSET_LIMIT) throw new Error(`Cloudflare asset too large: ${path}`);
    const target = resolve(destination, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(from, target);
    files.push({ path, bytes: size });
  }
  const gzip = [];
  for (const asset of compressed) {
    const path = `${asset.path}.gz`, target = resolve(destination, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, asset.bytes);
    files.push({ path, bytes: asset.bytes.length });
    gzip.push({ url: `/${asset.path}`, path, bytes: asset.bytes.length, rawBytes: asset.rawBytes, rawSha256: asset.rawSha256, gzipSha256: asset.gzipSha256 });
  }
  const manifest = { files, omitted: [...omitted], gzip, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
  await mkdir(resolve(root, 'output/deployment'), { recursive: true });
  await writeFile(resolve(root, 'output/deployment/asset-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Prepared ${files.length} assets (${(manifest.bytes / 1024 / 1024).toFixed(2)} MiB) for Cloudflare.`);
  return manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await prepareCloudflare();
