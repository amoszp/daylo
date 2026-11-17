// Sign-in through the shared accounts service (users, sessions, sign-up).
// The app keeps its own login screen; every API call needs a session cookie.

const ACCOUNTS_URL = process.env.ACCOUNTS_URL || 'http://127.0.0.1:4600';
const SERVICE_TOKEN = process.env.ACCOUNTS_SERVICE_TOKEN || '';
const APP_NAME = 'daylo';

export const SESSION_COOKIE = 'daylo_session';
const SESSION_MAX_AGE_SECONDS = 180 * 86_400;
const COOKIE_SECURE = (process.env.COOKIE_SECURE ?? 'true') !== 'false';

export class AccountsUnavailable extends Error {}

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(`${ACCOUNTS_URL}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-service-token': SERVICE_TOKEN },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new AccountsUnavailable(String(err));
  }
  if (res.status >= 500) throw new AccountsUnavailable(`accounts service answered ${res.status}`);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: res.status, data };
}

export function clientInfo(req) {
  const forwarded = String(req.headers['cf-connecting-ip'] ?? '').trim();
  const ip = (forwarded || req.socket.remoteAddress || '').slice(0, 64) || undefined;
  const device = String(req.headers['user-agent'] ?? '').slice(0, 300) || undefined;
  return { ip, device };
}

export const login = (username, password, client) =>
  call('POST', '/v1/login', { username, password, app: APP_NAME, ...client });

export const signup = (username, password, displayName, client) =>
  call('POST', '/v1/signup', { username, password, displayName, app: APP_NAME, ...client });

export const logout = (token) => call('POST', '/v1/logout', { token });

const verifyCache = new Map();
const VERIFY_CACHE_MS = 30_000;

export async function verify(token) {
  const cached = verifyCache.get(token);
  if (cached && cached.until > Date.now()) return cached.user;
  const { status, data } = await call('POST', '/v1/verify', { token });
  if (status !== 200 || !data?.user) {
    verifyCache.delete(token);
    return null;
  }
  verifyCache.set(token, { user: data.user, until: Date.now() + VERIFY_CACHE_MS });
  if (verifyCache.size > 1000) verifyCache.delete(verifyCache.keys().next().value);
  return data.user;
}

export function forgetToken(token) {
  verifyCache.delete(token);
}

export function readToken(req) {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(value.join('=')) || null;
  }
  return null;
}

export function sessionCookie(token) {
  const attrs = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_MAX_AGE_SECONDS}`];
  if (COOKIE_SECURE) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearedCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${COOKIE_SECURE ? '; Secure' : ''}`;
}

/** The signed-in user, or null. Throws AccountsUnavailable when accounts is down. */
export async function currentUser(req) {
  const token = readToken(req);
  if (!token) return null;
  return verify(token);
}
