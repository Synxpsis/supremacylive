# API reference

Every route the client actually calls, grouped by transport. All HTTP endpoints are same-origin, JSON
in and out, and authenticate via the `sl_sess` HttpOnly cookie (never a header/token the client can
read or forge) — see [ARCHITECTURE.md](ARCHITECTURE.md) for the session model itself.

## HTTP — accounts (`src/worker.js`)

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/api/auth/signup` | none | `{ username, email, password }` | `{ ok, user }` + sets session cookie, or `409` with `{ fields }` on a duplicate, or `400` with `{ fields }` on validation failure |
| POST | `/api/auth/login` | none | `{ identifier, password }` (`identifier` = username or email) | `{ ok, user }` + sets session cookie, or `401 { ok:false, error:'invalid credentials' }` — deliberately identical whether the account doesn't exist or the password is wrong |
| POST | `/api/auth/logout` | cookie (optional) | — | `{ ok:true }`, clears the cookie regardless of whether a session existed |
| GET | `/api/auth/me` | cookie (optional) | — | `{ ok:true, user }` or `{ ok:true, user:null }` — never a 401, this endpoint is "who am I, if anyone" |

**Validation** (`worker.js`'s `validateSignup`): username `/^[a-z0-9_-]{3,20}$/i`, a permissive
"looks like an email" regex (not a real deliverability check — the point is catching obvious garbage,
not verifying mail can actually reach it), password 8–200 characters.

## HTTP — map content (`src/worker.js`, editor)

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| GET | `/api/maps/:key` | any signed-in user | — | `{ ok, map: { key, name, definition, updatedAt, updatedBy } }` — seeds from the static `MAPS[key]` on first read if D1 has no row yet |
| PUT | `/api/maps/:key` | signed-in **and** in `EDITOR_USERS` (`worker.js`, currently one hardcoded account) | a full board definition object (same shape as a `MAPS` entry) | `{ ok, map: { key, name, updatedAt, updatedBy } }`, or `400` if `FPMap.build()` rejects the definition, or `400 { issues }` if `key === 'duel'` and `FPMap.symmetry()` finds it's no longer a fair 1v1 |

`:key` is validated against `/^[a-z0-9_-]{1,40}$/i` before touching D1 either way.

## HTTP — misc

| Method | Path | Returns |
|---|---|---|
| GET | `/healthz` | `{ ok:true, at: <ISO timestamp> }` — no auth, no D1 dependency |
| GET | `/` | Routed by hostname: `editor.supremacy.live` gets `editor.html`, everything else gets `index.html`. Always `Cache-Control: no-store` (this is the one static-feeling response that actually varies by request). |
| everything else | Served directly by Workers Assets from `public/`, no Worker code runs |

## WebSocket — `/queue` (Matchmaker)

Requires the session cookie on the upgrade handshake (checked by `worker.js` before the request ever
reaches the Durable Object — the DO trusts `x-sl-user-id`/`x-sl-username` headers the Worker adds,
since it's unreachable except through that `fetch` handler).

**Server → client**

| Type | Fields | When |
|---|---|---|
| `queued` | `position` | Immediately on joining the queue |
| `matched` | `matchId`, `opponent: { username }` | Paired with another waiting player |

**Client → server**

| Type | Fields | Effect |
|---|---|---|
| `cancel` | — | Leaves the queue, server closes the socket |

A second queue attempt from the same user ID supersedes (closes) the first automatically — there's no
explicit "already queued" error, the old socket is just dropped.

## WebSocket — `/match/:matchId` (Match)

Same auth model as `/queue`. See [ARCHITECTURE.md](ARCHITECTURE.md) for the lockstep model this
protocol implements — this section is just the message shapes.

**Server → client**

| Type | Fields | Meaning |
|---|---|---|
| `start` | `seat`, `board`, `boardDef`, `opponent: { username }`, `matchStartMs` | Sent to both seats once both have connected. `boardDef` is the *resolved* board (D1 if edited, else the static default) — the client must build from this, not its own bundled copy. `matchStartMs` is the shared clock anchor both clients use to derive "what tick should I be on now." |
| `ping` | `seq` | Every 2s per seat, for RTT measurement (see apply-delay in [ARCHITECTURE.md](ARCHITECTURE.md)) |
| `applied` | `seq`, `ok`, `seat`, `kind`, `args`, `tick` (on success) / `error` (on failure) | The authoritative response to a `cmd` — `ok:false` means the shadow sim rejected it (illegal command); `ok:true` tells the client which future tick to apply it on |
| `hashReq` | `tick` | Requests both clients' `sim.hash()` at a given tick |
| `desync` | `tick` | The two clients' hashes disagreed — match is about to end |
| `over` | `winnerSeat` | The shadow sim reached a win/loss condition |
| `opponentGone` | `graceSeconds` | The other seat's socket closed; forfeit grace period started |
| `forfeit` | `winnerSeat`, `reason` | Grace period expired without reconnect (no reconnect exists in v1 — this always fires once the grace period starts) |
| `error` | `message` | e.g. `opponent-no-show` if no second player joined within 20s |

**Client → server**

| Type | Fields | Effect |
|---|---|---|
| `cmd` | `kind` (`build`\|`industry`\|`march`\|`reinforce`), `args`, `seq` | Requests a command be validated and (if legal) scheduled |
| `hashResp` | `tick`, `hash` | Answers a `hashReq` |
| `pong` | `seq` | Answers a `ping` |
