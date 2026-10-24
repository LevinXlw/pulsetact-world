import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppService } from './app-service.mjs';

const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
if (!existsSync(resolve(root, 'index.html'))) throw new Error('Build the client first with npm run build.');
const service = createAppService({ storagePath: process.env.WORLD_STORAGE_PATH || '.world-data/world.json' });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.ico': 'image/x-icon' };
const server = createServer((request, response) => service.handler(request, response, () => {
  void serve(request, response).catch(() => {
    if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain' });
    response.end('Unable to serve this file.');
  });
}));

async function serve(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400); response.end(); return; }
  let file = resolve(root, `.${pathname}`);
  if (file !== root && !file.startsWith(`${root}${sep}`)) { response.writeHead(403); response.end(); return; }
  let info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    if (extname(pathname)) { response.writeHead(404); response.end(); return; }
    file = resolve(root, 'index.html');
    info = await stat(file);
  }
  response.writeHead(200, {
    'Content-Type': mime[extname(file)] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).on('error', () => response.destroy()).pipe(response);
}

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`Campus world available at http://${host}:${server.address().port}`));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await service.close();
  server.close();
  server.closeIdleConnections();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
