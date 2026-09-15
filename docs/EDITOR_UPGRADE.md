# Editor upgrade — closing the gap to the 3D standard

The map/board data model ([MAP_SYSTEM.md](MAP_SYSTEM.md)) and the 3D renderer
([RENDERING.md](RENDERING.md)) are the standard going forward. `public/editor.html` — the only tool
that authors board content today — predates both: it only knows the 2D renderer, and its editing
model covers a fraction of what the data format and the 3D renderer already support. This doc
inventories exactly where editor.html stands today and lays out what closing that gap looks like.

This is a living plan, not a one-time spec — checklist items are marked done (with a commit
reference) as they land, the way [KNOWN_ISSUES.md](KNOWN_ISSUES.md) tracks fixes. Five items are done
as of 2026-09-12 (`ba103ce`, `a4c2834`); the rest are still open.

## What `editor.html` can do today

- Log in (reuses the site's own session cookie/auth).
- Load **one specific board key — `duel`, hardcoded** (`S.key = 'duel'` in the source; there is no key
  selector in the UI at all).
- Rename an existing province (territory).
- Add a city to open ground inside an existing province, at a clicked tile.
- Edit a city's name, local position, seat (neutral/0/1), wealth, and (if neutral) garrison.
- Delete a city.
- Mirror a city's stats onto its twin (copies wealth; seat flips, or garrison copies if neutral).
- See a live pass/fail symmetry check (`FPMap.symmetry()`), but **only when editing `duel`** — the
  check is unconditionally skipped for every other key.
- Save the whole definition back to `PUT /api/maps/:key`, or discard and reload.
- **Preview and edit through either renderer**, toggled via a header button — the 2D canvas
  (`board-render.js`, fixed top-down-ish bearing) or the full 3D scene (`board-render-3d.js`, real
  orbit camera). Both are fully interactive, not preview-only: click-to-select and Add-City-mode work
  identically against either one, and edits recolor/reposition live in whichever is showing. The
  renderer choice persists across reloads (shared `sl_render_mode` localStorage key with
  `game.html`/`index.html`). ✅ **Done, `ba103ce`** — closes gap 5 below.
- **Grow or shrink the board's slot grid** (`slots.cols`/`slots.rows` only — `block.w`/`h`, a
  territory's own tile footprint, still isn't editable). Growing only ever adds empty slots; shrinking
  is refused with an inline message if it would orphan a territory outside the new bounds.
  ✅ **Done, `a4c2834`** — partially closes gap 3 below.
- **Add or remove a whole territory.** Clicking empty ground (2D or 3D) selects the slot underneath
  and offers "Add territory here" — seeds a new province plus a capital city at its centre tile with
  neutral defaults. Selecting an existing territory offers "Remove territory" (a two-click confirm,
  not a dialog — see gap 1's note below). This is also, automatically, sparse/water-board authoring:
  removing a territory (or growing the grid without filling every new slot) leaves genuine empty
  ground, which the 3D view already renders as water and the 2D view already renders as a dashed "+"
  placeholder — no separate "water mode" was needed. ✅ **Done, `a4c2834`** — closes gaps 1 and 2 below.
- **Pre-place starting industry/barracks, and inspect any single tile.** Every click — a city, a
  structure, open ground inside a territory, or open water — now resolves to one tile inspector for
  that exact tile, instead of a click meaning three different things depending on content (city select
  vs. whole-territory select vs. slot select). A data-driven placement toolbar (Add City / Add Industry
  / Add Barracks) lets you author non-capital structures directly into the board definition's new
  `structures` array (see [MAP_SYSTEM.md](MAP_SYSTEM.md)), seeded into the match by `sim.create()`
  alongside the existing auto-seeded home-capital barracks. The structure kit
  (`FPMap.STRUCTURE_KIT`/`AUTHORABLE_KINDS`) is the single table driving both the piece-rendering
  numbers and which kinds the editor's placement toolbar offers, so a future kind (naval base, missile
  silo, airbase, ...) is one table entry, not new editor branching — groundwork for the naval/air
  content direction, not that content itself; no water-terrain or naval/air data model exists yet (gap
  8 below is unchanged). ✅ **Done, 2026-09-12.**
- **Clear the whole board, and a free-orbiting 3D camera while authoring.** Two related fixes from live
  usage: (1) the 3D view's camera lock — recentre-and-freeze on whatever's selected, borrowed as-is from
  `game.html` — engaged on nearly every click here (since every click selects *something*, even open
  water), making free navigation fight the lock constantly; `board-render-3d.js`'s `create()` now takes
  a `selectionLock: false` option the editor passes and the game doesn't, so this view always orbits
  freely (see [RENDERING.md](RENDERING.md)). (2) A city's *piece* in the 3D view was keyed off the board
  object handed to `create()` once at scene setup, not read fresh each frame the way ownership/garrisons
  already were — deleting or adding a city left a stale (or missing) piece on screen until an unrelated
  action happened to force a full scene rebuild, while the side panel and hit-testing were already
  correct underneath. `update()` now takes the live city list as `o.cities` instead. Also added a
  **"Clear board" action** (`Board actions` section, two-click confirm like Remove Territory) that wipes
  every city and structure but keeps the territories/grid, for restarting authoring from a clean slate.
  ✅ **Done, 2026-09-13.**
