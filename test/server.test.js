import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseRoster } from '../public/roster.js';
import { buildIcs, DEFAULT_TIMES } from '../server/ics.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

// A stand-in for the accounts service.
const users = new Map();
const tokens = new Map();
const accounts = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const b = body ? JSON.parse(body) : {};
    const reply = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(data === undefined ? '' : JSON.stringify(data)); };
    if (req.headers['x-service-token'] !== 'test-token') return reply(403, { error: 'bad token' });
    const pub = (u) => ({ id: u.id, username: u.username, displayName: u.displayName, isAdmin: false });
    if (req.url === '/v1/signup') {
      if (users.has(b.username)) return reply(409, { error: 'username taken' });
      const u = { id: users.size + 1, username: b.username, password: b.password, displayName: b.displayName || '' };
      users.set(u.username, u);
      const token = randomBytes(16).toString('hex'); tokens.set(token, u.username);
      return reply(201, { token, user: pub(u) });
    }
    if (req.url === '/v1/login') {
      const u = users.get(b.username);
      if (!u || u.password !== b.password) return reply(401, { error: 'wrong' });
      const token = randomBytes(16).toString('hex'); tokens.set(token, u.username);
      return reply(200, { token, user: pub(u) });
    }
    if (req.url === '/v1/verify') {
      const name = tokens.get(b.token);
      return name ? reply(200, { user: pub(users.get(name)) }) : reply(401, { error: 'expired' });
    }
    if (req.url === '/v1/logout') { tokens.delete(b.token); return reply(204); }
    reply(404, {});
  });
});

let base, server, store, dataDir;
before(async () => {
  await new Promise((r) => accounts.listen(0, '127.0.0.1', r));
  process.env.ACCOUNTS_URL = `http://127.0.0.1:${accounts.address().port}`;
  process.env.ACCOUNTS_SERVICE_TOKEN = 'test-token';
  process.env.COOKIE_SECURE = 'false';
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylo-test-'));
  const { createServer } = await import('../server/server.js');
  const { Store } = await import('../server/store.js');
  store = new Store(dataDir);
  server = createServer({ store });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); accounts.close(); store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

async function call(method, p, { body, cookie, header = true } = {}) {
  const h = {};
  if (header) h['x-daylo'] = '1';
  if (cookie) h.cookie = cookie;
  let payload;
  if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + p, { method, headers: h, body: payload });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}
async function signupAs(username) {
  const r = await call('POST', '/api/auth/signup', { body: { username, password: 'clave1', displayName: username } });
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie').split(';')[0];
}

test('health, static page and security headers', async () => {
  assert.equal((await call('GET', '/api/health')).data.ok, true);
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<title>Daylo<\/title>/);
  assert.match(html, /\/app\.js\?v=[0-9a-f]{12}/, 'scripts carry a content fingerprint');
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  const app = await (await fetch(base + '/app.js')).text();
  assert.match(app, /\.\/roster\.js\?v=[0-9a-f]{12}/, 'app.js imports the fingerprinted roster reader');
  assert.equal((await fetch(base + '/../server/auth.js')).status, 404);
});

test('signed out: data is closed, writes need the app header', async () => {
  assert.equal((await call('GET', '/api/data')).status, 401);
  assert.deepEqual((await call('GET', '/api/auth/me')).data, { user: null });
  assert.equal((await call('POST', '/api/batch', { body: { ops: [] }, header: false })).status, 403);
});

test('each user only sees their own days, list and settings', async () => {
  const a = await signupAs('ana');
  const b = await signupAs('beto');
  assert.equal((await call('PUT', '/api/items/dia/2026-12-02', { cookie: a, body: { t: 'late', loc: 'office', via: 'bus' } })).status, 200);
  assert.equal((await call('PUT', '/api/items/pack/p1', { cookie: a, body: { name: 'Portátil y cargador', done: false } })).status, 200);
  const mine = (await call('GET', '/api/data', { cookie: a })).data.items;
  assert.equal(mine.dia[0].t, 'late');
  assert.equal(mine.dia[0].via, 'bus');
  assert.equal(mine.pack[0].name, 'Portátil y cargador');
  const theirs = (await call('GET', '/api/data', { cookie: b })).data.items;
  assert.equal(theirs.dia.length, 0);
  assert.equal(theirs.pack.length, 0);
  assert.equal((await call('PUT', '/api/items/nope/x', { cookie: a, body: {} })).status, 404);
  assert.equal((await call('DELETE', '/api/items/pack/p1', { cookie: a })).status, 204);
  assert.equal((await call('GET', '/api/data', { cookie: a })).data.items.pack.length, 0);
});

