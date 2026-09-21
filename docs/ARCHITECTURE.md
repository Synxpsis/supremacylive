# Architecture

Everything is served from **one Cloudflare Worker** (`src/worker.js`, `wrangler.jsonc`). No separate
API deploy, no separate frontend host, no CORS to configure — the static client and the accounts/match
API share one origin.

```
                         ┌─────────────────────────────┐
  browser  ── HTTP ──▶   │   Worker  (src/worker.js)    │
                         │                              │
                         │  /            → routed HTML  │──▶ Workers Assets (public/)
                         │  /api/auth/*  → D1            │
                         │  /api/users/* → D1  (public)  │
                         │  /api/maps/*  → D1            │
                         │  /queue       → Matchmaker DO │
                         │  /match/:id   → Match DO      │
                         └─────────────────────────────┘
```

## Static client — Workers Assets

`public/` is served directly by Workers Assets (`wrangler.jsonc`'s `assets` binding) — no build step,
plain `<script>` includes, `.js` files loaded both as classic browser globals and (for `map.js`/
`sim.js`) as CommonJS in the Worker/Durable Object runtime (see below).

`assets.run_worker_first: ["/"]` is a deliberate, narrow carve-out: Workers Assets' default behavior
serves any path matching a static file (which `"/"` always does, as `index.html`) *without* invoking
the Worker script at all. That would make it impossible to serve different content at `"/"` depending
on hostname — which is exactly what's needed, since `editor.supremacy.live`, `render.supremacy.live`,
and `supremacy.live` share one deployment but must show different root pages. Scoping the override to
`"/"` only means every other static asset (`map.js`, `board-render.js`, `editor.html` itself, …) still
serves directly with no Worker invocation, on every hostname. `worker.js`'s `HOSTNAME_ROOT` is the
actual hostname → extensionless-path table the handler consults; adding a fourth hostname that serves
its own root page (rather than a subpath of the game client) is a one-line addition there plus a
matching entry in `wrangler.jsonc`'s `routes` — no other wiring needed, since neither existing page's
*serving* is access-gated (only `editor.html`'s save endpoint is, via `EDITOR_USERS`) and
`render.supremacy.live` (the `.glb` prop-authoring tile placer, `public/tile-placer.html`, built and
maintained by Matt — a separate tool from the map editor above despite the naming similarity, see
[TILE_PLACER.md](TILE_PLACER.md)) has no save endpoint of its own to gate.

## Accounts — D1 + HttpOnly cookies

- Passwords: PBKDF2-SHA256, 100,000 iterations (the Workers runtime's hard ceiling for PBKDF2 — bcrypt/
  argon2 aren't available without WASM), random 16-byte salt per user.
- Sessions: opaque 32-byte random tokens in a `sessions` D1 table, delivered as `HttpOnly; Secure;
  SameSite=Lax` cookies — revocable server-side, never readable from JS. 30-day expiry.
- Login is timing-safe: a nonexistent username still runs a full `hashPassword()` call against a dummy
  salt before returning, so "no such user" and "wrong password" take the same time and return the
  identical 401.
- Schema (`migrations/0001_init.sql`, `0002_maps.sql`) is also applied idempotently at request time
  (`ensureSchema()` in `worker.js`) — `CREATE TABLE IF NOT EXISTS` on every relevant request, not just
  via `wrangler d1 migrations apply`. The migration files exist so the shape is inspectable/appliable
  without hitting the API, but the Worker doesn't actually depend on migrations having been run.

See [API.md](API.md) for the exact endpoints.

## Live map content — D1

`maps` table: one row per board key (`key`, `name`, JSON `definition`, `updated_at`, `updated_by`).
`FPMap.build()` accepts this JSON directly — it's the same shape as a `MAPS` entry in `map.js`. Seeded
lazily from the static `MAPS[key]` the first time a key is requested (`ensureMapSeeded`); D1 is the
source of truth from that point forward, so a redeploy of `map.js` never overwrites a live edit. Only
`editor.html`'s hardcoded `EDITOR_USERS` set can write; any signed-in user can read. See
[MAP_SYSTEM.md](MAP_SYSTEM.md) → "`duel` is live content" for why this exists.

## Durable Objects

Two classes, both declared in `wrangler.jsonc` (`new_sqlite_classes` migration tag `v1`):

### `Matchmaker` (`src/matchmaker.js`) — the 1v1 queue

A single well-known instance (`idFromName('global')`) — one global FIFO queue, not sharded. Uses
**hibernatable** WebSockets deliberately: this object sits idle between joins far more than a live
match does, and losing the in-memory queue to a hibernation eviction is harmless (a client just
reconnects/re-queues). `state.getWebSockets()` + `deserializeAttachment()` rebuild the `waiting` array
on wake, so a queued socket that survived hibernation isn't silently dropped. Pairs the first two
waiters FIFO, hands both a `matchId` (a fresh UUID), and closes both queue sockets — the client then
connects to `/match/:matchId` to actually play.

### `Match` (`src/match.js`) — one live game

One instance per match (`idFromName(matchId)`). This is the more interesting design decision in the
codebase:

**Lockstep relay, not a server-authoritative simulation.** Each client runs its own full `FPSim`
locally — exactly as it already does against the AI, no special-cased netcode path. The `Match` DO
sequences commands between the two sockets (so both apply the same commands in the same order) and
runs a **shadow** copy of the sim purely to (a) reject illegal commands before they're ever broadcast,
and (b) catch the two real clients silently diverging via periodic hash checks. It is **never** the
source of truth for what either client renders.

Concretely, per command:

1. Client sends `{ type: 'cmd', kind, args, seq }`.
2. The DO fast-forwards its shadow sim to "now" (`catchUp()` — the shadow has no timer of its own, it
   only advances when something needs validating), then calls the matching `sim.js` function against
   it.
3. If legal, the DO broadcasts `{ type: 'applied', seq, seat, kind, args, tick }` to **both** sockets,
   including the sender — the command is scheduled onto a tick in the near future
   (`this.sim.tick + applyDelayTicks`), not applied "now," so both clients (who received the message at
   different latencies) still apply it on the exact same tick.
4. Every `HASH_EVERY_TICKS` (100) ticks, the DO asks both clients for `sim.hash()` at a given tick
   (`hashReq`/`hashResp`). A mismatch means the two sims have desynced — the DO broadcasts `desync` and
   ends the match immediately rather than let it continue in an unrecoverable, inconsistent state.

**The apply-delay is measured, not guessed.** A flat constant would have to assume the worst
connection anyone might ever have, taxing every player with the latency of whoever has it worst. Each
seat is pinged every 2s; the delay is sized off the *worst* recent round trip either seat has shown
(not an average — a spike averaged away is a spike that gets missed, and a missed spike here is a
voided match, not a stutter), with a flat jitter margin, floored at 4 ticks (200ms) and ceilinged at 30
(1.5s — beyond that, the hash-check safety net is the answer, not more added lag). Falls back to a
flat default (10 ticks) until both seats have at least one RTT sample.

**No reconnect in v1.** A user ID already seated (even with a since-closed socket) cannot rejoin or
take the other seat. Disconnecting mid-match starts a 15s forfeit grace period
(`opponentGone`/`forfeit`); leaving before the second player ever joined just frees the seat, no
forfeit. A first player with no opponent for 20s times out with `opponent-no-show`.

Plain (non-hibernating) WebSockets here, deliberately the opposite choice from `Matchmaker` — a match
is short-lived and its shadow sim must stay in memory for the whole thing, so the small idle-billing
cost of a live socket is the right trade against losing in-memory match state to a hibernation
eviction mid-game.

## Deployment

`.github/workflows/deploy.yml` — every push to `main` runs `wrangler d1 migrations apply
supremacy-live --remote` then `wrangler deploy`, fully automatic, no manual step. `npm run dev` /
`npm run deploy` are the equivalent local commands (see the repo's `README.md`).

## Generated / vendored code

`public/support.js` is generated output from a separate `dc-runtime` TypeScript source (not part of
this repo) — its own header says "do not edit, rebuild with `bun run build`." It implements the
`x-dc`/React-based templating runtime that `index.html` and `game.html` are written against.
`editor.html` and `proto3d.html` are plain hand-written JS and don't use this runtime at all.
