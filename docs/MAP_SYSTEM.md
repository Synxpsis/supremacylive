# Map system

Lives in `public/map.js` (global `FPMap`). Pure data and pure functions — no canvas, no DOM, no wall
clock — so it loads identically as a classic browser script and as a CommonJS module inside a Worker /
Durable Object / Node test, and the client, the server-side shadow sim, and any future test suite all
read literally the same board logic.

**This is the standard going forward.** The board data model below and the 3D rendering contract in
[RENDERING.md](RENDERING.md) are the two things a map-editor upgrade needs to target — see
[EDITOR_UPGRADE.md](EDITOR_UPGRADE.md) for the concrete gap list between what `editor.html` can author
today and what this spec actually supports.

## The slot-grid model

A board declares:

- `slots: { cols, rows }` — a grid of territory-sized cells
- `block: { w, h }` — one territory's tile footprint (7×7 for `duel`/`solo`, 5×5 for `grand`)
- `provinces: [{ id, name, sc, sr, ... }]` — one entry per **occupied** slot (`sc`/`sr` = slot
  coordinates). Not every slot has to be filled — see "Sparse boards and water" below.

A territory's absolute tile origin is derived, never authored: `c0 = sc * block.w`, `r0 = sr * block.h`
— so territory blocks always abut exactly, with no gap and no manual offset bookkeeping. `gridW`/`gridH`
(the board's total tile dimensions) fall out of `slots.cols * block.w` / `slots.rows * block.h`.

**Symmetry falls out of the same arithmetic.** Slot `(sc, sr)` always pairs with its 180°-rotational
twin `(cols-1-sc, rows-1-sr)`, and a city's local tile `(lc, lr)` mirrors to
`(block.w-1-lc, block.h-1-lr)`. A *full* slot grid (every slot occupied) is therefore
180°-rotationally symmetric by construction, for any board size — nothing here assumes four
territories specifically. `FPMap.symmetry(board)` checks this holds (matching wealth, matching
garrison, opposite seats, and — critically for sparse boards — that every occupied slot's twin slot is
*also* occupied) and is meant to run in CI for any board meant to be a fair 1v1 (`worker.js`'s
`handlePutMap` runs this automatically on every save to the live `duel` board).

## Sparse boards and water

**A slot with no `provinces` entry is not an error.** `provinceAtSlot(sc, sr)` simply returns `null`
for it, and every downstream consumer — `territoryAt()`, `neighbours()`'s callers, pathfinding,
combat, and the 3D renderer's water mesh (see [RENDERING.md](RENDERING.md)) — already treats "no
province here" as a first-class case, not a bug. An irregular coastline (a lake in the middle of a
territory grid, an island-shaped `duel` board, whatever) needs no new field, no new concept, and no
sim change — just a board definition that omits some slots from `provinces`, kept symmetric in pairs
to pass `symmetry()` if the board is `duel`.

**The map editor can author this directly** (2026-09-12, `a4c2834`) — adding or removing a territory,
or growing the grid without filling every new slot, leaves genuine empty ground that the 3D view
renders as water and the 2D view renders as a dashed placeholder immediately, with no separate "water
mode" needed. See [EDITOR_UPGRADE.md](EDITOR_UPGRADE.md). None of the three shipped boards
(`duel`/`solo`/`grand`) actually use this yet — they all still fill their whole grid — so no board a
real match is played on has ever had a water tile; that's a content choice now, not a tooling gap.

## Board definition — full field reference

This is the JSON shape `FPMap.build()` accepts (a `MAPS` entry in `map.js`, or a `maps` table row in
D1 — same shape either way, see [ARCHITECTURE.md](ARCHITECTURE.md)).

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Board key (`duel`, `grand`, ...) |
| `name` | string | yes | Display name |
| `seats` | int | yes | Player slots this board supports. **Every board today is 2 (or 1 for `solo`) — nothing reads this to mean anything beyond seat 0 / seat 1 existing.** |
| `note` | string | no | Free-text design note, never read by code |
| `win` | `{ territories: int }` | no | Territories needed to win outright. Omitted = "every territory on the board" (today's `duel`/`solo` default) |
| `slots` | `{ cols, rows }` | no (default `{2,2}`) | The territory grid dimensions |
| `block` | `{ w, h }` | no (default `{7,7}`) | One territory's tile footprint |
| `starts` | `[{ seat, territory }]` | no | Which territory each seat's tiles are seeded from at match start (`seedOwners()`) |
| `provinces` | `[Province]` | yes | One entry per **occupied** slot — see below. Omitted slots are gaps (future water) |
| `cities` | `[City]` | yes | One entry per city, referencing a province by id |

### `Province` (an entry in `provinces`)

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Unique slug, referenced by `city.prov` and by `starts[].territory` |
| `name` | string | yes | Display name (this is what the UI calls "Territory") |
| `sc`, `sr` | int | yes | Slot coordinates — position in the `slots.cols × slots.rows` grid |

Everything else on a province (`w`, `h`, `c0`, `r0`, `index`, `cities`, `twin`, `twinSlot`) is
**derived** by `build()`, never authored.

### `City` (an entry in `cities`)

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Unique slug |
| `name` | string | yes | Display name |
| `prov` | string | yes | The owning province's `id` |
| `lc`, `lr` | int | yes | Local tile position **within** the province (0-indexed from the province's own corner, not the board) |
| `wealth` | number | yes | Coin/second this city's capital pays while held — see [MECHANICS.md](MECHANICS.md) |
| `seat` | `0 \| 1 \| null` | one of `seat`/`garrison` | Starting owner. Present = seat-owned from kickoff |
| `garrison` | int | one of `seat`/`garrison` | Starting neutral troop count. Present = neutral at kickoff. **A city has one or the other, never both** — `build()` derives `garrison: 0` for a seated city and `owner: seat` either way |

A city at the province's exact centre tile (`lc, lr === centreTile`'s local equivalent) is that
territory's **capital** — this isn't a separate field, it's positional (`capitalOf()` finds the city
at `centreTile(map, p)`).

