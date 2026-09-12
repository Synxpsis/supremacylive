# Editor upgrade — closing the gap to the 3D standard

The map/board data model ([MAP_SYSTEM.md](MAP_SYSTEM.md)) and the 3D renderer
([RENDERING.md](RENDERING.md)) are the standard going forward. `public/editor.html` — the only tool
that authors board content today — predates both: it only knows the 2D renderer, and its editing
model covers a fraction of what the data format and the 3D renderer already support. This doc
inventories exactly where editor.html stands today and lays out what closing that gap looks like.

Nothing here has been built yet — this is the plan, not a changelog. Update the checklist items to
"done" (with a commit reference) as they land, the way [KNOWN_ISSUES.md](KNOWN_ISSUES.md) tracks fixes.

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
- Preview through the 2D canvas renderer only (`board-render.js`), at a fixed top-down-ish bearing.

## What it can't do — the actual gap list

Grouped by how much new work each represents, not by priority (that's a product call, not this doc's
job):

### Already supported by the data model and sim — pure editor-UI work

1. **Add or remove a whole province (territory).** The editor can rename a province that already
   exists in the loaded definition, but there is no "new province at slot (x, y)" or "delete this
   province" action anywhere. Every province the editor can touch was already in the JSON before it
   loaded.
2. **Author a sparse/water board.** Direct consequence of (1) — since you can't add or remove a
   province, you can't leave a slot empty on purpose either, even though `map.js`, the sim, and the 3D
   renderer's water mesh all already handle an empty slot correctly (see
   [MAP_SYSTEM.md](MAP_SYSTEM.md) → "Sparse boards and water"). **This is the single highest-leverage
   gap** — closing it needs no sim or renderer change at all, only editor UI to add/remove province
   entries and keep `symmetry()` satisfied (empty slots must be mirrored in pairs for `duel`).
3. **Edit a board's own dimensions** (`slots.cols/rows`, `block.w/h`). Fixed at whatever the loaded
   definition already has; there's no UI to grow or shrink a board.
4. **Edit win condition** (`win.territories`), board `name`/`note`, or `starts` (which territory each
   seat begins on). None of these have any editor UI; they can only be changed by hand-editing JSON
   before it's ever loaded into the editor.

### Needs new editor UI plus a new preview surface

5. **A 3D preview.** The editor only ever renders through `board-render.js`. Since the 3D renderer is
   the forward-looking standard, and since land/water is a purely visual distinction with zero sim
   consequence today (a gap tile behaves identically whether or not anyone can *see* it as water), the
   2D preview currently can't show a sparse board's water at all — see [RENDERING.md](RENDERING.md),
   the 2D renderer "has no concept of water." An editor that can author water needs the 3D renderer (or
   an equivalent 2D water pass, which would be duplicate work against the standard) to actually show
   what was authored.
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
9. **The structure-kit table (`KIT`) is duplicated, not shared** — see
   [RENDERING.md](RENDERING.md)'s note that `board-render.js` and `board-render-3d.js` each hardcode
   the same footprint/height figures independently. Not an editor gap by itself, but relevant if the
   editor ever wants to preview or author structure placement/sizing: there's currently no single
   source of truth to point a "structure preview" feature at. Worth hoisting into `map.js` (or a new
   shared module) before building anything in the editor that depends on it.

## Suggested sequencing

Not a commitment, just the order that minimizes wasted work — each phase's prerequisites are fully
satisfied by the phase(s) before it:

1. **Province add/remove UI** (closes gap 1) — the foundational editing primitive everything else
   builds on. Board-dimension editing (gap 3) is a natural pair with this, since growing a board and
   then having no way to populate the new slots would be a strange intermediate state.
2. **Sparse/water authoring** (gap 2) — falls out almost for free once (1) exists: "remove this
   province" already produces a valid sparse board, the only remaining work is UI affordance for doing
   it on purpose (vs. by accident) and a symmetry-aware "leave both twin slots empty" helper for `duel`.
3. **3D preview pane** (gap 5) — needed to actually see (2)'s result, and a prerequisite for treating
   the 3D renderer as the editor's primary preview rather than a bolt-on.
4. **Board switcher + non-`duel` symmetry** (gaps 6, 7) — independent of 1–3, could land in any order
   relative to them, but low value until there's more reason to edit `solo`/`grand` than exists today
   (both are shelved/unlinked — see [OVERVIEW.md](OVERVIEW.md)).
5. **Remaining metadata fields** (gap 4) — small, mechanical, no dependencies; fine to fold into
   whichever phase touches the relevant panel first.
6. **Shared `KIT` table** (gap 9) — do this before, not after, any editor feature that previews or
   edits structure placement, so that feature has one real source of truth to read instead of picking
   one of the two existing copies.

Gap 8 (richer terrain) is deliberately not sequenced — it needs a product/design decision before it's
an engineering task at all.
