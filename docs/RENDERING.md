# Rendering

Two independent renderers exist for the same board/sim state today. Both read colour and type from
the Command Console design system (`public/tokens.css`) rather than owning their own palette — see
`CLAUDE.md` and `design-system/README.md` for the token rules themselves; this doc covers how each
renderer is built, how it reads those tokens, and — for the 3D renderer — the exact contract a map
editor upgrade needs to target.

**The 3D renderer (`board-render-3d.js`) and the map system it consumes are the standard going
forward.** It's currently opt-in (`?render=3d`) and the 2D canvas renderer is still the client's
default, but new board/rendering work should be written against the 3D contract below, and
[EDITOR_UPGRADE.md](EDITOR_UPGRADE.md) is the concrete plan for bringing the map editor up to the same
standard (it currently only knows the 2D renderer).

**The board's geometry is explicitly outside the design system's authority** (`CLAUDE.md`: "The board
is out of scope... The design system does not specify board geometry. It does own the colour and type
the renderer paints with."). Both renderers below keep to the achromatic + faction-hue palette by
convention, not because the token rules force geometry choices on them.

## 3D renderer — `public/board-render-3d.js` (ES module, opt-in via `?render=3d`)

A persistent Three.js scene + `update()`, not a stateless per-frame repaint like the 2D path —
rebuilding a whole WebGL scene every frame isn't "cheap" the way redrawing a 2D canvas is, so
`create(canvas, M)` builds the static-per-match parts once and `update(o)` diffs the rest in place
every tick.

### Coordinate system

World axes: `x` = tile column (`c`), `z` = tile row (`r`), `y` = up. Tile `(c, r)`'s centre sits at
world `(c + 0.5, 0, r + 0.5)` — the same tile space `map.js` already uses (see
[MAP_SYSTEM.md](MAP_SYSTEM.md)), mapped straight into 3D instead of pre-flattened into an isometric
pixel offset. **`y = 0` is the land surface** — every overlay (pieces, rings, labels, march paths)
positions itself relative to that plane, not to any per-tile geometry, which is what let tile depth
get added later with zero changes to anything drawn above ground level.

### Ground: two `InstancedMesh`es, land and water

One draw call each, regardless of board size (196 tiles for `duel`, 625 for `grand`) — cost stays flat
as boards grow.

| | Land | Water |
|---|---|---|
| Geometry | `BoxGeometry(1, LAND_DEPTH, 1)` | `BoxGeometry(1, WATER_DEPTH, 1)` |
| Depth constant | `LAND_DEPTH = 0.26` | `WATER_DEPTH = 0.05` |
| Top-face world `y` | `0` (box centred at `y = -LAND_DEPTH/2`) | `-WATER_SINK` = `-0.14` (box centred at `y = -WATER_SINK - WATER_DEPTH/2`) |
| Populated where | `FPMap.territoryAt(M, c, r)` is truthy | `FPMap.territoryAt(M, c, r)` is falsy (a gap tile — see [MAP_SYSTEM.md](MAP_SYSTEM.md) → Sparse boards) |
| Colour | Per-instance `instanceColor`: `tokens().land` (unclaimed) or the owning seat's faction colour, dimmed while contested (`×0.62`) vs. fully held (`×0.82`) — recomputed every `update()` call from `owners` | Static `tokens().water` (`--sl-info`), seeded once at `create()` time and never touched by `update()` — water never changes ownership |

Both meshes are sized `gridW × gridH` and populated for **every** cell on the grid — a cell is either
land or water, decided purely by whether `territoryAt()` resolves it to a province. There is currently
no third state (no "void"/unrendered cell beyond the two) — a board's `slots × block` rectangle is
always fully tiled by land-or-water.

Cells not on land are hidden via a zero instance scale on the land mesh (and vice versa for water) —
see the seeding loop in `create()` for the exact pattern if extending this.

**Grid lines are drawn per *slot*, land or water alike (2026-09-14; previously land-only).** Each of
the board's `slots.cols × slots.rows` cells gets its own tile-grid `LineSegments` regardless of whether
`provinceAtSlot()` resolves it to a province — an empty slot's `WATER_SINK`-height lines at the water
surface, an occupied one's at the land surface (`y = 0.01`). Before this, the line-drawing loop only
ever iterated `M.provinces`, so an empty slot's water tiles — each still an individually addressable,
independently clickable cell (see [MAP_SYSTEM.md](MAP_SYSTEM.md) → Sparse boards and water) — had no
lines separating them and rendered as one undivided quad, indistinguishable from a single giant cell
even though nothing about the underlying tile grid had actually changed.

### Structures: one `Mesh` per occupied tile

Added/removed/recoloured as the piece set changes tick to tick, never instanced (there are far fewer
structures than tiles). One structure per tile, matching the sim's own one-structure-per-tile rule
(see [MECHANICS.md](MECHANICS.md)); when more than one kind of piece could occupy a tile in the same
`update()` pass, `PIECE_RANK` decides which one wins.

| Kind | Footprint (`fp`, share of tile width) | Height (`h`, world units) | `PIECE_RANK` |
|---|---|---|---|
| `capital` | 0.66 | 0.72 | 3 (highest) |
| `industry` | 0.74 | 0.42 | 2 |
| `barracks` | 0.54 | 0.40 | 1 |
| `city` | 0.44 | 0.26 | 0 (lowest) |

**Shared with the 2D renderer** via `FPMap.STRUCTURE_KIT`/`STRUCTURE_RANK` — both `board-render.js`
and `board-render-3d.js` read the same table (`map.js`) rather than keeping their own copies, so a kit
change can't drift between the two views. (This used to be two independently hardcoded copies; hoisted
2026-09-12, see [EDITOR_UPGRADE.md](EDITOR_UPGRADE.md).) Each entry also carries a `label` and an
`authorable` flag (2026-09-12) — only renderer-relevant to the extent that `authorable` marks
`capital`/`city` as *not* placeable via the board's `structures` array (they come from `cities`
instead); the renderers themselves only ever read `fp`/`h`.

