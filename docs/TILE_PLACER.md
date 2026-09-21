# Tile Placer

A standalone 3D prop-authoring tool for tuning real `.glb` models against the game's own tile grid,
then handing off the resulting transform as a `STRUCTURE_KIT` entry (`public/map.js`) so
`board-render-3d.js` renders a real model instead of a procedural box for that structure kind. Lives
at [`public/tile-placer.html`](../public/tile-placer.html) + [`public/tile-placer/`](../public/tile-placer/),
served at **render.supremacy.live**.

**Ownership:** built and maintained by Matt (GitHub `tinkerfasttrack`) — it's his tool for his own
authoring workflow, not a shared game system the way the map editor is. Documented here because it's
part of the repo and used internally (by Matt, and by anyone else on the team tuning a structure
model), not because it's jointly owned. See [CLAUDE.md](../CLAUDE.md) for the two-person team's usual
division of labor.

## Why it exists

Every structure kind (`capital`, `industry`, `barracks`, `city`) has always rendered as a plain
procedural box in the 3D view — `STRUCTURE_KIT[kind]`'s `fp`/`h` (footprint share, height) are the only
two dials, on purpose, so a new kind needs no new art. Swapping in a *real* model for a kind means
answering three questions the game itself has no reason to compute at runtime: how much to scale it to
fit a tile, which way it's rotated, and where its origin sits relative to the tile centre. The tile
placer exists to answer those three questions once, by eye, against the real game geometry — the
result (`scale`/`rotationY`) gets hardcoded into `STRUCTURE_KIT` and versioned in git, never
recomputed. See [MAP_SYSTEM.md](MAP_SYSTEM.md) → `STRUCTURE_KIT`'s optional `model` field and
[RENDERING.md](RENDERING.md) → Structures for the consuming side of this.

## Two views

- **Tile View** (default) — one bare 1×1 tile. Drop a `.glb`/`.gltf` onto it (or pick "+ Road Barrier",
  the one built-in prop type), then move/rotate/scale it with the on-screen gizmo until it sits right.
  Position and scale are saved as *fractions of the tile*, not world units, so the same numbers are
  correct regardless of the tile's real in-game size or the camera's zoom/angle.
- **Board View** — the same authoring flow, but against the real `duel` board: actual territory
  shapes, roads, starting ownership colouring, and capital/city landmark markers, read straight from
  `FPMap.MAPS.duel` (`public/map.js`) via [`tile-placer/board.js`](../public/tile-placer/board.js).
  Click a tile to make it active, then place props on it the same way as Tile View, or use "Place Tile
  Editor layout" to stamp whatever's currently built in Tile View onto the active tile at the same
  tile-relative transforms. Useful for checking a prop against a real coastline, road junction, or
  next to an actual capital, not just an idealized bare square.

Both views support saving/loading a layout as local `.json` (drag-and-drop anywhere in the window, or
the Save/Load buttons), and a dropped `.glb`'s bytes get embedded in the saved JSON (base64) so
reloading it later doesn't need the original file again.

## The authoring workflow

1. Author or obtain a `.glb` model.
2. Tune it in the tile placer (Tile View for a quick check, Board View to see it against real
   territory/road geometry) until position, rotation, and scale look right.
3. Select the placed prop and click **"Export as STRUCTURE_KIT entry"** (Board View only) — copies a
   ready-to-paste `model: { file, scale, rotationY }` snippet to the clipboard (or shows it in a prompt
   if clipboard access fails).
4. Commit the `.glb` itself into [`public/models/`](../public/models/README.md).
5. Paste the exported snippet into the matching kind's entry in `STRUCTURE_KIT` (`public/map.js`).

`board-render-3d.js` picks up any kind with a `model` entry automatically from there — no other code
changes needed, and every kind still works with no `model` entry at all (procedural box, unchanged).
**As of this writing, no shipped kind actually uses `model` yet** — the whole pipeline exists and is
wired up, but live rendering is still 100% procedural boxes until someone actually commits a `.glb` and
wires it in.