test('a batch is all or nothing', async () => {
  const c = await signupAs('carla');
  const ops = Array.from({ length: 31 }, (_, i) => ({ op: 'put', kind: 'dia', id: `2026-12-${String(i + 1).padStart(2, '0')}`, data: { t: 'off' } }));
  assert.equal((await call('POST', '/api/batch', { cookie: c, body: { ops } })).data.applied, 31);
  const bad = [{ op: 'del', kind: 'dia', id: '2026-12-01' }, { op: 'put', kind: 'dia', id: 'bad id!', data: {} }];
  assert.equal((await call('POST', '/api/batch', { cookie: c, body: { ops: bad } })).status, 400);
  assert.equal((await call('GET', '/api/data', { cookie: c })).data.items.dia.length, 31, 'the valid delete was not applied');
  assert.equal((await call('POST', '/api/batch', { cookie: c, body: { ops: Array(501).fill(ops[0]) } })).status, 400);
});

test('calendar feed: private link, on and off', async () => {
  const d = await signupAs('dani');
  await call('POST', '/api/batch', { cookie: d, body: { ops: [
    { op: 'put', kind: 'dia', id: '2026-12-02', data: { t: 'late', loc: 'office', via: 'bus' } },
    { op: 'put', kind: 'dia', id: '2026-12-05', data: { t: 'off' } },
    { op: 'put', kind: 'tipo', id: 'mid', data: { s: '11:30', e: '20:20' } },
    { op: 'put', kind: 'dia', id: '2026-12-07', data: { t: 'mid' } },
  ] } });
  assert.deepEqual((await call('GET', '/api/ical', { cookie: d })).data, { on: false });
  const on = (await call('POST', '/api/ical', { cookie: d, body: { on: true } })).data;
  assert.equal(on.on, true);
  const feedPath = new URL(on.url).pathname;
  assert.match(feedPath, /^\/cal\/[a-f0-9]{32}\.ics$/);
  const res = await fetch(base + feedPath);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/calendar/);
  const ics = await res.text();
  assert.match(ics, /DTSTART;TZID=Atlantic\/Canary:20261202T150000/);
  assert.match(ics, /DTEND;TZID=Atlantic\/Canary:20261203T000000/, 'a shift ending at 00:00 ends the next day');
  assert.match(ics, /SUMMARY:Tarde · Oficina en guagua/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261205\r\nDTEND;VALUE=DATE:20261206/);
  assert.match(ics, /DTEND;TZID=Atlantic\/Canary:20261207T202000/, "the user's own times are used");
  assert.equal((await call('POST', '/api/ical', { cookie: d, body: { on: true } })).data.url, on.url, 'turning it on again keeps the same link');
  await call('POST', '/api/ical', { cookie: d, body: { on: false } });
  assert.equal((await fetch(base + feedPath)).status, 404, 'an old link stops working');
  assert.equal((await fetch(base + '/cal/' + 'a'.repeat(32) + '.ics')).status, 404);
});

test('roster: the real December 2026 roster reads as 31 days', () => {
  const text = fs.readFileSync(path.join(FIX, 'december-2026.txt'), 'utf8');
  const days = parseRoster(text, DEFAULT_TIMES).map((d) => d.t);
  assert.equal(days.length, 31);
  assert.deepEqual(days, ('train late late late off hol mid hol mid mid early off off late late late late late off off ' +
    'mid mid mid mid hol off off late late late late').split(' '));
});

test('roster: other times, headings, brackets and Spanish words', () => {
  const r = parseRoster('1st Nov:\nSupport 10:00-19:00 (18:00-03:00)\nLibre\nFestivo\nFormación\n9:00-18:00\nSupport\n8:00-17:00\n23:00-08:00', DEFAULT_TIMES);
  assert.deepEqual(r, [{ t: 'other', s: '10:00', e: '19:00' }, { t: 'off' }, { t: 'hol' }, { t: 'train' }, { t: 'early' }]);
});

test('ics: long lines are folded and text is escaped', () => {
  const ics = buildIcs({ dia: [{ id: '2026-12-02', t: 'late' }] }, { name: 'Turnos, de prueba; con un nombre largo que obliga a doblar la línea del calendario' });
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
  assert.match(ics, /Turnos\\, de prueba\\; con/);
});