Piece colour is the owning seat's faction colour, or `tokens().neutral` for an unowned city.

### Labels — `CSS2DObject`s, not baked into the WebGL canvas

Garrison counts, troop counts, and the march-preview label are real DOM `<div>`s, positioned in screen
space every frame from the scene's 3D world coordinates via Three's `CSS2DRenderer` addon. Two things
to know before touching this code:

- `CSS2DRenderer` writes an **inline** `element.style.transform` on every render call (derived from
  the object's `.center` property), which completely overrides anything a stylesheet rule sets for
  that same property. Anchor offset (e.g. "float this label above its tile, not centred on it") must
  be set via `CSS2DObject.center`, never via CSS `transform` in `game.html`'s `<style>` block.
- A `CSS2DObject` nested under another `Object3D` (e.g. a troop's count label added via
  `sphere.add(label)`) is **not** cleaned up just because you `scene.remove(sphere)` — Three only
  fires the DOM-cleanup `'removed'` event on the object removed directly, not recursively on its
  descendants. Removing only the parent leaves the label's DOM node orphaned at its last-rendered
  screen position forever, since `CSS2DRenderer` can no longer reach it by walking down from `scene`.
  Always `parent.remove(child)` the nested `CSS2DObject` explicitly first. (This was a real bug, fixed
  2026-09-12 — see [KNOWN_ISSUES.md](KNOWN_ISSUES.md).)

### Camera

A real `THREE.PerspectiveCamera` + `OrbitControls`, not the `map.js` projection math the 2D renderer
uses. `selectionLock: true` (the default) recentres the orbit target on whatever's selected or armed
and freezes `enableRotate`/`enablePan` (zoom stays live) until the selection clears — a genuine camera
lock, not a suggestion: while it's engaged, drag gestures on the board itself cannot pan or spin the
camera away from the selection.

**Both `editor.html` and `game.html` pass `create(canvas, M, { selectionLock: false })` as of
2026-09-14** — free camera everywhere the module is used; the `true` default now exists purely for a
future caller that wants it, not for either shipped page. `editor.html` needed this from the start
(2026-09-13): *every* click there resolves to a tile-inspector selection (a city, a structure, open
ground, or open water — see [EDITOR_UPGRADE.md](EDITOR_UPGRADE.md)), so the lock engaged almost
constantly and fought free navigation while authoring a board. `game.html` originally kept the default
lock intentionally — "a player mid-order shouldn't be able to spin away from the tile they just
committed to" — but in practice it fired on every plain tile-inspect click too (checking a garrison
count, say), not just an armed march order, fighting free navigation during ordinary play the same way
it did in the editor. Turning it off there doesn't reopen the original concern: the actual march-drag
gesture (`game.html`'s `_onDown3D`/`_onUp3D`) already disables/re-enables `controls.enabled` directly
around the drag itself, independent of `selectionLock` entirely, so a player still can't spin the
camera out from under an in-progress drag — `selectionLock` was only ever adding the recentre-and-freeze
on top of that for *any* selection, armed or not.

**Camera pose survives a scene rebuild via `create(canvas, M, { camera: { position, target } })`**
(2026-09-14, `editor.html` only) — any edit that changes land/water layout (add/remove a sector, resize
the slot grid or block size) forces `reset3D()` → a full scene recreate (see
[EDITOR_UPGRADE.md](EDITOR_UPGRADE.md) below), and `create()` used to always seed a fresh camera/target
at the default overview framing regardless of where the outgoing scene's camera actually was. Every
such edit while orbiting or zoomed in visibly snapped the view back to the default angle.
`editor.html`'s `reset3D()` now reads the outgoing scene's `camera.position`/`controls.target` back out
before disposing it and hands that straight to the next `create()` call via this option; `create()`
seeds the camera/`OrbitControls.target` from it instead of the default `boardCenter`-relative framing
when present, falling back to the default only when there's no prior pose (first load, or a board swap
that never had a scene yet). `game.html` never rebuilds its scene mid-match, so it has no use for this
option and doesn't pass it.

