import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AppError, isUuid, JOB_STATUSES, validateJob, validateKey } from './domain.js';

const files = { '/': ['index.html','text/html; charset=utf-8'], '/app.js': ['app.js','text/javascript; charset=utf-8'], '/styles.css': ['styles.css','text/css; charset=utf-8'] };
const digest = value => createHash('sha256').update(value).digest();
export function authorized(header, token) {
  return typeof header === 'string' && header.startsWith('Bearer ') && timingSafeEqual(digest(header.slice(7)), digest(token));
}

export function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
}

export async function readJson(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new AppError('JSON_CONTENT_TYPE_REQUIRED', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 8192) throw new AppError('BODY_TOO_LARGE', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError('INVALID_JSON'); }
}

export function createHttpServer({ repository, apiToken, health }) {
  const clients = new Map();
  return http.createServer({ requestTimeout: 10000, headersTimeout: 10000 }, async (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (req.method === 'GET' && files[path]) {
        const [name, type] = files[path];
        const body = await readFile(new URL(`../public/${name}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': type }); res.end(body); return;
      }
      if (req.method === 'GET' && path === '/healthz') { send(200, { status: 'ok', role: 'web' }); return; }
      if (req.method === 'GET' && path === '/health/ready') {
        const dependencies = await health();
        if (dependencies.database !== 'connected' || dependencies.queue !== 'connected') throw new Error('Not ready');
        send(200, { status: 'ok' }); return;
      }
      if (!path.startsWith('/api/')) throw new AppError('NOT_FOUND', 404);
      const address = req.socket.remoteAddress, now = Date.now();
      let bucket = clients.get(address);
      if (!bucket || now-bucket.start >= 60000) { bucket = { start: now, reads: 0, writes: 0 }; clients.set(address, bucket); }
      if (clients.size > 1000) clients.delete(clients.keys().next().value);
      if (++bucket.reads > 120 || (req.method === 'POST' && ++bucket.writes > 30)) throw new AppError('RATE_LIMITED', 429);
      if (!authorized(req.headers.authorization, apiToken)) throw new AppError('UNAUTHORIZED', 401);
      if (!sameOrigin(req)) throw new AppError('CROSS_ORIGIN_DENIED', 403);
      if (req.method === 'GET' && path === '/api/summary') { send(200, { ...await repository.summary(), dependencies: await health() }); return; }
      if (req.method === 'GET' && path === '/api/workers') { send(200, { items: await repository.workers() }); return; }
      if (req.method === 'GET' && path === '/api/jobs') {
        const status = url.searchParams.get('status');
        if (status && !JOB_STATUSES.includes(status)) throw new AppError('INVALID_STATUS');
        send(200, { items: await repository.list(status) }); return;
      }
      if (req.method === 'POST' && path === '/api/jobs') {
        const key = validateKey(req.headers['idempotency-key']);
        const job = validateJob(await readJson(req));
        send(202, await repository.submit(job, key)); return;
      }
      const match = path.match(/^\/api\/jobs\/([^/]+)(\/retry)?$/);
      if (match) {
        const id = match[1];
        if (!isUuid(id)) throw new AppError('INVALID_JOB_ID');
        if (req.method === 'GET' && !match[2]) { send(200, await repository.detail(id)); return; }
        if (req.method === 'POST' && match[2]) {
          const key = validateKey(req.headers['idempotency-key']);
          const input = await readJson(req);
          if (!input || Array.isArray(input) || Object.keys(input).length) throw new AppError('RETRY_BODY_MUST_BE_EMPTY_OBJECT');
          const original = await repository.detail(id);
          send(202, await repository.submit({ type: original.type, payload: original.payload }, key, id)); return;
        }
      }
      throw new AppError('NOT_FOUND', 404);
    } catch (error) {
      if (!res.headersSent) send(error instanceof AppError ? error.status : 503, { error: error instanceof AppError ? error.code : 'DEPENDENCY_UNAVAILABLE' });
    }
  });
}