- **Grid-reference labels in the 3D view, GM-first authoring defaults, per-territory starting seat, and
  editable territory size.** Five changes from one pass of live GM feedback: (1) `board-render-3d.js`'s
  `create()` gained a `gridLabels` option (editor-only, `game.html` doesn't pass it) that draws static
  column-letter/row-number axis labels along the board's two edges, so a tile can be referenced by grid
  coordinate (e.g. "the tile at C, 4") the way a tabletop battle-grid works. (2) A new city or territory
  is created with no name at all instead of a fantasy name drawn from a pool — the GM names their own
  world, and "Clear board" now blanks existing territory names too, not just cities/structures (see
  [MAP_SYSTEM.md](MAP_SYSTEM.md)). (3) Each territory in the sidebar list gets a starting-seat selector
  (Neutral/Seat 1/Seat 2, colour-coded), editing the board's `starts` field directly and keeping the
  territory's capital in step. (4) The Board panel gained sector-size inputs (`block.w`/`h`, tiles per
  territory) alongside the existing slot-grid ones, closing former gap 3 below. (5) The editor's own UI
  text now says "Sector" instead of "Territory" and "Seat 1"/"Seat 2" instead of "Seat 0"/"Seat 1" — a
  deliberately scoped, UI-text-only pass (no rename of `province`/`territoryAt()`/etc. in code, no
  change to the stored `0`/`1` seat values) — see [GLOSSARY.md](GLOSSARY.md) for the three-way naming
  situation this creates and the plumbing work still open to actually unify it. ✅ **Done, 2026-09-13.**
- **Fix: assigning a sector's starting seat didn't actually colour the sector.** The bug behind
  "only the exact centre tile seems to set a whole sector's colour," found immediately after the above
  shipped: `overlay()` built its `owners` map purely from individual cities' own `seat` fields, so a
  sector only read as owned where a city happened to sit *and* have a matching seat — and since
  `territoryOwner()` (map.js) only ever checks the centre tile, a city was only ever "the one that
  colours everything" when it happened to be placed exactly there. `overlay()` now starts from
  `FPMap.seedOwners(S.built)` — the same function `sim.create()` calls at kickoff — so the sector's
  *entire* footprint colours the instant a starting seat is assigned via the sidebar selector, matching
  what a real match would actually look like; individual cities' `seat` fields still layer on top for a
  GM who wants one specific tile to differ, but are no longer required for a sector to read as owned at
  all. Also added a cap of one owned sector per seat in `setStartingSeat()` — assigning a new sector to
  a seat that already owns one moves the assignment rather than creating a second home, keeping both
  `starts` and the displaced sector's capital in step. ✅ **Done, 2026-09-13.**
- **Fix: removing a sector left its land and grid lines stuck in the 3D view, and water tiles read as
  one undivided blob.** Two related bugs found while dogfooding "remove a sector" for the first time
  against a real board. (1) `removeTerritory()` called `select(null)` — which also repaints — *between*
  `reset3D()` and `rebuild()`. Since `ensure3D()` only rebuilds the scene lazily (reuses `_r3d` if
  already set), that stray repaint let the scene get eagerly recreated from the still-stale board (the
  sector not yet removed from `S.built`); `rebuild()`'s own repaint right after then found `_r3d`
  already set and skipped rebuilding it, so the removed sector's land and grid lines stuck around
  permanently in 3D even though the tile inspector (reading the now-correct board) already called it
  open water. Reordered to `reset3D()` → `rebuild()` → `select(null)`, matching `addTerritory()`'s
  already-correct order. (2) Once the scene *was* rebuilt correctly, an empty slot's water tiles had no
  grid lines between them at all (the line-drawing loop only ever iterated existing provinces), so 49
  individually clickable tiles rendered as one flat quad. See [RENDERING.md](RENDERING.md) →
  Ground, [MAP_SYSTEM.md](MAP_SYSTEM.md) → Sparse boards and water. ✅ **Done, 2026-09-14, `855e2bf`.**
- **Fix: any content edit snapped the 3D camera back to the default view.** Every edit that changes
  land/water layout (add/remove sector, resize) forces a full scene rebuild, and `create()` always
  seeded a fresh camera at the default overview framing with no memory of where the previous scene's
  camera was — so orbiting or zooming in, then adding or removing one sector, threw the view straight
  back to the default angle. `reset3D()` now saves the outgoing scene's camera position/orbit-target
  before disposing it, and the next `create()` call seeds the new camera/controls from that saved pose
  instead of the default framing (see [RENDERING.md](RENDERING.md) → Camera).
  ✅ **Done, 2026-09-14, `45068e4`.**

## What it can't do — the actual gap list

Grouped by how much new work each represents, not by priority (that's a product call, not this doc's
job):

### Already supported by the data model and sim — pure editor-UI work

