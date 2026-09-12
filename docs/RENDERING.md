# Rendering

Two independent renderers exist for the same board/sim state. Both read colour and type from the
Command Console design system (`public/tokens.css`) rather than owning their own palette — see
`CLAUDE.md` and `design-system/README.md` for the token rules themselves; this doc only covers how
each renderer is built and how it reads those tokens.

**The board's geometry is explicitly outside the design system's authority** (`CLAUDE.md`: "The board
is out of scope... The design system does not specify board geometry. It does own the colour and type
the renderer paints with."). Both renderers below keep to the achromatic + faction-hue palette by
convention, not because the token rules force geometry choices on them.

## 2D isometric renderer — `public/board-render.js` (`FPRender`)

The default, always-on renderer (`game.html` uses this unless `?render=3d` is present). Pure paint: a
stateless function of `(ctx, camera, board, overlayState)` — no listeners, no internal state, no reads
of anything but its arguments. This is deliberate: the live match HUD and any future
board-preview/thumbnail context render from the exact same code path and cannot silently drift apart.

- Structures are real extruded volumes on a 2D canvas: a lit "roof" quad plus the two viewer-facing
  wall quads, projected through the camera's height axis (`camera.vert()`/`camera.project(c, r, h)`
  from `map.js`). Roof colour carries ownership (faction hue); walls stay a neutral ink shade — a
  dense board reads as a skyline, not colour soup.
- Canvas can't resolve `var(--sl-*)` custom properties directly, so `tokens()` reads every token this
  renderer needs from `getComputedStyle(document.documentElement)` **once**, lazily, and caches the
  result (`board-render.js:19-57`). If the palette (`data-faction` on `<html>`) ever changed at
  runtime, this cache would need an explicit invalidation — nothing does that today (see
  [CONTENT_INVENTORY.md](CONTENT_INVENTORY.md), the palette switcher isn't wired into any live UI
  yet), so the lazy first-call read is sufficient for now but is a known trap if that changes.
- Camera math (projection, orbit, fit) lives in `map.js`, not here — see
  [MAP_SYSTEM.md](MAP_SYSTEM.md) → Camera and projection.

## 3D renderer — `public/board-render-3d.js` (ES module, opt-in via `?render=3d`)

Newer, and the one under active development this session. A persistent Three.js scene + `update()`,
not a stateless per-frame repaint like the 2D path — rebuilding a whole WebGL scene every frame isn't
"cheap" the way redrawing a 2D canvas is, so `create()` builds the static-per-match parts once and
`update()` diffs the rest in place every tick.

- **World axes**: `x` = tile column, `z` = tile row, `y` = up. Tile `(c, r)`'s centre sits at world
  `(c + 0.5, 0, r + 0.5)` — the same tile space `map.js` already uses, mapped straight into 3D instead
  of pre-flattened into an isometric pixel offset.
- **Ground**: one `InstancedMesh` for land, one for water — two draw calls total regardless of board
  size (196 tiles for `duel`, 625 for `grand`). Land tiles are an extruded slab (`BoxGeometry`), not a
  flat plane: the box's top face sits at `y = 0` so every overlay above it (pieces, selection rings,
  garrison/troop labels, march-path lines) needed no changes when depth was added. Gap tiles (outside
  any territory — none exist on today's boards, but the map editor will introduce them once it
  supports irregular coastlines) get a second, recessed, thinner instanced mesh instead of being
  hidden — this is the water tile. Water is the one deliberate exception to the achromatic palette; it
  reuses the existing `--sl-info` status-blue token rather than inventing a new hue, so it needed no
  design-system gap flagged.
- **Structures** are one `Mesh` (box) per occupied tile, added/removed/recoloured as the piece set
  changes; see `KIT`/`PIECE_RANK` in `board-render-3d.js` for footprint/height per structure kind and
  the one-piece-per-tile precedence (capital > industry > barracks > city).
- **Labels** (garrison/troop counts, the march preview) are `CSS2DObject`s from Three's
  `CSS2DRenderer` addon — real DOM `<div>`s positioned in screen space every frame from the 3D scene's
  world coordinates, not baked into the WebGL canvas. Two things to know if you touch this code:
  - `CSS2DRenderer` writes an **inline** `element.style.transform` on every render call (derived from
    the object's `.center` property), which completely overrides anything a stylesheet rule sets for
    that same property. Anchor offset (e.g. "float this label above its tile, not centred on it") must
    be set via `CSS2DObject.center`, never via CSS `transform` in `game.html`'s `<style>` block.
  - A `CSS2DObject` nested under another `Object3D` (e.g. a troop's count label added via
    `sphere.add(label)`) is **not** cleaned up just because you `scene.remove(sphere)` — Three only
    fires the DOM-cleanup `'removed'` event on the object removed directly, not recursively on its
    descendants. Removing only the parent leaves the label's DOM node orphaned at its last-rendered
    screen position forever, since `CSS2DRenderer` can no longer reach it by walking down from
    `scene`. Always `parent.remove(child)` the nested `CSS2DObject` explicitly first. (This was a real
    bug, fixed this session — see [KNOWN_ISSUES.md](KNOWN_ISSUES.md) for the fix commit.)
- **Camera**: a real `THREE.PerspectiveCamera` + `OrbitControls`, not the `map.js` projection math the
  2D renderer uses. Selecting or arming a tile recentres the orbit target on it and freezes
  `enableRotate`/`enablePan` (zoom stays live) until the selection clears — which `game.html` already
  does on a click outside the board. This is a genuine camera lock, not a suggestion: while a tile is
  selected, drag gestures on the board itself cannot pan or spin the camera away from it.
- **Hit-testing**: a plain ray/ground-plane intersection (`tileAt()`), correct at any camera angle —
  simpler than reproducing `map.js`'s inverse-rotation `unproject()`, which is only exact at the 2D
  camera's four locked orbit bearings.
- **Tokens are read once and cached**, same pattern and same caveat as the 2D renderer's `tokens()` —
  see `board-render-3d.js`'s own comment on this (`tokens()` at the top of the file). Re-run it if a
  runtime palette switch is ever wired up.

`public/proto3d.html` is a standalone 3D-engine scratch/test page, not linked from anywhere in the
live product and not covered by the design-system migration — see `design-system/HANDOFF-GAPS.md`
item 9 if you're wondering why it still has unmigrated literals.

## Copy voice and accessibility

Both renderers, and the HUD around them, follow the Command Console copy and accessibility rules
verbatim (`CLAUDE.md`): uppercase mono labels, sentence-case explanations, no colour-only faction
identity, visible focus rings, `prefers-reduced-motion` handled centrally in `tokens.css`. Not
re-documented here — `CLAUDE.md` is the source of truth and is loaded automatically into every Claude
Code session working in this repo.
