/* Supremacy Live — opponent AI.
 *
 * Plays a seat by issuing the same commands a human has: build, industry,
 * march, reinforce. No privileged access — it reads what the client can see
 * and calls sim.js exactly like the client does. Anything it can do, you can.
 *
 * Deterministic on purpose. No Math.random, no wall clock: every decision is a
 * function of (state, board, tick). An AI with a real random source would
 * quietly destroy the property the whole netcode design rests on.
 *
 * Multi-action per think tick. The old bot did at most one thing then waited,
 * which made it feel slow and repetitive; now defend/build/industry/attack all
 * fire in the same pass, each returning a short reason string for the HUD.
 * The report the caller sees is the *last* interesting one.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FPAI = api;
})(typeof self !== 'undefined' ? self : this, function () {

  const M_ = () => (typeof self !== 'undefined' ? self : this).FPMap;
  const S_ = () => (typeof self !== 'undefined' ? self : this).FPSim;

  const LEVELS = {
    Passive:  { everyTicks: 60, margin: 1.5, keep: 5, maxOpen: 2, industryAt: 140, maxBarracks: 4, attacksPerThink: 1 },
    Steady:   { everyTicks: 24, margin: 1.15, keep: 3, maxOpen: 10, industryAt: 80,  maxBarracks: 14, attacksPerThink: 4 },
    Ruthless: { everyTicks: 14, margin: 1.05, keep: 2, maxOpen: 18, industryAt: 55, maxBarracks: 999, attacksPerThink: 6 },
  };

  /** Deterministic tiebreak: a hash of tick and key, not a random draw. Used
   *  to break ties in target picking so openings vary match-to-match without
   *  ever consulting Math.random. */
  function jitter(seed, key) {
    let h = (seed * 374761393) >>> 0;
    for (let i = 0; i < key.length; i++) h = ((h ^ key.charCodeAt(i)) * 1274126177) >>> 0;
    return (h >>> 8) / 16777216;
  }

  function forces(S, seat) {
    const out = [];
    for (const k of Object.keys(S.garrisons).sort()) {
      if ((S.owners[k] ?? null) !== seat) continue;
      const n = S.garrisons[k] || 0;
      if (n > 0) out.push({ k, n, at: k.split(',').map(Number) });
    }
    return out.sort((a, b) => b.n - a.n || (a.k < b.k ? -1 : 1));
  }

  function targets(S, M, seat) {
    const m = M_();
    const out = [];
    for (const p of M.provinces) {
      const [c, r] = m.centreTile(M, p);
      const k = m.tileKey(c, r);
      const own = S.owners[k] ?? null;
      if (own === seat) continue;
      out.push({ p, k, at: [c, r], own, garrison: S.garrisons[k] || 0 });
    }
    return out;
  }

  function threatTo(S, seat, c, r) {
    let n = 0;
    for (const st of S.stacks) {
      if (st.seat === seat) continue;
      const dest = st.path[st.path.length - 1];
      if (dest[0] === c && dest[1] === r) n += st.count;
    }
    return n;
  }

  function routeTicks(M, path) {
    const sim = S_();
    let t = 0;
    for (const [c, r] of path) t += sim.hopCost(M, c, r);
    return t;
  }

  function myCapitals(S, M, seat) {
    const m = M_();
    const out = [];
    for (const p of M.provinces) {
      const [c, r] = m.centreTile(M, p);
      const k = m.tileKey(c, r);
      if ((S.owners[k] ?? null) === seat) out.push({ p, c, r, k });
    }
    return out;
  }

  function think(S, M, seat, levelName) {
    const m = M_(), sim = S_();
    const L = LEVELS[levelName] || LEVELS.Steady;
    if (S.over !== null) return null;
    if (S.tick % L.everyTicks !== 0) return null;

    let report = null;
    // Salt tie-breaks per match so openings vary. Seat 1 (the bot) is fine to
    // salt off the seed the sim was built with; if nothing is there use tick.
    const seed = (S.seed | 0) || S.tick | 0;

    // ── 1. Defend ───────────────────────────────────────────────────────────
    // A capital about to fall is the highest-value save. Rally reinforces from
    // neighbours in one command.
    for (const cap of myCapitals(S, M, seat)) {
      const incoming = threatTo(S, seat, cap.c, cap.r);
      if (incoming === 0) continue;
      const held = S.garrisons[cap.k] || 0;
      if (held > incoming) continue;
      if (sim.reinforce(S, M, seat, cap.c, cap.r) === null) {
        report = `rallying to ${cap.p.name || 'a capital'}`;
      }
    }

    // ── 2. Build barracks aggressively ─────────────────────────────────────
    // The old pass only considered CAPITALS, but the starting capital already
    // has a barracks, so on turn one the candidate list was empty and the bot
    // never built anything more. Barracks may sit on any owned province, and
    // the sensible ones for a bot are close to the front so their troops
    // don't have to travel to matter.
    const owned = Object.keys(S.barracks).filter(k => S.barracks[k] === seat).length;
    let barracksBudget = L.maxBarracks - owned;
    if (barracksBudget > 0) {
      const enemyCorner = enemyHome(S, M, seat);
      const candidates = [];
      for (const k of Object.keys(S.owners)) {
        if (S.owners[k] !== seat) continue;
        if (k in S.barracks || k in S.industry) continue;
        const [c, r] = k.split(',').map(Number);
        // Bias toward the front: closer to the enemy corner is better.
        const d = Math.abs(c - enemyCorner[0]) + Math.abs(r - enemyCorner[1]);
        // Bias toward road tiles: troops raised there can march immediately.
        const onRoad = m.isRoad(M, c, r) ? -3 : 0;
        candidates.push({ k, c, r, score: d + onRoad + jitter(seed, k) * 2 });
      }
      candidates.sort((a, b) => a.score - b.score);
      for (const cand of candidates) {
        if (barracksBudget <= 0) break;
        const cost = sim.barrackCost(S, M, seat);
        if (S.money[seat] < cost) break;
        if (sim.build(S, M, seat, cand.c, cand.r) === null) {
          barracksBudget--;
          report = 'raising a barracks';
        }
      }
    }

    // ── 3. Industry when there's genuine surplus ───────────────────────────
    if (S.money[seat] >= L.industryAt * 1000) {
      // Interior road tiles pay the same and are cheap. One per think tick is
      // plenty — no need to blanket the map.
      const keys = Object.keys(S.owners).sort();
      for (const k of keys) {
        if (S.owners[k] !== seat) continue;
        if (k in S.barracks || k in S.industry) continue;
        const [c, r] = k.split(',').map(Number);
        if (sim.industry(S, M, seat, c, r) === null) {
          report = 'developing industry';
          break;
        }
      }
    }

    // ── 4. Attack ───────────────────────────────────────────────────────────
    // Multiple marches per think tick, so the bot keeps pressure on. Pick the
    // best (force, target) pair, launch it, mark that force as spent, repeat.
    const openStacksCount = () => { let n = 0; for (const st of S.stacks) if (st.seat === seat) n++; return n; };
    let openStacks = openStacksCount();
    let attacks = 0;
    const spent = new Set();
    const mineNow = forces(S, seat);
    // Pathfinding is memoized WITHIN a think: on the grand board late-game the
    // outer product (forces × targets × BFS-over-625) crossed a million ops
    // per Ruthless pass and the client stuttered. Caching turns repeat lookups
    // into a hash hit.
    const pathCache = new Map();
    const pathFor = (f, t) => {
      const key = f.k + '>' + t.k;
      if (pathCache.has(key)) return pathCache.get(key);
      const p = m.travelPath(M, f.at, t.at, sim.RULES.hopTicks, sim.RULES.offRoadTicks);
      const v = p && p.length ? { path: p, ticks: routeTicks(M, p) } : null;
      pathCache.set(key, v);
      return v;
    };
    // Sort targets by their attack-independent score component. When the
    // current best score is already below any remaining target's floor, the
    // inner loop can stop — no force could improve it.
    const tgtList = targets(S, M, seat).map(t => ({
      t, needed: Math.ceil(t.garrison * L.margin) + 1,
      floor: t.garrison * 4 - (t.own === null ? 0 : 130),
    })).sort((a, b) => a.floor - b.floor);

    while (attacks < L.attacksPerThink && openStacks < L.maxOpen) {
      let best = null;
      for (const { t, needed, floor } of tgtList) {
        if (best && floor >= best.score) break;
        for (const f of mineNow) {
          if (spent.has(f.k)) continue;
          const spare = (S.garrisons[f.k] || 0) - L.keep;
          if (spare < needed) continue;
          const info = pathFor(f, t);
          if (!info) continue;
          const score = info.ticks + t.garrison * 4
            - (t.own === null ? 0 : 130)
            + jitter(seed, t.k + f.k) * 22;
          if (!best || score < best.score) best = { score, f, t, needed };
        }
      }
      if (!best) break;
      const g = S.garrisons[best.f.k] || 0;
      const pct = Math.min(100, Math.ceil(best.needed * 100 / g));
      if (sim.march(S, M, seat, best.f.at, best.t.at, pct) === null) {
        spent.add(best.f.k);
        attacks++;
        openStacks++;
        report = best.t.own === null ? 'marching on a neutral capital' : 'pressing the enemy line';
      } else {
        spent.add(best.f.k);
      }
    }

    return report;
  }

  /** Rough estimate of the opponent's home — used to bias barracks toward the
   *  front. Falls back to the diagonally opposite corner if the enemy has been
   *  wiped or hasn't started, so it degrades gracefully. */
  function enemyHome(S, M, seat) {
    const m = M_();
    for (const p of M.provinces) {
      const [c, r] = m.centreTile(M, p);
      if ((S.owners[m.tileKey(c, r)] ?? null) === 1 - seat) return [c, r];
    }
    return [M.gridW - 1, M.gridH - 1];
  }

  return { LEVELS, think };
});
