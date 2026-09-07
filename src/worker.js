/**
 * Supremacy Live — Worker.
 *
 * Serves the static client via Workers Assets, and — new — the accounts API
 * backed by D1. Sessions are opaque random tokens in a D1 table, delivered as
 * HttpOnly Secure cookies, so they are revocable server-side and never leak
 * into JS. Passwords are PBKDF2-SHA256 with 100k iterations (the strongest
 * KDF native to Workers; bcrypt/argon2 aren't available without WASM — and
 * 100k is the Workers runtime's hard ceiling for PBKDF2 iterations).
 *
 * The API is a plain fetch handler on the same origin as the client, so no
 * CORS setup, no separate deploy, no split secrets. Matchmaking (/queue) and
 * live matches (/match/:id) are WebSocket upgrades routed to the Matchmaker
 * and Match Durable Objects — see src/matchmaker.js and src/match.js.
 */
import { Match } from './match.js';
import { Matchmaker } from './matchmaker.js';

export { Match, Matchmaker };

const AUTH_COOKIE = 'sl_sess';
const SESSION_DAYS = 30;
const PBKDF2_ITERS = 100_000;

// ── responses ────────────────────────────────────────────────────────────────
const json = (body, init = {}) => new Response(JSON.stringify(body), {
  ...init,
  headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) },
});

const problem = (status, message, extra) => json({ ok: false, error: message, ...(extra || {}) }, { status });

// ── crypto ───────────────────────────────────────────────────────────────────
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

async function hashPassword(password, saltHex) {
  const salt = saltHex ? Uint8Array.from(saltHex.match(/../g).map(h => parseInt(h, 16))) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' }, key, 256);
  return { salt: hex(salt), hash: hex(bits) };
}

/** Constant-time compare — never `a === b` on secrets. */
function ctEqual(a, b) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

const newToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));

// ── validation ───────────────────────────────────────────────────────────────
const USERNAME = /^[a-z0-9_-]{3,20}$/i;
// Deliberately permissive — a real address-validity check is a round-trip to
// mail, and the point here is just to catch obvious garbage.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateSignup(body) {
  const errs = {};
  const username = String(body.username || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!USERNAME.test(username)) errs.username = '3–20 characters: letters, numbers, _ or -';
  if (!EMAIL.test(email) || email.length > 254) errs.email = 'not a valid email';
  if (password.length < 8) errs.password = 'at least 8 characters';
  if (password.length > 200) errs.password = 'too long';
  return { errs, username, email, password };
}

// ── cookies ──────────────────────────────────────────────────────────────────
function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq > -1 && part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

function sessionCookie(token, maxAgeSeconds) {
  const parts = [
    `${AUTH_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  return parts.join('; ');
}

// ── D1 helpers ───────────────────────────────────────────────────────────────
async function ensureSchema(db) {
  // idempotent; cheap; keeps the schema alongside the code that reads it.
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pw_salt TEXT NOT NULL,
      pw_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_login INTEGER
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at)`),
  ]);
}

