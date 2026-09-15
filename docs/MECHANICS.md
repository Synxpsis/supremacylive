# Mechanics

The simulation lives entirely in `public/sim.js` (global `FPSim`), operating on a board built by
`public/map.js` (`FPMap`). It is deliberately **pure, integer-only, and fixed-timestep**: the same
sequence of commands replayed against the same board produces byte-identical state, every time, on
every machine. That determinism is not a nicety — it's what makes the whole netcode model possible
(see [ARCHITECTURE.md](ARCHITECTURE.md)): both clients in an online match run their own full copy of
the sim and only need to agree on *inputs*, not on any server-computed result.

If you haven't read [GLOSSARY.md](GLOSSARY.md) yet, do that first — "province," "territory," and
"tile" mean specific, non-interchangeable things below.

## The tick

`RULES.tickHz = 20` — one step is 1/20th of a second. `sim.step(S, M)` advances state by exactly one
tick and is called in a loop by whatever's driving the clock (the client's own loop against the AI, or
`match.js`'s lockstep relay online). Nothing in the sim reads the wall clock or `Math.random` — see
"Determinism" below.

## State shape (`S`, from `FPSim.create(M)`)

| Field | Shape | Meaning |
|---|---|---|
| `tick` | int | Ticks elapsed since match start |
| `owners` | `{ "c,r": seat \| null }` | Tile → owning seat, or unclaimed |
| `garrisons` | `{ "c,r": int }` | Troop count standing on a tile |
| `barracks` | `{ "c,r": seat }` | Tiles with a barracks, and who built it |
| `industry` | `{ "c,r": seat }` | Tiles with an industry building |
| `stacks` | `[{ id, seat, count, path, leg, prog, from }]` | Troops currently in transit |
| `money` | `[seat0, seat1]` | Coin, in **milli-coin** (integer, ×1000 of displayed value) |
| `over` | `seat \| null` | Set once the match has a winner |

## Currency: coin

The only currency. Stored as milli-coin to avoid float rounding ever diverging between two clients.
Two income sources, both continuous (paid every tick, scaled by `1000 / tickHz`):