## What it deliberately doesn't do

- **No login, no D1, no save-to-server.** Everything leaves the page as a local JSON file or clipboard
  text — there's no API endpoint here to gate, which is why `render.supremacy.live` (see
  [ARCHITECTURE.md](ARCHITECTURE.md) → Static client) serves it unauthenticated, same as
  `editor.supremacy.live`'s own page-serving (only the map editor's *save* endpoint is gated).
- **Board View reads the static `duel` board, not the live D1-backed one.** Unlike the map editor,
  this page has no session, so it can't call the authenticated `GET /api/maps/duel` the way
  `editor.html` does — it always shows whatever `MAPS.duel` looks like in the currently-deployed
  `map.js`, which can be stale relative to whatever a GM has actually saved through the map editor.
  Fine for checking a prop against realistic geometry; not a live preview of the actual production
  board.
- **Not linked from any in-app navigation.** Reachable only by URL — no link to it exists anywhere in
  the game client or the map editor. A GM or dev has to already know `render.supremacy.live` exists.
- **Doesn't follow the Command Console design system** (`public/tokens.css`) the rest of the client
  does — the same carve-out `public/proto3d.html` has (see [RENDERING.md](RENDERING.md)). That
  exemption was originally justified by having no real URL at all to reach either page from; now that
  `render.supremacy.live` is a real, routed hostname, that justification is weaker than it used to be.
  Flagged here for visibility — not something changed as part of wiring up the route, and not a call
  for this doc to make unilaterally (`design-system/` changes route through Alex specifically per
  [`.github/CODEOWNERS`](../.github/CODEOWNERS)).

## Where the code lives

| Piece | Purpose |
|---|---|
| `public/tile-placer.html` | Page shell, both views' DOM/CSS |
| `public/tile-placer/main.js` | Tile View — scene, spawn/select/gizmo, save/load |
| `public/tile-placer/board.js` | Board View — same authoring flow, plus the real board geometry, tile-colour overrides, and the STRUCTURE_KIT export action |
| `public/tile-placer/selection.js` | Gizmo setup, click-vs-drag detection, and object removal — the parts genuinely identical between Tile View and Board View, factored out so a fix to one can't silently drift from the other |
| `public/tile-placer/dispose.js` | GPU resource cleanup (geometry/material/texture) for removed objects and rebuilt board tiles — both views place/remove/rebuild continuously while tuning a layout |
| `public/tile-placer/glb.js` | Loads a dropped `.glb`/`.gltf`, normalizes it to the game's convention (shared with `board-render-3d.js` via [`public/model-normalize.js`](../public/model-normalize.js) — one implementation, not two independently hand-copied ones), registers it as a placeable type |
| `public/tile-placer/objects.js` | The placeable-type registry (built-ins + runtime-registered `.glb` types) |
| `public/tile-placer/barrier.js` | The one built-in prop type ("Road Barrier"), built procedurally rather than from a `.glb` |
| `public/tile-placer/gridTexture.js`, `tabs.js`, `toast.js` | Tile texture generation, the Tile View/Board View tab switcher + app-wide drag-and-drop, and toast notifications |
| `public/models/` | Checked-in `.glb` binaries — see that directory's own `README.md` for the exact commit/wire-in steps |

## Related docs

- [MAP_SYSTEM.md](MAP_SYSTEM.md) → `STRUCTURE_KIT`'s optional `model` field — the data shape this
  tool's export feeds into.
- [RENDERING.md](RENDERING.md) → Structures — how `board-render-3d.js` loads and falls back on a
  `model` entry.
- [ARCHITECTURE.md](ARCHITECTURE.md) → Static client — the `render.supremacy.live` routing.
- [EDITOR_UPGRADE.md](EDITOR_UPGRADE.md) — a **different** tool: the map/sector editor at
  `editor.supremacy.live`, which authors board *content* (territories, cities, starting ownership).
  Easy to conflate since both are "an editor for the game" — see
  [GLOSSARY.md](GLOSSARY.md) for the naming distinction.
