/**
 * tools/dev-server.mjs
 * Zero-dependency static server for the game. ES modules and WASM cannot be
 * loaded over file://, so this is the "npm run dev" replacement for a bundler.
 *
 * - binds 0.0.0.0 so the Arena live-preview proxy can reach it
 * - sends no-store so a reload always picks up edited modules
 * - correct MIME types for .js / .mjs / .json / .wasm / .png / .svg
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const started = Date.now();
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  if (urlPath.endsWith('/')) urlPath += 'index.html';

  const abs = path.normalize(path.join(ROOT, urlPath));
  if (!abs.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`404 ${urlPath}`);
    log(req, 404, started);
    return;
  }

  const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
  const stat = fs.statSync(abs);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
    // Needed if the page is ever embedded cross-origin in a preview frame.
    'Access-Control-Allow-Origin': '*',
  });
  if (req.method === 'HEAD') {
    res.end();
  } else {
    fs.createReadStream(abs).pipe(res);
  }
  log(req, 200, started);
});

function log(req, status, started) {
  if (process.env.QUIET) return;
  console.log(`${status} ${req.method} ${req.url} (${Date.now() - started}ms)`);
}

server.listen(PORT, HOST, () => {
  console.log(`\n  PROJECT AMONG VESSELS - dev server`);
  console.log(`  serving ${ROOT}`);
  console.log(`  http://${HOST}:${PORT}\n`);
});

server.on('error', (err) => {
  console.error('[dev-server]', err.message);
  process.exit(1);
});