1. ~~**Add or remove a whole province (territory).**~~ ✅ **Done, `a4c2834`**.
2. ~~**Author a sparse/water board.**~~ ✅ **Done, `a4c2834`** — turned out to need no dedicated
   "water mode" at all, just the add/remove-territory UI from (1); a slot with nothing in it already
   renders as water (3D) or a dashed placeholder (2D) with zero further work.
3. ~~**Edit a board's own dimensions.**~~ ✅ **Done, 2026-09-13.** Both halves now have editor UI:
   `slots.cols`/`slots.rows` (how many territory slots the grid has, `a4c2834`) and **`block.w`/
   `block.h`** (a territory's own tile footprint — 7×7 on `duel`, 5×5 on `grand`, added 2026-09-13). The
   block control refuses to shrink out from under an existing city/structure whose `lc`/`lr` would fall
   outside the new footprint, same philosophy as the slot-grid guard — but note it does *not* reposition
   anything that survives the check, and a territory's centre tile (its capital slot) moves whenever
   `block.w`/`h` changes, so resizing a territory that still has a capital placed under the old geometry
   can leave that capital off-centre. Safe order: clear the board first (see "Clear board" above,
   which is also why blank-name state matters here), resize, then re-place capitals.
4. ~~**Edit `starts` (which seat a territory begins on).**~~ ✅ **Done, 2026-09-13** — a seat/neutral
   selector next to each territory's name in the sidebar list, colour-coded to match (self-blue/
   foe-red/neutral-grey). Keeps the territory's capital in step automatically (its own `seat`/`garrison`
   fields are updated to match, since a capital disagreeing with the tiles under it would be a
   self-contradictory board). **Still no UI for win condition (`win.territories`) or board `name`/
   `note`** — those can only be changed by hand-editing JSON before it's ever loaded into the editor.

### Needs new editor UI plus a new preview surface

5. ~~**A 3D preview.**~~ ✅ **Done, `ba103ce`** — a 2D/3D toggle in the header switches the whole
   editing surface, not just a passive preview; see "What `editor.html` can do today" above. This is
   what actually makes gap 2 (water authoring) *visible* once it's built — the editor can now show
   what a sparse board's water looks like the moment gap 1/2 land, with no further rendering work.
6. **A board switcher.** `solo` and `grand` are completely unreachable from the editor UI, even though
   the API (`GET`/`PUT /api/maps/:key`) already supports any key matching `MAP_KEY`
   (`/^[a-z0-9_-]{1,40}$/i`) and `EDITOR_USERS` write access isn't board-specific.
7. **Symmetry checking for boards other than `duel`.** Trivial in isolation (the check already exists
   and takes any built board), but worth pairing with (6) since there's no reason to open `grand` in
   the editor without it — an asymmetric `grand` edit wouldn't currently warn anyone.

### Needs a data-model decision first (not just editor UI)

8. **Per-tile terrain beyond land/water.** Nothing today expresses "this land tile is rough terrain" or
   any terrain variety at all — a tile is binary (province or not). If varied terrain (not just a
   binary land/water split) is ever wanted, that's a new field on the data model and new rendering
   logic, not just an editor gap — flagged here for visibility, not proposed as a specific fix.
9. ~~**The structure-kit table (`KIT`) is duplicated, not shared.**~~ ✅ **Done, `ba103ce`** — hoisted
   into `FPMap.STRUCTURE_KIT`/`STRUCTURE_RANK`; both renderers now read the same table. Was a
   prerequisite for any future structure-placement preview, not a gap in itself — see
   [RENDERING.md](RENDERING.md).

## Suggested sequencing

Not a commitment, just the order that minimizes wasted work — each phase's prerequisites are fully
satisfied by the phase(s) before it. ~~Struck through~~ items are done.

1. ~~**Shared `KIT` table**~~ ✅ done, `ba103ce` — pulled forward ahead of its original position
   (it was sequenced last) since it turned out to be nearly free once picked up.
2. ~~**3D preview pane**~~ ✅ done, `ba103ce` — also pulled forward; turned out not to depend on
   province add/remove or water landing first the way the original sequencing assumed. The editor's
   entire editing surface (not just a preview) now works in 3D, which changes the shape of the
   remaining items below: they no longer need their *own* "and now make this visible in 3D" step.
3. ~~**Province add/remove UI, paired with grid resizing**~~ ✅ done, `a4c2834` — closed gaps 1, 2, and
   the `slots.cols`/`rows` half of gap 3 in one pass. Turned out water authoring (originally sequenced
   as its own step 4) had no separate work left once this landed — see gap 2's note.
4. **Board switcher + non-`duel` symmetry** (gaps 6, 7) — the next item with anything left to do. Low
   priority until there's more reason to edit `solo`/`grand` than exists today (both are
   shelved/unlinked — see [OVERVIEW.md](OVERVIEW.md)).
5. **Remaining metadata fields** (gap 4, plus `block.w`/`h` editing from gap 3) — small and mechanical
   for win condition/name/starts; `block.w`/`h` needs actual validation work (existing city positions
   can fall outside a shrunk footprint) so treat it as its own small task, not a drive-by field.

Gap 8 (richer terrain) is deliberately not sequenced — it needs a product/design decision before it's
an engineering task at all.
