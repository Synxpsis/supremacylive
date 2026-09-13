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

## What it can't do — the actual gap list

Grouped by how much new work each represents, not by priority (that's a product call, not this doc's
job):

### Already supported by the data model and sim — pure editor-UI work

1. ~~**Add or remove a whole province (territory).**~~ ✅ **Done, `a4c2834`**.
2. ~~**Author a sparse/water board.**~~ ✅ **Done, `a4c2834`** — turned out to need no dedicated
   "water mode" at all, just the add/remove-territory UI from (1); a slot with nothing in it already
   renders as water (3D) or a dashed placeholder (2D) with zero further work.
3. **Edit a board's own dimensions.** *Partially done* — `slots.cols`/`slots.rows` (how many territory
   slots the grid has) can be grown or shrunk (`a4c2834`), with a guard against shrinking out from
   under an existing territory. **`block.w`/`block.h`** (a territory's own tile footprint — 7×7 on
   `duel`, 5×5 on `grand`) is still fixed at whatever the loaded definition has; changing it would
   reshape every existing territory at once (city `lc`/`lr` positions could fall outside the new
   footprint) and has no UI or validation yet.
4. **Edit win condition** (`win.territories`), board `name`/`note`, or `starts` (which territory each
   seat begins on). None of these have any editor UI; they can only be changed by hand-editing JSON
   before it's ever loaded into the editor.

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
