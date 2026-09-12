# Glossary

Read this before the other docs. The codebase's internal names and the player-facing UI names for
the same concepts **do not match**, and it's the single easiest thing to get confused by in this
project (the author has confused themselves in-session over it more than once).

## Territory vs. province vs. tile — the important one

The board is a grid of unit cells. Cells are grouped into square blocks (7×7 for the `duel` board).
Three different words apply to two different things, depending on whether you're reading code or
reading the screen:

| Concept | Code calls it | Player-facing UI calls it |
|---|---|---|
| One unit grid cell (`(c, r)`, keyed `"c,r"`) | **tile** (`tileKey`, `S.owners[key]`, `S.garrisons[key]`) | **Province** (sidebar field `Province: Open ground` / `Territory capital`) |
| A 7×7 block of tiles with one capital at its centre | **province** (the `M.provinces` array, `{ id: 'verrand', ... }`) | **Territory** (sidebar field `Territory held by`) |

So `map.js`'s `territoryOwner(map, owners, p)` — despite the name — answers "who owns this
**province-struct** (UI: territory)", and the UI's "Province" field on a selected cell is describing
what the code calls a **tile**. `game.html:1486-1487` is the clearest place to see both labels used
correctly side by side.

Codenamed **"Four Provinces"** internally (see the header comments in `map.js` and `sim.js`) — that
name predates the `Territory` / `Province` UI copy and refers to the province-structs, not tiles.

When these docs need to talk about the 7×7 block, they say **territory**, matching the UI. When they
need the individual cell, they say **tile**, to avoid colliding with the UI's own use of "province."

## Seat

A player slot in a match — `0` or `1` today (2-seat matches only; see [MECHANICS.md](MECHANICS.md)).
`null` owner means neutral/unclaimed. The client always renders "seat 0" as `--sl-faction-self` and
"seat 1" as `--sl-faction-foe` **from the viewing player's own perspective** — a spectate or replay
view would need its own seat remapping, which doesn't exist yet (there's no spectate/replay feature).

## Capital

The city on a territory's centre tile. Capturing it flips ownership of every tile in the whole
territory at once (see [MECHANICS.md](MECHANICS.md) → Combat). Every territory has exactly one.

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

## Tick

One fixed simulation step, 1/20th of a second (`RULES.tickHz = 20`). All game state advances in whole
ticks; there is no continuous/frame-rate-dependent simulation. See [MECHANICS.md](MECHANICS.md).

## Coin / money

The one currency. Stored as **milli-coin** (`S.money[seat]`, integer, ×1000 of the displayed value) —
never a float — so the deterministic, replayable simulation never has to worry about float rounding
differing between two clients' CPUs/JS engines.
