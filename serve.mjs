// Local preview: serves dist/ on http://localhost:8080 and forwards /api/v1/track/ to COURIER_API
// (default https://courier.dev.occplsoftech.com), like nginx.conf.template does in production.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const API = (process.env.COURIER_API || 'https://courier.dev.occplsoftech.com').replace(/\/$/, '');
const PORT = +(process.env.PORT || 8080);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/v1/track/') || url.pathname === '/api/v1/public/rates') {
    const body = req.method === 'POST' ? await new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)); }) : undefined;
    try {
      const up = await fetch(API + url.pathname + url.search, { method: req.method, body, headers: { 'Content-Type': 'application/json', Accept: 'application/json' } });
      res.writeHead(up.status, { 'Content-Type': up.headers.get('content-type') || 'application/json' });
      res.end(Buffer.from(await up.arrayBuffer()));
    } catch { res.writeHead(502); res.end('{"message":"Tracking backend unreachable"}'); }
    return;
  }
  const old = url.pathname.match(/^\/api\/old-track\/([A-Za-z0-9_-]{4,30})$/);
  if (old) {
    try {
      const up = await fetch(`https://occplserver.azurewebsites.net/track-status?awb_no=${old[1]}`);
      res.writeHead(up.status, { 'Content-Type': 'application/json' });
      res.end(Buffer.from(await up.arrayBuffer()));
    } catch { res.writeHead(502); res.end('{}'); }
    return;
  }
  let p = normalize(join('dist', decodeURIComponent(url.pathname)));
  if (!p.startsWith('dist')) { res.writeHead(400); return res.end(); }
  try { if ((await stat(p)).isDirectory()) p = join(p, 'index.html'); } catch { p = join('dist', '404.html'); res.statusCode = 404; }
  try { res.setHeader('Content-Type', TYPES[extname(p)] || 'application/octet-stream'); res.end(await readFile(p)); }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(PORT, () => console.log(`http://localhost:${PORT}  (tracking -> ${API})`));
