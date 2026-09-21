# Glossary

Read this before the other docs. The codebase's internal names and the player-facing UI names for
the same concepts **do not match**, and it's the single easiest thing to get confused by in this
project (the author has confused themselves in-session over it more than once).

## Territory vs. province vs. tile — the important one

The board is a grid of unit cells. Cells are grouped into square blocks (5×5 for the `duel` board,
`block.w`/`block.h` — see [MAP_SYSTEM.md](MAP_SYSTEM.md); not fixed across every board, `grand` uses
5×5 too but a different `slots` grid, and a board can set any size). Three different words apply to
two different things, depending on whether you're reading code or reading the screen:

| Concept | Code calls it | Player-facing UI calls it |
|---|---|---|
| One unit grid cell (`(c, r)`, keyed `"c,r"`) | **tile** (`tileKey`, `S.owners[key]`, `S.garrisons[key]`) | **Province** (sidebar field `Province: Open ground` / `Territory capital`) |
| A `block`-sized block of tiles with one capital at its centre | **province** (the `M.provinces` array, `{ id: 'verrand', ... }`) | **Territory** (sidebar field `Territory held by`) |

So `map.js`'s `territoryOwner(map, owners, p)` — despite the name — answers "who owns this
**province-struct** (UI: territory)", and the UI's "Province" field on a selected cell is describing
what the code calls a **tile**. `game.html:1486-1487` is the clearest place to see both labels used
correctly side by side.

Codenamed **"Four Provinces"** internally (see the header comments in `map.js` and `sim.js`) — that
name predates the `Territory` / `Province` UI copy and refers to the province-structs, not tiles.

When these docs need to talk about a `block`-sized block, they say **territory**, matching the UI.
When they need the individual cell, they say **tile**, to avoid colliding with the UI's own use of
"province."

**A third name entered the mix 2026-09-13: `editor.html` now calls the same province-struct a
"Sector"** in its own UI text only (button labels, the sidebar list, tile-inspector copy) — the game's
player-facing UI still says "Territory" and the code still says `province`/`territoryAt()`/etc.,
unchanged. So as of this addition there are three names for one concept depending on where you're
looking: code → `province`, match UI → **Territory**, editor UI → **Sector**. This was a deliberate,
scoped decision (UI text only, fast to ship) rather than the deeper rename — **flagged here as
still-open plumbing work**: the whole codebase (function/field names throughout `map.js`, `sim.js`,
`board-render*.js`, `game.html`, `editor.html`, and these docs) should eventually be standardized on
one name, not three. Until that lands, treat "Sector" as editor-only vocabulary — don't assume it
appears anywhere else, including this glossary's own table above.

## Seat

A player slot in a match — `0` or `1` internally (2-seat matches only; see [MECHANICS.md](MECHANICS.md)),
and everywhere in code, storage, and the match UI that number is what you'll see. `null` owner means
neutral/unclaimed. The client always renders "seat 0" as `--sl-faction-self` and "seat 1" as
`--sl-faction-foe` **from the viewing player's own perspective** — a spectate or replay view would need
its own seat remapping, which doesn't exist yet (there's no spectate/replay feature).

**`editor.html` displays these as "Seat 1"/"Seat 2"** (2026-09-13) — a display-only relabelling (GM/
human-facing seats count from one) with the stored value and every internal seat index still `0`/`1`,
completely unchanged; the editor just adds 1 when it prints the label and subtracts 1 when it reads a
dropdown back. There is no viewer-relative colour in the editor either (there's no "viewing player" —
the GM sees the whole board) — its colour mapping is fixed: seat `0` ("Seat 1") is always
`--sl-faction-self` (blue), seat `1` ("Seat 2") is always `--sl-faction-foe` (red), matching what a
seat-0 player would see, not remapped per seat. **Still open plumbing work, same as the Sector rename
above**: only the editor's *display* was changed; the match UI, storage, and every internal seat index
still read `0`/`1` and probably should move to the same 1/2 convention eventually for the naming to
actually be standardized project-wide rather than split between two conventions.

## Capital

The one city in a territory marked `capital: true` (`FPMap.capitalOf()`) — what pays that territory's
income while held (see [MECHANICS.md](MECHANICS.md) → Coin). Every territory has exactly one, enforced
at save time (`FPMap.capitalIssues()`, `worker.js`'s `handlePutMap`). **Not the same tile as the
territory's centre** (2026-09-14) — capturing the *centre* tile is what flips ownership of the whole
territory at once (see [MECHANICS.md](MECHANICS.md) → Combat); the capital city can sit anywhere in the
territory and still pay out. The two used to always be the same tile by convention, which is why they're
easy to conflate in older code/docs — if you see "capital" meaning "centre tile," that's the
pre-2026-09-14 sense.

## Garrison

The troop count standing on one tile. Whole units only (no fractional troops); stored per tile key in
`S.garrisons`.

## Stack

Troops in transit between tiles — created by `march`/`reinforce`, resolved tick by tick in `step()`,
removed once they arrive or are destroyed in combat. Not the same as a garrison (a garrison is
stationary; a stack is moving).

## Structure

A barracks or an industry building. One per tile, mutually exclusive, razed automatically if the tile
changes hands. See [MECHANICS.md](MECHANICS.md) and [CONTENT_INVENTORY.md](CONTENT_INVENTORY.md).

## Board vs. map

Used interchangeably in code and these docs for one of the entries in `MAPS` (`duel`, `solo`, `grand`)
— the static/DB-backed definition plus everything `FPMap.build()` derives from it (tile origins, city
list, march-distance matrix, etc.). "Map" is also the name of the standalone in-browser editor
(`editor.html`, at `editor.supremacy.live`) for authoring these.

**Not to be confused with the Tile Placer** (`tile-placer.html`, at `render.supremacy.live`, see
[TILE_PLACER.md](TILE_PLACER.md)) — a completely different tool, built and maintained by Matt, for
tuning a `.glb` model's scale/rotation against a tile before wiring it into `STRUCTURE_KIT`. The map
editor authors board *content* (territories, cities, starting ownership); the tile placer authors
*structure appearance*. Both are reachable only by their own subdomain, both call themselves "editor"-
adjacent things in casual conversation, and that's exactly how the two get mixed up.

## Tick

One fixed simulation step, 1/20th of a second (`RULES.tickHz = 20`). All game state advances in whole
ticks; there is no continuous/frame-rate-dependent simulation. See [MECHANICS.md](MECHANICS.md).

## Coin / money

The one currency. Stored as **milli-coin** (`S.money[seat]`, integer, ×1000 of the displayed value) —
never a float — so the deterministic, replayable simulation never has to worry about float rounding
differing between two clients' CPUs/JS engines.
