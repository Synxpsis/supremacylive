# Overview

Supremacy Live (internal codename **"Four Provinces"**, still visible in source headers) is a
real-time, no-turns territory-control game. Two players (or one player vs. an AI opponent) fight over
a shared board of territories; troops and money accrue continuously on a fixed 20Hz tick, and the
first side to hold enough territories — or to reduce the other to zero — wins.

There is no turn order and no pause: everything (income, troop production, marches, combat) runs on
the tick clock whether or not either player is actively doing anything, which is the entire design
premise ("real-time, no-turns" in the README tagline).

## What's actually live today

- **1v1 online**, matched via a FIFO queue, played on the **`duel`** board (2 seats, 4 territories,
  14×14 tiles). This is the only board ranked/queued matches ever use.
- **AI test match** — the same `duel` board, one human seat vs. one of three AI difficulty levels
  (`Passive` / `Steady` / `Ruthless`), or no AI at all for solo poking-around. Runs entirely
  client-side, no Durable Object involved.
- **A live map editor** at `editor.supremacy.live`, gated to one hardcoded account, for hand-editing
  the `duel` board's provinces/cities directly in D1 without a redeploy.
- **Two renderers**: the default 2D isometric canvas (`board-render.js`), and an opt-in
  (`?render=3d`) real Three.js 3D renderer (`board-render-3d.js`) that is newer and actively being
  built out (camera behavior, tile depth, water — see [RENDERING.md](RENDERING.md)).
- **Accounts**: username/email/password signup+login, sessions as HttpOnly cookies, backed by D1.
  A commander profile (`GET /api/users/:username`) shows account info — username, member-since,
  last-seen — looked up by username, no login required to view. The profile layout also reserves
  space for hero stats (rating/ladder rank/trophies), a rating-history graph, and match history, but
  none of that data exists yet (`match.js` never persists an outcome anywhere) — every one of those
  sections renders an honest "not tracked yet" rather than a fabricated number, matching the design
  system's own rule that a rating band is real data or nothing. Badges and faction are separate,
  wholly unscoped systems, shown as "coming soon". See [KNOWN_ISSUES.md](KNOWN_ISSUES.md). Two front
  ends read it: `index.html`'s hub has an in-app `profile` screen (click the header's commander chip
  to view your own, the header's search box to look up anyone, or **drag right from the hub** — profile
  sits to the hub's left in a shared, 220ms-eased track, snapping past a 50% threshold (matching the
  design system's motion cap) — with no page navigation, matching every other hub screen; `profile.html` is a
  separate standalone page for a shareable/logged-out-reachable link
  (`profile.html?u=<username>`). Same endpoint, two presentations, kept deliberately duplicated
  rather than sharing markup — see `index.html`'s and `profile.html`'s own scripts.

## What's shelved or missing

- **The `grand` board** (25 territories × 25 provinces, 625 tiles) — a much larger map — exists in
  `map.js` and is fully playable via an explicit `?board=grand`, but is no longer the default
  anywhere; the hub's AI test-match link and `game.html`'s fallback both point at `duel` now. See
  [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
- **Only one unit type.** Troops are a single undifferentiated count per tile — no unit roster, no
  unit-type tech tree.
- **Only one currency.** Coin (money). No premium/secondary currency exists.
- **No cosmetics/monetization surface.** The closest thing is four built-in, non-purchasable seat-color
  palettes (accessibility-oriented, colorblind-safe alternates) that aren't even user-selectable in
  the live UI yet — see [CONTENT_INVENTORY.md](CONTENT_INVENTORY.md).
- **No spectate or replay.** The client always renders "seat 0" as the viewing player, which is a
  structural blocker for either feature until seat remapping is built.
- **No reconnect.** A dropped connection mid-match is a forfeit after a 15s grace period; there is no
  way to rejoin a match in progress (see [ARCHITECTURE.md](ARCHITECTURE.md)).
- **Matches are 2-seat only.** Nothing in the sim, matchmaker, or board model supports more than two
  players in one match today (the `grand` board's `seats: 2` is unrelated to its larger territory
  count).

## Where things live

```
public/            static client — no build step, plain <script> includes
  map.js             board data model + camera/projection math (FPMap)
  sim.js             the authoritative game simulation (FPSim)
  ai.js              opponent bot (FPAI)
  board-render.js    2D canvas renderer (FPRender)
  board-render-3d.js 3D Three.js renderer (ES module)
  index.html         hub (landing, auth, mode picker, matchmaking, in-app profile screen)
  game.html          the match screen (HUD, both renderers, netcode client)
  profile.html       standalone public commander profile — lookup by username, shareable link
  editor.html        live map editor (editor.supremacy.live)
  tokens.css         design-system token layer
  support.js         generated UI-framework runtime (dc-runtime) — do not hand-edit
src/
  worker.js          Worker fetch handler: static assets, /api/auth/*, /api/maps/*, routing
  match.js           Match Durable Object — one live 1v1 game (lockstep relay + shadow sim)
  matchmaker.js      Matchmaker Durable Object — the 1v1 queue
migrations/        D1 schema (also applied idempotently at runtime by worker.js)
design-system/     Command Console v1.0 — the UI design system and its reference screens
docs/              you are here
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how these pieces actually run in production (a single
Cloudflare Worker, Workers Assets, D1, two Durable Object classes).
