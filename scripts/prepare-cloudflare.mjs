import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const source = resolve(root, 'dist');
const destination = resolve(root, 'dist-cloud');
// Only this generated build directory can be replaced, never an input/source directory.
if (relative(root, destination) !== 'dist-cloud' || !destination.startsWith(`${root}${sep}`)) throw new Error('Unsafe staging directory');
await stat(resolve(source, 'index.html'));
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
const omitted = new Set(['data/killian/detail.glb', 'data/killian/vegetation.glb', 'data/killian/vegetation.glb.gz']);
const files = [];
for (const entry of await readdir(source, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const from = resolve(entry.parentPath, entry.name);
  const path = relative(source, from).split(sep).join('/');
  if (omitted.has(path)) continue;
  const size = (await stat(from)).size;
  if (size > 25 * 1024 * 1024) throw new Error(`Cloudflare asset too large: ${path}`);
  const target = resolve(destination, path);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(from, target);
  files.push({ path, bytes: size });
}
await mkdir(resolve(root, 'output/deployment'), { recursive: true });
await writeFile(resolve(root, 'output/deployment/asset-manifest.json'), JSON.stringify({ files, omitted: [...omitted], bytes: files.reduce((sum, file) => sum + file.bytes, 0) }, null, 2));
console.log(`Prepared ${files.length} assets (${(files.reduce((sum, file) => sum + file.bytes, 0) / 1024 / 1024).toFixed(2)} MiB) for Cloudflare.`);