- **Capitals.** Every capital you hold pays its `wealth` value per second, always — this is the
  baseline income and the reason capturing a territory (not just land) matters. A territory has exactly
  one capital, marked explicitly (`FPMap.capitalOf()`/the map editor's "Make capital" toggle) rather
  than inferred from position — see [GLOSSARY.md](GLOSSARY.md) → Capital. A city that isn't the capital
  carries a `wealth` value too, but nothing reads it; it pays nothing while held.
- **Industry.** A flat `RULES.industryYield` (1.5 coin/s) per industry building you still hold. Razed
  automatically the instant the tile changes hands (`step()` deletes any `S.industry[k]` whose owner
  no longer matches).

There is no other currency, no trading, no player-to-player transfer.

## Units: troops

There is exactly one unit type. A troop count is just an integer sitting on a tile (`garrisons`) or
moving between tiles (a `stack`). No unit classes, no upgrades, no per-unit stats — see
[CONTENT_INVENTORY.md](CONTENT_INVENTORY.md) for what a future unit roster would need to slot into.

Troops are produced by **barracks**: every `RULES.barrackEvery` ticks (50 ticks = 2.5s), each barracks
you own adds one trooper to its tile's garrison, capped at `RULES.barrackCap` (150) per tile.

## Structures

One structure per tile, mutually exclusive, and destroyed the instant the tile is captured
(`step()`'s capture block deletes both `barracks[k]` and `industry[k]` unconditionally on any
ownership change, including a wholesale territory flip from a capital falling).

| Structure | Built by | Cost | Effect | Restrictions |
|---|---|---|---|---|
| Barracks | `sim.build(S, M, seat, c, r)` | `barrackCost()` — escalates per barracks you already own (`barrackBase * barrackStep^n`, from the board's `tuning`) | +1 troop every 2.5s on that tile, capped at 150 | Requires full territory ownership (see below) |
| Industry | `sim.industry(S, M, seat, c, r)` | Flat `RULES.industryCost` (25 coin) | +1.5 coin/s while held | Barred on capital tiles ("capitals already pay"); requires full territory ownership |

**Full territory ownership is required to build**, not just ownership of the clicked tile — a tile you
captured inside a territory whose capital hasn't fallen yet is still contested, and `build`/`industry`
both check `territoryOwner(M, S.owners, p) === seat`, returning `'territory not secured'` otherwise.
(This was a bug until the fix landed — see [KNOWN_ISSUES.md](KNOWN_ISSUES.md) history.)

A board can also **pre-seed** non-capital barracks/industry at kickoff via its `structures` field (see
[MAP_SYSTEM.md](MAP_SYSTEM.md)) — `sim.create()` folds these into `barracks`/`industry` the same way it
already auto-seeds a barracks under every home capital, and from then on they're indistinguishable from
a player-built one (same razing-on-capture rule above). Authored via the map editor, not a player
command.

## Commands

The complete set of player-issued actions — a human and the AI call exactly the same four functions,
with no privileged path for either (`ai.js`'s own header: "Anything it can do, you can."):

| Command | Signature | Does |
|---|---|---|
| `build` | `(S, M, seat, c, r)` | Raise a barracks |
| `industry` | `(S, M, seat, c, r)` | Develop industry |
| `march` | `(S, M, seat, from, to, pct)` | Send `pct`% of `from`'s garrison toward `to`, along the cheapest route |
| `reinforce` | `(S, M, seat, c, r)` | Rally every garrison in the target territory and its orthogonal neighbours to one tile, each source keeping 1 trooper behind |

Every command returns `null` on success or a short lowercase error string on failure (`'not yours'`,
`'no route'`, `'already built'`, `'territory not secured'`, etc.) — these strings are what the client
shows verbatim in the match notice bar.

## Movement and roads

Troops move tile-to-tile, taking `hopCost()` ticks to enter each tile along the way:
`RULES.hopTicks` (14 ticks, ~0.7s) on a **road** tile, `RULES.offRoadTicks` (28 ticks, twice as slow)
off-road. Roads are the centre cross of every territory (`isRoad()`), which line up across abutting
territories into continuous highways connecting every capital — no manual road authoring needed, it
falls out of the grid geometry.

`march` and `reinforce` both route via `FPMap.travelPath()`, a deterministic Dijkstra (ties broken by
sorted tile key) that will cut across open country but naturally prefers the cheaper road network.

## Combat

Resolved once per tick, in `step()`, in three cases — always **pure subtraction**; the larger force
survives with the difference, equal forces annihilate:

1. **Field combat.** Two opposing stacks meeting head-on (crossing the same edge in opposite
   directions) or standing on the same tile simultaneously fight before either moves further that
   tick. Resolved in ascending stack-id order, never object/array iteration order, so the outcome is
   identical on every machine regardless of when each stack happened to be created.
2. **Assault.** A stack arriving at a tile it doesn't own fights the garrison standing there. If the
   attacker's count exceeds the garrison, the tile (and everything on it — barracks/industry razed)
   flips to the attacker; the survivors continue their march. Otherwise the garrison survives, reduced
   by the attacker's full count, and the attacking stack is destroyed.
3. **Capital capture cascades.** If the tile captured in (2) is a territory's centre (its capital),
   **the entire territory changes hands at once** — every tile in it flips to the attacker and every
   structure on them is razed, in the same tick. This is the core strategic fact of the game: you
   don't have to grind out every tile of a territory, only take its capital.

## Win and loss

Checked once per tick, in `step()`, after combat resolves:

- **Territory threshold.** `sc.needed` is the map's configured win count (`map.win.territories`,
  falling back to *every* territory on the board if unset — which is the case for both `duel` and
  `solo` today). The first seat to reach `needed` owned territories wins immediately.
- **Elimination.** A seat reduced to **zero territories** loses immediately, and the other seat wins —
  even if the winner hasn't yet reached the threshold above (there can still be neutral/contested
  territory on the board). Only checked in an actual 2-seat match (`M.seats === 2`); the single-player
  `solo` board never populates a real seat 1, so this check is skipped there rather than firing on
  tick one.

`S.over` is set to the winning seat and never reset. Once set, `step()` still runs (nothing halts the
tick loop itself) but no further win/loss check occurs.

## Determinism

Everything above is written to be bit-for-bit reproducible: integer-only math, no floats in state, no
`Math.random`, no wall-clock reads inside the sim itself (ticks are counted, not timed). `sim.hash(S)`
is an FNV-1a hash over the entire integer state — the "desync tripwire" `match.js` polls periodically
to catch the two clients' local sims silently diverging (see [ARCHITECTURE.md](ARCHITECTURE.md)).

The AI (`ai.js`) follows the same rule: no `Math.random`, no wall clock. Its tie-breaking uses a
seeded integer hash (`jitter(seed, key)`) instead, so its behavior is exactly reproducible from
`(state, board, tick)` alone — see [AI.md](AI.md).
