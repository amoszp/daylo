// Daylo server: the static app, sign-in through the accounts service,
// per-user days / shift times / packing list / settings, and a private calendar feed.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  AccountsUnavailable, clientInfo, login, signup, logout, readToken, forgetToken,
  sessionCookie, clearedCookie, currentUser,
} from './auth.js';
import { Store, KINDS, MAX_BATCH } from './store.js';
import { buildIcs } from './ics.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '..', 'public');
const PORT = Number(process.env.PORT || 1115);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(HERE, '..', 'data'));

const MAX_JSON = 64 * 1024;
const MAX_BATCH_BYTES = 512 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf ? body : typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Cache-Control': 'no-store',
    ...(isBuf || typeof body === 'string' ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
    ...headers,
  });
  res.end(payload);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = MAX_JSON) {
  const buf = await readBody(req, limit);
  try {
    return buf.length ? JSON.parse(buf.toString('utf8')) : {};
  } catch {
    throw Object.assign(new Error('invalid JSON'), { status: 400 });
  }
}

// ---------- static files, fingerprinted so a deploy never mixes old and new ----------
const VERSIONED = ['/app.js', '/style.css', '/roster.js'];
function fingerprint(p) {
  const f = path.join(PUBLIC_DIR, p);
  return fs.existsSync(f) ? createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 12) : null;
}
function withVersions(text) {
  return text.replace(/(["'])(\.?\/[\w.-]+\.(?:js|css))\1/g, (m, q, p) => {
    const clean = p.replace(/^\./, '');
    const v = VERSIONED.includes(clean) ? fingerprint(clean) : null;
    return v ? `${q}${p}?v=${v}${q}` : m;
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'bad request', { 'Content-Type': 'text/plain' }); }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, 'not found', { 'Content-Type': 'text/plain' });
  }
  const ext = path.extname(file);
  let body = fs.readFileSync(file);
  // HTML and app.js carry the fingerprints of the files they load.
  if (ext === '.html' || rel === '/app.js') body = Buffer.from(withVersions(body.toString('utf8')));
  const longCache = (url.searchParams.has('v') && VERSIONED.includes(rel)) || ext === '.woff2';
  send(res, 200, req.method === 'HEAD' ? '' : body, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': longCache ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
}

function feedUrl(req, token) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const local = /^(localhost|127\.|\d+\.\d+\.\d+\.\d+)/.test(host);
  return `${local ? 'http' : 'https'}://${host}/cal/${token}.ics`;
}

// ---------- API ----------
function mustBeApp(req) {
  // Cross-site forms cannot set custom headers: every write needs this one.
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-daylo'] !== '1') {
    throw Object.assign(new Error('missing app header'), { status: 403 });
  }
}

export function createServer({ store }) {
  async function api(req, res, url) {
    const { pathname } = url;
    mustBeApp(req);
    if (pathname === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true, service: 'daylo' });

    if ((pathname === '/api/auth/login' || pathname === '/api/auth/signup') && req.method === 'POST') {
      const { username, password, displayName } = await readJson(req);
      if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
        return send(res, 400, { error: 'missing' });
      }
      if (username.length > 64 || password.length > 256) return send(res, 401, { error: 'wrong' });
      const isSignup = pathname.endsWith('signup');
      const { status, data } = isSignup
        ? await signup(username.trim(), password, typeof displayName === 'string' ? displayName.slice(0, 80) : '', clientInfo(req))
        : await login(username.trim(), password, clientInfo(req));
      if (status === 200 || status === 201) {
        return send(res, 200, { user: { username: data.user.username, displayName: data.user.displayName } }, { 'Set-Cookie': sessionCookie(data.token) });
      }
      if (status === 429) return send(res, 429, { error: 'too many' });
      if (status === 409) return send(res, 409, { error: 'taken' });
      if (isSignup && status === 400) return send(res, 400, { error: 'invalid', message: data?.message || '' });
      return send(res, 401, { error: 'wrong' });
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      const token = readToken(req);
      if (token) {
        forgetToken(token);
        await logout(token).catch(() => {});
      }
      return send(res, 204, '', { 'Set-Cookie': clearedCookie() });
    }

    // Everything below needs a signed-in user; each user only reaches their own data.
    const user = await currentUser(req);
    if (!user && pathname === '/api/auth/me' && req.method === 'GET') return send(res, 200, { user: null });
    if (!user) return send(res, 401, { error: 'login required' });
    const uid = user.id ?? user.username;

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      return send(res, 200, { user: { username: user.username, displayName: user.displayName } });
    }

    if (pathname === '/api/data' && req.method === 'GET') return send(res, 200, { items: store.allItems(uid) });

    if (pathname === '/api/batch' && req.method === 'POST') {
      const { ops } = await readJson(req, MAX_BATCH_BYTES);
      if (!Array.isArray(ops) || !ops.length || ops.length > MAX_BATCH) return send(res, 400, { error: 'ops required' });
      return send(res, 200, { applied: store.batch(uid, ops) });
    }

    const m = pathname.match(/^\/api\/items\/([a-z]+)\/([A-Za-z0-9_-]{1,64})$/);
    if (m) {
      const [, kind, id] = m;
      if (!Store.validKind(kind)) return send(res, 404, { error: 'unknown kind' });
      if (req.method === 'PUT') {
        const data = await readJson(req);
        if (!data || typeof data !== 'object' || Array.isArray(data)) return send(res, 400, { error: 'object required' });
        return send(res, 200, { item: store.putItem(uid, kind, id, data) });
      }
      if (req.method === 'DELETE') { store.deleteItem(uid, kind, id); return send(res, 204, ''); }
      return send(res, 405, { error: 'method not allowed' });
    }

    if (pathname === '/api/ical' && req.method === 'GET') {
      const token = store.feedToken(uid);
      return send(res, 200, token ? { on: true, url: feedUrl(req, token) } : { on: false });
    }
    if (pathname === '/api/ical' && req.method === 'POST') {
      const { on } = await readJson(req);
      if (on === true) return send(res, 200, { on: true, url: feedUrl(req, store.enableFeed(uid)) });
      if (on === false) { store.disableFeed(uid); return send(res, 200, { on: false }); }
      return send(res, 400, { error: 'on must be true or false' });
    }

    return send(res, 404, { error: 'unknown API route' });
  }

  // The calendar feed: no session (the phone's calendar fetches it), only the private link.
  function feed(req, res, token) {
    const uid = store.userForFeed(token);
    if (!uid) return send(res, 404, 'not found', { 'Content-Type': 'text/plain' });
    const body = buildIcs(store.allItems(uid));
    return send(res, 200, req.method === 'HEAD' ? '' : body, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="turnos.ics"',
      'Cache-Control': 'private, max-age=300',
    });
  }

  return http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { return send(res, 400, { error: 'bad url' }); }
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
      const cal = url.pathname.match(/^\/cal\/([a-f0-9]{32})\.ics$/);
      if (cal) return feed(req, res, cal[1]);
      return serveStatic(req, res);
    } catch (err) {
      if (res.headersSent) { res.destroy(); return; }
      if (err instanceof AccountsUnavailable) {
        console.error('[daylo] accounts unavailable:', err.message);
        return send(res, 503, { error: 'accounts service unavailable' });
      }
      if (err?.status) return send(res, err.status, { error: err.message });
      console.error('[daylo] error:', err);
      return send(res, 500, { error: 'internal error' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const store = new Store(DATA_DIR);
  createServer({ store }).listen(PORT, HOST, () => console.log(`[daylo] listening on ${HOST}:${PORT}`));
}

export { KINDS };
