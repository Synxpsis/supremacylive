# AI opponent

`public/ai.js` (global `FPAI`). Plays a seat by issuing exactly the same commands a human player would
— `build`, `industry`, `march`, `reinforce` via `sim.js` — with no privileged access to hidden state
and no separate code path. Per its own header comment: "Anything it can do, you can."

## Determinism

No `Math.random`, no wall clock. Every decision is a pure function of `(state, board, tick)`. Where
the bot needs to break a tie (which barracks site, which target to attack first), it uses a seeded
integer hash (`jitter(seed, key)`, salted off the sim's seed or the current tick) instead of randomness
— an AI with a real random source would break the determinism the whole netcode model depends on (see
[MECHANICS.md](MECHANICS.md) → Determinism, [ARCHITECTURE.md](ARCHITECTURE.md)).

## Difficulty levels

```js
LEVELS = {
  Passive:  { everyTicks: 60, margin: 1.5,  keep: 5, maxOpen: 2,  industryAt: 140, maxBarracks: 4,   attacksPerThink: 1 },
  Steady:   { everyTicks: 24, margin: 1.15, keep: 3, maxOpen: 10, industryAt: 80,  maxBarracks: 14,  attacksPerThink: 4 },
  Ruthless: { everyTicks: 14, margin: 1.05, keep: 2, maxOpen: 18, industryAt: 55,  maxBarracks: 999, attacksPerThink: 6 },
};
```

| Field | Meaning |
|---|---|
| `everyTicks` | How often the bot "thinks" at all — lower is more responsive/aggressive |
| `margin` | Attack force sizing: send at least `garrison × margin` troops, so a fight isn't a coin-flip |
| `keep` | Troops always left behind on a tile that sends an attack |
| `maxOpen` | Cap on the bot's own simultaneous in-transit stacks |
| `industryAt` | Coin threshold (in whole coin) before it'll spend on industry instead of hoarding/building |
| `maxBarracks` | Hard cap on barracks it will ever build |
| `attacksPerThink` | Marches it can launch in a single think tick |

`None` (no AI at all) is handled entirely client-side in `game.html`/`index.html` — it's simply never
invoked, not a fourth entry in `LEVELS`.

## What it does each think tick (`think(S, M, seat, levelName)`)

Runs only when `S.tick % L.everyTicks === 0` and `S.over === null`. Four passes, in order, all in the
same tick — the old version did at most one action per think and felt sluggish; this one fires
whichever of the four apply:

1. **Defend.** For each capital the bot holds, sum incoming enemy stacks headed for it
   (`threatTo()`). If the garrison wouldn't survive, `reinforce` that capital — pulling in every
   nearby garrison in one command (see [MECHANICS.md](MECHANICS.md) → `reinforce`).
2. **Build barracks.** Candidate tiles are any owned tile without a structure, scored by distance to
   the estimated enemy home (`enemyHome()` — closer is better, so new troops don't have far to march
   to matter) with a bonus for road tiles (raised troops can march immediately) and a small seeded
   jitter so builds aren't perfectly predictable move-to-move. Builds until `maxBarracks` or the
   treasury runs out.
3. **Industry.** Only once money clears `industryAt`; picks the first eligible owned tile
   (sorted key order) and develops it — at most one per think tick.
4. **Attack.** Repeatedly picks the best `(force, target)` pair — scored by route length plus target
   garrison, minus a bonus for neutral capitals, plus jitter — and launches a `march`, until it hits
   `attacksPerThink` or `maxOpen` simultaneous stacks. Target scoring is precomputed with a cheap
   "floor" bound so the inner loop can bail early once no remaining target could beat the current best,
   and pathfinding results are memoized within a single think call (`pathCache`) — this matters on
   `grand`: an unmemoized forces × targets × BFS-over-625-tiles product measured over a million
   operations per `Ruthless` think and visibly stuttered the client. (`grand` is currently shelved —
   see [KNOWN_ISSUES.md](KNOWN_ISSUES.md) — but the AI code itself is unchanged and would hit the same
   cost again if it came back.)

`think()` returns a short human-readable reason string for whichever action it took (e.g. `"raising a
barracks"`, `"pressing the enemy line"`) — the caller surfaces the *last* interesting one to the match
HUD as a lightweight "what is the AI doing" hint.