### What `build()` derives (present on the returned object, never authored)

| Field | Meaning |
|---|---|
| `gridW`, `gridH` | Total board tile dimensions |
| `iso`, `tuning` | The projection constants and the `TUNING` balance table (shared across every board) |
| `province.twin` / `province.twinSlot` | The 180°-mirror province id / slot, or `null` if that slot is empty |
| `city.tc`, `city.tr` | Absolute tile-space centre (fractional — `+0.5` from the city's local corner) |
| `city.wx`, `city.wy` | Pre-computed isometric world-pixel position (2D renderer only — the 3D renderer recomputes its own position from `tc`/`tr` directly, see [RENDERING.md](RENDERING.md)) |
| `city.twin` | The mirrored city's id, matched by mirrored local tile inside the twin province |
| `city.owner` | Same value as `seat` — a normalized alias |
| `city.ceiling` | For a neutral city: `garrison × TUNING.neutralMax`, the soft regrowth cap (see `sim.js`'s neutral regen — not currently wired to anything reading `ceiling` at runtime; present for future use) |
| `routes` | Full city×city march-distance matrix, in tile-space straight-line distance (not path distance — see Pathfinding below) |

## Roads

The centre cross of every territory (`isRoad()`: a tile is a road if it's on the territory's centre
row or column). Because the crosses line up across abutting territory blocks, they join into
continuous highways running capital-to-capital across the whole board with zero manual authoring, and
every capital sits on the network by construction (it's the exact centre tile). **Roads are derived
from the block geometry, not authored** — there is no field for "this tile is a road."

## Pathfinding

- `roadPath()` — shortest route staying entirely on roads (BFS, deterministic neighbour order).
- `travelPath()` — cheapest route overall, allowed to cross open country; roads just cost less
  (`roadCost` vs. `offCost`, passed in by the caller as `RULES.hopTicks`/`RULES.offRoadTicks`).
  Deterministic Dijkstra, ties broken by sorted tile key so two clients never disagree on which of two
  equal-cost routes a march takes.

Both operate purely in **tile space** (`FPMap`'s own coordinate system), never in the isometric screen
projection below — an iso projection squashes the vertical axis 2:1, so a march that looks the same
length on screen can take twice as long depending on its screen direction. Tile space is isotropic;
world/screen space is not. Never measure game distance in the latter. (`routes`' city×city matrix, by
contrast, *is* straight-line tile distance, not path distance — it's a rough distance heuristic baked
in at build time, not what marches actually route along.)

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

## The map editor today

A standalone page (`public/editor.html`, plain JS — not the `x-dc`/React-based framework the rest of
the client uses), served at `editor.supremacy.live` off the same Worker/asset bundle. Lets a signed-in,
authorized user (`EDITOR_USERS` in `worker.js` — currently one hardcoded account) load a board, rename
or add/remove whole territories, grow/shrink the slot grid, add/edit/delete/mirror cities, see a live
symmetry check for `duel`, and save back to D1. It's still hardcoded to the `duel` key with no board
switcher.

**Both renderers are fully wired up and interactive**, toggled via a header button (2026-09-12,
`ba103ce`) — the 2D canvas and the real 3D scene both support click-to-select, Add-City-mode, and
add/remove-territory directly, not just as a passive preview. See [RENDERING.md](RENDERING.md).

**This is still the piece growing to match the standard above** — see
[EDITOR_UPGRADE.md](EDITOR_UPGRADE.md) for what's left (a board switcher to reach `solo`/`grand`,
editing a territory's own tile footprint (`block.w`/`h`) rather than just the slot grid, win
condition/name/starts metadata) and the current plan for closing those gaps.
