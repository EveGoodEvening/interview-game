/**
 * Production server: serves the built game from ./dist and exposes the API relay.
 * Usage: npm run build && npm start   (HOST / PORT / ALLOWED_HOSTS env vars are optional;
 * ALLOWED_HOSTS lists extra host names — besides localhost and IP addresses — the relay answers for).
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApiRequest } from './proxy.ts';
import { resolveStaticPath } from './static.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, '../dist');
const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 4173);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

async function serveStatic(urlPath: string, res: import('node:http').ServerResponse) {
  const target = resolveStaticPath(DIST, urlPath);
  if (!target.ok) {
    res.statusCode = target.status;
    res.end(target.status === 400 ? 'Bad Request' : 'Forbidden');
    return;
  }
  let file = target.file;
  let info = await stat(file).catch(() => null);
  if (!info || info.isDirectory()) {
    // SPA fallback
    file = path.join(DIST, 'index.html');
    info = await stat(file).catch(() => null);
    if (!info) {
      res.statusCode = 500;
      res.end('dist/ not found — run `npm run build` first.');
      return;
    }
  }
  res.setHeader('content-type', MIME[path.extname(file)] ?? 'application/octet-stream');
  if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('cache-control', 'public, max-age=31536000, immutable');
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  handleApiRequest(req, res)
    .then((handled) => (handled ? undefined : serveStatic(req.url ?? '/', res)))
    .catch((err) => {
      console.error(err);
      if (!res.headersSent) res.statusCode = 500;
      res.end('Internal error');
    });
});

server.listen(PORT, HOST, () => {
  console.log(`面试物语 Interview Story → http://${HOST}:${PORT}`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    console.warn('Warning: the API relay is reachable from other machines on this network.');
  }
});
