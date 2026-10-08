import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleHttpVerification, jsonHeaders } from '../server/http.mjs';
import { ONLINE_LIMIT } from '../server/verification.mjs';

const root = resolve(fileURLToPath(new URL('../site/', import.meta.url)));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT || 3000);
const server = http.createServer(async (req, res) => {
  try {
    if (new URL(req.url || '/', 'http://localhost').pathname === '/api/verify') {
      const reply = await handleHttpVerification({
        method: req.method, origin: req.headers.origin, host: req.headers.host,
        contentType: req.headers['content-type'], contentLength: req.headers['content-length'],
        readBody: async limit => {
          let body = '';
          for await (const part of req) { body += part.toString(); if (Buffer.byteLength(body) > limit) throw Object.assign(new Error('Request too large'), { code: 'TOO_LARGE' }); }
          return body;
        }
      });
      res.writeHead(reply.status, jsonHeaders()).end(JSON.stringify(reply.body));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    const requested = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (requested.includes('\0')) throw new Error('Invalid path');
    const file = resolve(root, '.' + (requested === '/' ? '/index.html' : requested));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end('Forbidden'); return; }
    const item = await stat(file);
    if (!item.isFile()) { res.writeHead(404).end('Not found'); return; }
    const extension = file.slice(file.lastIndexOf('.'));
    res.setHeader('Content-Type', mime[extension] || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    if (req.method === 'HEAD') { res.end(); return; }
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`CellGuard Web: http://localhost:${port}`));