**The match sidebar's width transition also drives the camera's aspect ratio smoothly, for free
(2026-09-14).** `game.html`'s outer grid column for the sidebar now animates between `0px` and `348px`
via CSS `transition` (see [KNOWN_ISSUES.md](KNOWN_ISSUES.md) → Design-system gaps for why this is a
deliberate exception to the in-match motion rule) instead of snapping. The board canvas's existing
`ResizeObserver` → `this._r3d.resize()` hookup (`wire()`) already fires on every layout size change, CSS
transitions included, so `camera.aspect`/`updateProjectionMatrix()` now re-run on effectively every
frame of the sidebar's animation — the camera eases its reprojection right along with the panel with no
camera-specific code needed. Before this, the grid column (and therefore the canvas) resized in one
instant layout pass, so the camera's aspect ratio jumped in a single frame the same way the panel itself
snapped open/closed.

**Grid-reference labels via `create(canvas, M, { gridLabels: true })`** (2026-09-13) — draws static
`CSS2DObject` axis labels along the board's two edges once, at scene setup: spreadsheet-style column
letters (A, B, C… Z, AA, AB…, so a board wider than 26 tiles stays unambiguous) at `(c + 0.5, 0.02, -0.6)`
for each column, and row numbers (1, 2, 3…) at `(-0.6, 0.02, r + 0.5)` for each row — just outside the
board's own tile area on both edges, never overlapping land. `editor.html` passes this (a GM referencing
"the tile at C, 4" needs *some* coordinate system visible on the board itself); `game.html` doesn't —
a live match has no use for it. Styled via a new `.fp3d-gridref` class, dimmer and smaller than a
garrison count's `.fp3d-label` styling (a reference aid, not gameplay content) — each page that hosts
the 3D scene defines its own CSS2D label classes (see `labelDiv()`'s own comment), and until this
addition `editor.html` defined none of them at all: garrison counts there were rendering with no
font/colour/background, relying on the page's dark `color-scheme` making default black text readable by
accident rather than actually matching `game.html`'s `.fp3d-label` look. Both pages' CSS now agree.

### Hit-testing

A plain ray/ground-plane intersection (`tileAt(mx, my)`), correct at any camera angle — simpler than
reproducing `map.js`'s inverse-rotation `unproject()`, which is only exact at the 2D camera's four
locked orbit bearings. The ground plane is the fixed `y = 0` land surface regardless of what's
actually rendered there (land or water) — clicking a water tile resolves to a tile coordinate, but
`territoryAt()` rejects it downstream, same as any other off-board click.

### Tokens

Read once from `getComputedStyle(document.documentElement)` and cached (`tokens()` at the top of
`board-render-3d.js`) — same pattern and same caveat as the 2D renderer's own `tokens()`. If a runtime
palette switch is ever wired up (see [CONTENT_INVENTORY.md](CONTENT_INVENTORY.md) — the four faction
palettes aren't user-selectable yet), both caches need an explicit invalidation; neither has one today.

### `create(canvas, M)` → API surface

The object `create()` returns, for reference (this is the entire integration surface `game.html`
drives):

| Member | Shape | Purpose |
|---|---|---|
| `scene`, `camera`, `renderer`, `cssRenderer` | Three.js objects | The caller drives the actual render loop (`renderer.render()`, `cssRenderer.render()`) and calls `controls.update()` — this module doesn't run its own `requestAnimationFrame` |
| `controls` | `OrbitControls` | See Camera above |
| `update(o)` | function | Diffs scene state against the latest sim snapshot — `o` shape below |
| `tileAt(mx, my)` | function | Screen px (canvas-relative) → `{c, r}` or `null` |
| `resize()` | function | Recompute renderer/camera sizing after a canvas resize |
| `dispose()` | function | Tears down controls, the CSS2D DOM layer, and the WebGL context |

`update(o)`'s input shape (same fields `game.html`'s `paint3D()` assembles every frame):
`owners`, `garrisons`, `barracks`, `industry`, `stacks`, `stackAt(st)`, `seatColour(seat)`, `sel`,
`armed`, `multi`, `marchPath`, `marchLabelText` — see `board-render-3d.js`'s own header comment for the
authoritative list; it's the same shape `board-render.js`'s `board()` function takes, deliberately, so
neither renderer has bespoke input wiring in `game.html`.

**`o.cities` (optional, 2026-09-13)** — everything else in `o` is read fresh every `update()` call, but
the city/capital piece loop originally read `M.cities` instead: the list `create()` was first handed,
closed over forever. Fine for `game.html` (a match's cities never change after kickoff — only
*ownership* does, and that already flowed live through `o.owners`), but wrong for the map editor, where
adding/deleting/moving a city is a normal edit that doesn't otherwise need a full scene rebuild
(`reset3D()` — see [EDITOR_UPGRADE.md](EDITOR_UPGRADE.md) — is reserved for land/water-layout changes,
since only the ground/water tiles are baked into a fixed-instance `InstancedMesh` at `create()` time;
individual structure pieces are plain `Mesh`es added/removed freely, so no such limit applies to them).
Without `o.cities`, a deleted city's piece kept rendering — visually present with no way to select it,
since hit-testing and the side panel both read the live, already-correct board — until some unrelated
action happened to call `reset3D()`. `editor.html`'s `overlay()` now passes `S.built.cities` here every
frame; `game.html` doesn't pass it, so `update()` falls back to the original `M.cities`, unchanged.

## 2D isometric renderer — `public/board-render.js` (`FPRender`)

The client's current default (`game.html` uses this unless `?render=3d` is present) — still the
renderer most players actually see, even though the 3D one is the forward-looking standard above. Pure
paint: a stateless function of `(ctx, camera, board, overlayState)` — no listeners, no internal state,
no reads of anything but its arguments. This is deliberate: the live match HUD and any future
board-preview/thumbnail context (including today's map editor — see [EDITOR_UPGRADE.md](EDITOR_UPGRADE.md))
render from the exact same code path and cannot silently drift apart.

- Structures are real extruded volumes on a 2D canvas: a lit "roof" quad plus the two viewer-facing
  wall quads, projected through the camera's height axis (`camera.vert()`/`camera.project(c, r, h)`
  from `map.js`). Roof colour carries ownership (faction hue); walls stay a neutral ink shade — a
  dense board reads as a skyline, not colour soup. Uses the same `KIT` footprint/height figures as the
  3D renderer's table above.
- Canvas can't resolve `var(--sl-*)` custom properties directly, so `tokens()` reads every token this
  renderer needs from `getComputedStyle(document.documentElement)` **once**, lazily, and caches the
  result (`board-render.js:19-57`). Same runtime-palette-switch caveat as the 3D renderer's cache above.
- Camera math (projection, orbit, fit) lives in `map.js`, not here — see
  [MAP_SYSTEM.md](MAP_SYSTEM.md) → Camera and projection.
- **Has no concept of water at all.** A gap tile (no province) simply never gets painted — there's no
  second pass, no fallback colour, nothing. This is fine today (no board has a gap tile), but it means
  the 2D renderer would need its own water-drawing pass added if it's ever expected to render a sparse
  board — it does not get this for free the way the 3D renderer's second `InstancedMesh` already does.

`public/proto3d.html` is a standalone 3D-engine scratch/test page, not linked from anywhere in the
live product and not covered by the design-system migration — see `design-system/HANDOFF-GAPS.md`
item 9 if you're wondering why it still has unmigrated literals.

## Copy voice and accessibility

Both renderers, and the HUD around them, follow the Command Console copy and accessibility rules
verbatim (`CLAUDE.md`): uppercase mono labels, sentence-case explanations, no colour-only faction
identity, visible focus rings, `prefers-reduced-motion` handled centrally in `tokens.css`. Not
re-documented here — `CLAUDE.md` is the source of truth and is loaded automatically into every Claude
Code session working in this repo.