async function userFromRequest(env, request) {
  const token = readCookie(request, AUTH_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.email, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?1 AND s.expires_at > ?2 LIMIT 1`
  ).bind(token, Date.now()).first();
  return row || null;
}

// ── handlers ─────────────────────────────────────────────────────────────────
async function handleSignup(env, request) {
  const body = await request.json().catch(() => ({}));
  const { errs, username, email, password } = validateSignup(body);
  if (Object.keys(errs).length) return problem(400, 'invalid', { fields: errs });

  await ensureSchema(env.DB);

  // Duplicate check up front so we can return a friendly per-field message
  // rather than a generic "already exists".
  const clash = await env.DB.prepare(
    `SELECT username, email FROM users WHERE username = ?1 OR email = ?2 LIMIT 1`
  ).bind(username, email).first();
  if (clash) {
    const f = {};
    if (String(clash.username).toLowerCase() === username.toLowerCase()) f.username = 'already taken';
    if (String(clash.email).toLowerCase() === email) f.email = 'already registered';
    return problem(409, 'conflict', { fields: f });
  }

  const { salt, hash } = await hashPassword(password);
  const now = Date.now();
  const ins = await env.DB.prepare(
    `INSERT INTO users (username, email, pw_salt, pw_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`
  ).bind(username, email, salt, hash, now).run();
  const userId = ins.meta.last_row_id;

  const token = newToken();
  const expires = now + SESSION_DAYS * 86400_000;
  await env.DB.prepare(
    `INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)`
  ).bind(token, userId, now, expires).run();

  return json({ ok: true, user: { id: userId, username, email } }, {
    headers: { 'set-cookie': sessionCookie(token, SESSION_DAYS * 86400) },
  });
}

async function handleLogin(env, request) {
  const body = await request.json().catch(() => ({}));
  const id = String(body.identifier || '').trim();
  const password = String(body.password || '');
  if (!id || !password) return problem(400, 'invalid', { fields: { identifier: !id ? 'required' : undefined, password: !password ? 'required' : undefined } });

  await ensureSchema(env.DB);

  const row = await env.DB.prepare(
    `SELECT id, username, email, pw_salt, pw_hash FROM users WHERE username = ?1 OR email = ?1 LIMIT 1`
  ).bind(id).first();
  // Same failure path either way — never leak "user exists but bad password"
  // vs "no such user". The uniform 401 is the only useful response.
  if (!row) {
    await hashPassword(password, '0'.repeat(32));   // burn the timing budget
    return problem(401, 'invalid credentials');
  }
  const { hash } = await hashPassword(password, row.pw_salt);
  if (!ctEqual(hash, row.pw_hash)) return problem(401, 'invalid credentials');

  const now = Date.now();
  const token = newToken();
  const expires = now + SESSION_DAYS * 86400_000;
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET last_login = ?1 WHERE id = ?2`).bind(now, row.id),
    env.DB.prepare(`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)`)
      .bind(token, row.id, now, expires),
  ]);

  return json({ ok: true, user: { id: row.id, username: row.username, email: row.email } }, {
    headers: { 'set-cookie': sessionCookie(token, SESSION_DAYS * 86400) },
  });
}

async function handleLogout(env, request) {
  const token = readCookie(request, AUTH_COOKIE);
  if (token) {
    try { await env.DB.prepare(`DELETE FROM sessions WHERE token = ?1`).bind(token).run(); }
    catch (_) { /* schema may not exist yet on a fresh DB */ }
  }
  return json({ ok: true }, { headers: { 'set-cookie': sessionCookie('', 0) } });
}

async function handleMe(env, request) {
  const user = await userFromRequest(env, request);
  if (!user) return json({ ok: true, user: null });
  return json({ ok: true, user: { id: user.id, username: user.username, email: user.email } });
}

// ── entry ────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/healthz') {
      return json({ ok: true, at: new Date().toISOString() });
    }

    if (path.startsWith('/api/')) {
      if (!env.DB) return problem(500, 'D1 binding DB is not configured');
      try {
        if (path === '/api/auth/signup' && request.method === 'POST') return await handleSignup(env, request);
        if (path === '/api/auth/login'  && request.method === 'POST') return await handleLogin(env, request);
        if (path === '/api/auth/logout' && request.method === 'POST') return await handleLogout(env, request);
        if (path === '/api/auth/me'     && request.method === 'GET')  return await handleMe(env, request);
      } catch (err) {
        console.error('api error', path, err && err.stack || err);
        return problem(500, 'server error');
      }
      return problem(404, 'not found');
    }

    // ── Matchmaking + live matches ──────────────────────────────────────────
    // Both are WebSocket upgrades; the cookie that authenticates any other
    // same-origin request is present on the upgrade handshake too, so the
    // Durable Object trusts the user id/username the Worker resolved and
    // forwarded — it is never reachable except through this fetch handler.
    if (path === '/queue' || path.startsWith('/match/')) {
      const user = await userFromRequest(env, request);
      if (!user) return problem(401, 'login required');
      const stub = path === '/queue'
        ? env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global'))
        : env.MATCH.get(env.MATCH.idFromName(path.split('/')[2]));
      const fwd = new Request(request, { headers: new Headers(request.headers) });
      fwd.headers.set('x-sl-user-id', String(user.id));
      fwd.headers.set('x-sl-username', user.username);
      return stub.fetch(fwd);
    }

    return env.ASSETS.fetch(request);
  },
};
