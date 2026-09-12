# Map system

Lives in `public/map.js` (global `FPMap`). Pure data and pure functions — no canvas, no DOM, no wall
clock — so it loads identically as a classic browser script and as a CommonJS module inside a Worker /
Durable Object / Node test, and the client, the server-side shadow sim, and any future test suite all
read literally the same board logic.

## The slot-grid model

A board declares:

- `slots: { cols, rows }` — a grid of territory-sized cells
- `block: { w, h }` — one territory's tile footprint (7×7 for `duel`/`solo`, 5×5 for `grand`)
- `provinces: [{ id, name, sc, sr, ... }]` — one entry per occupied slot (`sc`/`sr` = slot coordinates)

A territory's absolute tile origin is derived, never authored: `c0 = sc * block.w`, `r0 = sr * block.h`
— so territory blocks always abut exactly, with no gap and no manual offset bookkeeping. `gridW`/`gridH`
(the board's total tile dimensions) fall out of `slots.cols * block.w` / `slots.rows * block.h`.

**Symmetry falls out of the same arithmetic.** Slot `(sc, sr)` always pairs with its 180°-rotational
twin `(cols-1-sc, rows-1-sr)`, and a city's local tile `(lc, lr)` mirrors to
`(block.w-1-lc, block.h-1-lr)`. A *full* slot grid (every slot occupied) is therefore
180°-rotationally symmetric by construction, for any board size — nothing here assumes four
territories specifically. `FPMap.symmetry(board)` checks this holds (matching wealth, matching
garrison, opposite seats) and is meant to run in CI for any board meant to be a fair 1v1 (see
`worker.js`'s `handlePutMap`, which runs this check automatically on every save to the live `duel`
board).

## Roads

The centre cross of every territory (`isRoad()`: a tile is a road if it's on the territory's centre
row or column). Because the crosses line up across abutting territory blocks, they join into
continuous highways running capital-to-capital across the whole board with zero manual authoring, and
every capital sits on the network by construction (it's the exact centre tile).

## Cities and capitals

Every territory has exactly one **capital** — the city standing on its centre tile
(`capitalOf()`/`centreTile()`). Territories can also contain plain (non-capital) cities. A city
carries either a starting `seat` (owned from match start) or a neutral `garrison` value — never both.
**Territory ownership always follows the capital alone** (`territoryOwner()`): taking the capital tile
takes the whole territory in the same tick, regardless of who owns the other tiles in it.

## Pathfinding

- `roadPath()` — shortest route staying entirely on roads (BFS, deterministic neighbour order).
- `travelPath()` — cheapest route overall, allowed to cross open country; roads just cost less
  (`roadCost` vs. `offCost`, passed in by the caller as `RULES.hopTicks`/`RULES.offRoadTicks`).
  Deterministic Dijkstra, ties broken by sorted tile key so two clients never disagree on which of two
  equal-cost routes a march takes.

Both operate purely in **tile space** (`FPMap`'s own coordinate system), never in the isometric screen
projection below — an iso projection squashes the vertical axis 2:1, so a march that looks the same
length on screen can take twice as long depending on its screen direction. Tile space is isotropic;
world/screen space is not. Never measure game distance in the latter.

## Camera and projection (2D)

`map.js` also owns the isometric camera math used by the 2D renderer (`board-render.js`) — not board
geometry, just the projection from tile space to screen pixels:

- `camera(o)` — builds a projection for an arbitrary `(yaw, pitch, scale, offset)`. The "classic"
  2:1 isometric look is just one specific axonometric camera (`yaw = 45°`, `pitch = asin(0.5)`), not a
  special case — yaw and pitch are free parameters, which is what makes an orbit-able 2D camera
  possible at all. `project`/`unproject`/`depth`/`faces`/`lit` all fall out of the same rotation math.
- `fitCamera()` / `orbitCamera()` / `stableFit()` — frame a whole board (or keep one scale stable
  across every orbit bearing, so tiles don't visibly resize as the camera turns) inside a viewport,
  respecting per-side insets so the board doesn't render under fixed UI chrome.
- `ISO_BEARINGS` (four 90°-apart yaws starting at 45°) are the only bearings where a square tile
  still projects as the correct diamond — a property of the projection itself, not a stylistic
  restriction, so the 2D camera's orbit is locked to these four rest positions.

The 3D renderer (`board-render-3d.js`) uses a real Three.js `PerspectiveCamera` + `OrbitControls`
instead of this projection math — see [RENDERING.md](RENDERING.md).

## The boards (`MAPS`)

| Key | Seats | Territories | Tiles | Status |
|---|---|---|---|---|
| `duel` | 2 | 4 (2×2 slots, 7×7 block) | 196 (14×14) | **Live** — the only board ranked 1v1 and the AI test match use. Editable at `editor.supremacy.live`, backed by D1 (see below); the static `MAPS.duel` here is only the seed/fallback. |
| `solo` | 1 | 4 (same layout as `duel`, asymmetric content) | 196 | The original single-player campaign board — one home territory, escalating neutral territories, `dunmar` as the intended endgame. Not symmetric by design (`symmetry()` correctly reports it isn't). Kept as the AI's balance-tuning reference. |
| `grand` | 2 | 25 (5×5 slots, 5×5 block) | 625 (25×25) | **Shelved, not deleted.** Fully defined and playable via an explicit `?board=grand`, but nothing defaults to it anymore — see [KNOWN_ISSUES.md](KNOWN_ISSUES.md). `win.territories: 18` (doesn't require holding literally everything, unlike `duel`/`solo`'s implicit "all of them" default). |

### `duel` is live content, not just a static file

`src/match.js`'s `loadBoardDef()` reads the `duel` board from the `maps` D1 table first, falling back
to the static `MAPS.duel` in `map.js` only if the DB has no row yet. This is what lets an
`editor.supremacy.live` save take effect immediately, with no redeploy — and it's why the *resolved*
board definition is sent down to clients in the match `start` message rather than just the key, so a
client never falls back to rendering its own possibly-stale bundled copy. `worker.js` seeds the D1
row from `MAPS.duel` the first time it's asked for (`ensureMapSeeded`) and never overwrites it again —
D1 is the source of truth from that point on. See [ARCHITECTURE.md](ARCHITECTURE.md) and
[API.md](API.md) for the editor's read/write endpoints.

## The map editor

A standalone page (`public/editor.html`, plain JS — not the `x-dc`/React-based framework the rest of
the client uses), served at `editor.supremacy.live` off the same Worker/asset bundle. Lets a signed-in,
authorized user (`EDITOR_USERS` in `worker.js` — currently one hardcoded account) load a board by key,
add/edit provinces and cities, see a live symmetry check for `duel`, and save back to D1. See
[API.md](API.md) for the exact endpoints.
