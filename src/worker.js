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
import '../public/map.js';

export { Match, Matchmaker };

const AUTH_COOKIE = 'sl_sess';
const SESSION_DAYS = 30;
const PBKDF2_ITERS = 100_000;

// Only this account can write live map content — the editor at
// editor.supremacy.live is otherwise read-only for any signed-in user.
const EDITOR_USERS = new Set(['Developer']);

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
    db.prepare(`CREATE TABLE IF NOT EXISTS maps (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      definition TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by TEXT
    )`),
  ]);
}

/** Seed a board's live row from the static map.js definition the first time
 *  it's asked for, so the editor starts from real production content instead
 *  of empty. A no-op once the row exists — D1 is the source of truth after that. */
async function ensureMapSeeded(db, key) {
  const row = await db.prepare(`SELECT key FROM maps WHERE key = ?1`).bind(key).first();
  if (row) return;
  const def = self.FPMap.MAPS[key];
  if (!def) return;
  await db.prepare(
    `INSERT OR IGNORE INTO maps (key, name, definition, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5)`
  ).bind(key, def.name || key, JSON.stringify(def), Date.now(), null).run();
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

// ── public profile (profile.html) ───────────────────────────────────────────
// No auth required — this is a public-by-username lookup. Deliberately never
// returns email, unlike /api/auth/me: that field stays private even to the
// profile's own owner on this view-only, publicly-reachable route.
async function handleGetUserProfile(env, request, username) {
  if (!USERNAME.test(username)) return problem(400, 'invalid username');
  await ensureSchema(env.DB);
  const row = await env.DB.prepare(
    `SELECT username, created_at, last_login FROM users WHERE username = ?1 LIMIT 1`
  ).bind(username).first();
  if (!row) return problem(404, 'no such user');
  return json({ ok: true, user: { username: row.username, createdAt: row.created_at, lastLogin: row.last_login } });
}

// ── map content (editor.supremacy.live) ─────────────────────────────────────
const MAP_KEY = /^[a-z0-9_-]{1,40}$/i;

async function handleGetMap(env, request, key) {
  if (!MAP_KEY.test(key)) return problem(400, 'invalid map key');
  const user = await userFromRequest(env, request);
  if (!user) return problem(401, 'login required');

  await ensureSchema(env.DB);
  await ensureMapSeeded(env.DB, key);
  const row = await env.DB.prepare(`SELECT key, name, definition, updated_at, updated_by FROM maps WHERE key = ?1`).bind(key).first();
  if (!row) return problem(404, 'no such map');
  return json({ ok: true, map: { key: row.key, name: row.name, definition: JSON.parse(row.definition), updatedAt: row.updated_at, updatedBy: row.updated_by } });
}

async function handlePutMap(env, request, key) {
  if (!MAP_KEY.test(key)) return problem(400, 'invalid map key');
  const user = await userFromRequest(env, request);
  if (!user) return problem(401, 'login required');
  if (!EDITOR_USERS.has(user.username)) return problem(403, 'not authorized to edit maps');

  const def = await request.json().catch(() => null);
  if (!def || typeof def !== 'object') return problem(400, 'invalid body');

  let built;
  try { built = self.FPMap.build({ ...def, id: key }); }
  catch (err) { return problem(400, 'invalid map definition', { detail: String(err && err.message || err) }); }

  // A capital-less (or multi-capital) province is silently broken, not just
  // incomplete: with no capital, sim.js's income loop pays that territory
  // nothing even fully held, forever, with no error anywhere — see
  // docs/MECHANICS.md and the 2026-09-14 KNOWN_ISSUES.md entry this guards
  // against a second occurrence of (a real production board lost its whole
  // cities array once already, and nothing stopped it being saved that way).
  // Checked for every province on every board, not just duel's symmetric
  // ones — every province needs exactly one capital regardless of symmetry.
  const capIssues = self.FPMap.capitalIssues(built);
  if (capIssues.length) return problem(400, 'sector missing a capital', { issues: capIssues });

  if (key === 'duel') {
    const sym = self.FPMap.symmetry(built);
    if (!sym.ok) return problem(400, 'map is not symmetric', { issues: sym.issues });
  }

  await ensureSchema(env.DB);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO maps (key, name, definition, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(key) DO UPDATE SET name = excluded.name, definition = excluded.definition, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(key, def.name || key, JSON.stringify(def), now, user.username).run();

  return json({ ok: true, map: { key, name: def.name || key, updatedAt: now, updatedBy: user.username } });
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
        const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
        if (userMatch && request.method === 'GET') return await handleGetUserProfile(env, request, userMatch[1]);
        const mapMatch = path.match(/^\/api\/maps\/([^/]+)$/);
        if (mapMatch && request.method === 'GET') return await handleGetMap(env, request, mapMatch[1]);
        if (mapMatch && request.method === 'PUT') return await handlePutMap(env, request, mapMatch[1]);
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

    // editor.supremacy.live serves the map editor instead of the game client,
    // off the same Worker/assets bundle — no separate deploy, no split DB.
    // Only the root path is rewritten; editor.html's own script/font requests
    // (./map.js, ./board-render.js, ./support.js, …) must still resolve to
    // their real files under public/.
    //
    // This only runs at all because assets.run_worker_first: ["/"] in
    // wrangler.jsonc forces it to — Workers Assets' default is to serve a
    // path that matches a static file (which "/" always does, as index.html)
    // directly, without invoking the Worker script, for every hostname alike.
    // Target "/editor" (no extension): requesting "/editor.html" directly
    // hits Workers Assets' own redirect-to-canonical-URL behavior (307 to
    // "/editor") instead of the file, since html_handling normalizes the
    // extensioned path away — asking for the canonical form up front avoids
    // that hop. no-store keeps this one host-dependent response (unlike every
    // other shared static asset, which is identical across hosts) uncached.
    if (path === '/') {
      const target = url.hostname === 'editor.supremacy.live' ? '/editor' : path;
      const rewritten = new URL(request.url);
      rewritten.pathname = target;
      const res = await env.ASSETS.fetch(new Request(rewritten, request));
      const out = new Response(res.body, res);
      out.headers.set('Cache-Control', 'no-store');
      return out;
    }

    return env.ASSETS.fetch(request);
  },
};
