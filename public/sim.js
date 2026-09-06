/* Four Provinces — simulation.
 *
 * The authoritative state machine. Pure, integer-only, fixed timestep: the same
 * command log replayed against the same board always produces the same state,
 * byte for byte. That is not tidiness — it is the precondition for putting this
 * in a Durable Object and having two clients agree.
 *
 * Rules that matter:
 *   · Every territory has a capital on its centre province. Take the capital,
 *     take the territory.
 *   · Roads are the centre cross of each territory, joined into highways.
 *     Troops may cross any province, but roads are twice the pace.
 *   · Barracks raise troops in place. They cost coin, escalating per barracks
 *     you already own — troop supply compounds, so its price has to as well.
 *   · Industry develops a province into a second income stream. Costs coin —
 *     the only sink there is, and the reason a treasury matters.
 *   · One structure per province. Capturing a province destroys what stood on it.
 *   · Combat is pure subtraction, resolved only at provinces and on the edges
 *     between them. See the combat phase in step() for the three cases.
 *
 * No wall clock, no Math.random, no floats in state. Money is milli-coin;
 * troops are whole units.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FPSim = api;
})(typeof self !== 'undefined' ? self : this, function () {

  const RULES = {
    tickHz: 20,
    hopTicks: 14,              // ticks to cross a road province (~0.7 s)
    offRoadTicks: 28,          // open country is twice the work
    barrackEvery: 50,          // one trooper every 2.5 s per barracks
    barrackCap: 150,           // a province stops raising past this
    /* A capital carries its whole territory — 25 provinces — so its garrison
     * has to be priced like the prize. At 8 a single early stack flipped a
     * territory in seconds and the board fell in about two minutes. */
    neutralCapital: 30,
    homeCapital: 20,
    industryCost: 25,          // coin, flat
    industryYield: 1.5,        // coin per second once standing
  };

  /**
   * What the next barracks costs this seat, in milli-coin. Escalates on the
   * count already standing, using the board's own tuning curve: troop supply
   * compounds, so an unpriced barracks means the first player to build ten runs
   * away with the match.
   */
  function barrackCost(S, M, seat) {
    let n = 0;
    for (const k in S.barracks) if (S.barracks[k] === seat) n++;
    const t = M.tuning;
    return Math.round(t.barrackBase * Math.pow(t.barrackStep, n)) * 1000;
  }

  /** Ticks to enter a given province. Roads are the fast lane, not a rail. */
  function hopCost(M, c, r) {
    return F().isRoad(M, c, r) ? RULES.hopTicks : RULES.offRoadTicks;
  }

  const F = () => (typeof self !== 'undefined' ? self : this).FPMap;

  /** Fresh match state for a built board. */
  function create(M) {
    const m = F();
    const owners = m.seedOwners(M);
    const garrisons = {}, barracks = {};
    for (const p of M.provinces) {
      const [c, r] = m.centreTile(M, p);
      const k = m.tileKey(c, r);
      const own = owners[k] ?? null;
      garrisons[k] = own === null ? RULES.neutralCapital : RULES.homeCapital;
      // Your home capital starts with a barracks, so there is something to do
      // on tick one.
      if (own !== null) barracks[k] = own;
    }
    return {
      tick: 0, owners, garrisons, barracks, industry: {},
      stacks: [], nextId: 1,
      money: [M.tuning.startMoney * 1000, M.tuning.startMoney * 1000],
      over: null,
    };
  }

  /** Advance exactly one tick. Mutates in place — callers clone if they need to. */
  function step(S, M) {
    const m = F();
    S.tick++;

    // Income: every capital you hold pays its wealth.
    for (const p of M.provinces) {
      const [c, r] = m.centreTile(M, p);
      const own = S.owners[m.tileKey(c, r)] ?? null;
      if (own === null) continue;
      const cap = m.capitalOf(M, p);
      if (cap) S.money[own] += Math.round(cap.wealth * 1000 / RULES.tickHz) | 0;
    }

    // Industry pays wherever it still stands on ground its owner holds.
    for (const k of Object.keys(S.industry)) {
      const seat = S.industry[k];
      if ((S.owners[k] ?? null) !== seat) { delete S.industry[k]; continue; }
      S.money[seat] += Math.round(RULES.industryYield * 1000 / RULES.tickHz) | 0;
    }

    // Barracks raise troops. A barracks on a province you no longer hold is
    // already gone, but guard anyway so state cannot drift.
    if (S.tick % RULES.barrackEvery === 0) {
      for (const k of Object.keys(S.barracks)) {
        const seat = S.barracks[k];
        if ((S.owners[k] ?? null) !== seat) { delete S.barracks[k]; continue; }
        const have = S.garrisons[k] || 0;
        if (have < RULES.barrackCap) S.garrisons[k] = have + 1;
      }
    }

    /* ── Field combat ───────────────────────────────────────────────────────
     * Armies in transit have to be able to meet, or two players sending troops
     * at each other would walk through one another and only ever fight walls.
     * Two cases, both resolved before anybody moves this tick:
     *
     *   Head-on — A is crossing X→Y while B crosses Y→X. They are on the same
     *   edge facing opposite ways, so they meet in open country.
     *
     *   Same ground — both are standing on the same province, whether passing
     *   through or just arrived.
     *
     * Ordering is by stack id, never by array position or object iteration, so
     * the outcome is identical on every machine. Pure subtraction: the larger
     * force survives with the difference, equal forces annihilate.
     */
    const standing = st => (st.leg === 0 ? st.from : st.path[st.leg - 1]);
    const live = S.stacks.filter(st => st.count > 0).sort((a, b) => a.id - b.id);
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      if (a.count <= 0) continue;
      const aAt = standing(a), aTo = a.path[a.leg];
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j];
        if (b.count <= 0 || b.seat === a.seat) continue;
        const bAt = standing(b), bTo = b.path[b.leg];
        const sameGround = aAt[0] === bAt[0] && aAt[1] === bAt[1];
        const headOn = aTo[0] === bAt[0] && aTo[1] === bAt[1]
          && bTo[0] === aAt[0] && bTo[1] === aAt[1];
        if (!sameGround && !headOn) continue;
        const loss = Math.min(a.count, b.count);
        a.count -= loss;
        b.count -= loss;
        if (a.count <= 0) break;
      }
    }
    S.stacks = S.stacks.filter(st => st.count > 0);

    /* Troops in transit. Ascending id, so when two armies reach the same
     * province on the same tick the earlier order resolves first: it takes the
     * ground, and the later one then assaults it as defended territory. */
    const moving = [...S.stacks].sort((a, b) => a.id - b.id);
    for (const st of moving) {
      if (st.count <= 0) continue;
      const [c, r] = st.path[st.leg];
      if (++st.prog < hopCost(M, c, r)) continue;
      st.prog = 0;
      const k = m.tileKey(c, r);
      const own = S.owners[k] ?? null;

      if (own === st.seat) {
        // Friendly ground: walk on, or stand down if this was the destination.
        st.leg++;
        if (st.leg >= st.path.length) {
          S.garrisons[k] = (S.garrisons[k] || 0) + st.count;
          st.count = 0;
        }
        continue;
      }

      const g = S.garrisons[k] || 0;
      if (st.count > g) {
        S.owners[k] = st.seat;
        st.count -= g;
        S.garrisons[k] = 0;
        delete S.barracks[k];        // capture razes what stood here
        delete S.industry[k];

        // Taking a capital takes the whole territory with it: every province in
        // it changes hands, and everything built on them is razed.
        const p = m.territoryAt(M, c, r);
        if (p) {
          const [cc, cr] = m.centreTile(M, p);
          if (cc === c && cr === r) {
            for (const [tc, tr] of m.tilesOf(M, p)) {
              const tk = m.tileKey(tc, tr);
              if (tk === k) continue;
              if ((S.owners[tk] ?? null) === st.seat) continue;
              S.owners[tk] = st.seat;
              S.garrisons[tk] = 0;
              delete S.barracks[tk];
              delete S.industry[tk];
            }
          }
        }

        st.leg++;
        if (st.leg >= st.path.length) {
          S.garrisons[k] = st.count;
          st.count = 0;
        }
      } else {
        S.garrisons[k] = g - st.count;
        st.count = 0;                // the assault broke
      }
    }
    S.stacks = S.stacks.filter(st => st.count > 0);

    if (S.over === null) {
      const sc = m.score(M, S.owners);
      for (const seat of [0, 1]) {
        if ((sc.territories[seat] || 0) >= sc.needed) S.over = seat;
      }
    }
    return S;
  }

  // ── commands ──────────────────────────────────────────────────────────────
  /** Raise a barracks. Priced on how many you already hold. */
  function build(S, M, seat, c, r) {
    const m = F();
    const k = m.tileKey(c, r);
    if ((S.owners[k] ?? null) !== seat) return 'not yours';
    // Key tests, not truthiness: seat 0 is stored as the value 0.
    if (k in S.barracks) return 'already built';
    if (k in S.industry) return 'industry stands here';
    const cost = barrackCost(S, M, seat);
    if (S.money[seat] < cost) return 'not enough coin';
    S.money[seat] -= cost;
    S.barracks[k] = seat;
    return null;
  }

  /**
   * Develop a province into industry. Barred on capitals — those already pay
   * their city's wealth, so industry is what the interior provinces are FOR.
   */
  function industry(S, M, seat, c, r) {
    const m = F();
    const k = m.tileKey(c, r);
    if ((S.owners[k] ?? null) !== seat) return 'not yours';
    if (k in S.industry) return 'already built';
    if (k in S.barracks) return 'barracks stands here';
    const p = m.territoryAt(M, c, r);
    const [cc, cr] = p ? m.centreTile(M, p) : [-1, -1];
    if (cc === c && cr === r) return 'capitals already pay';
    const cost = RULES.industryCost * 1000;
    if (S.money[seat] < cost) return 'not enough coin';
    S.money[seat] -= cost;
    S.industry[k] = seat;
    return null;
  }

  /** Send a share of a province's garrison to any province on the board. */
  function march(S, M, seat, from, to, pct) {
    const m = F();
    const fk = m.tileKey(from[0], from[1]);
    if ((S.owners[fk] ?? null) !== seat) return 'not yours';
    const have = S.garrisons[fk] || 0;
    const send = Math.floor(have * pct / 100);
    if (send < 1) return 'no troops to send';
    const path = m.travelPath(M, from, to, RULES.hopTicks, RULES.offRoadTicks);
    if (!path) return 'no route';
    if (!path.length) return 'already there';
    S.garrisons[fk] = have - send;
    S.stacks.push({ id: S.nextId++, seat, count: send, path, leg: 0, prog: 0, from });
    return null;
  }

  /**
   * Call in every garrison within reach of a province and send them all to it.
   * Reach is the target's own territory plus the ones orthogonally touching it,
   * so a reinforce is a local rally, not a board-wide summons.
   *
   * Each source keeps one trooper so a province is never left completely open
   * by a rally — losing your rear to a single scout because you reinforced the
   * front is a bad way to lose.
   */
  function reinforce(S, M, seat, c, r) {
    const m = F();
    const target = m.territoryAt(M, c, r);
    if (!target) return 'off the board';
    const tk = m.tileKey(c, r);
    if ((S.owners[tk] ?? null) !== seat) return 'not yours';

    // The target territory and its orthogonal neighbours, by slot.
    const near = new Set([target.id]);
    for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const p = M.provinceAtSlot(target.sc + dc, target.sr + dr);
      if (p) near.add(p.id);
    }

    // Sorted keys: the order stacks are created must not depend on object
    // iteration order, or two clients could diverge.
    let sent = 0;
    for (const k of Object.keys(S.garrisons).sort()) {
      if (k === tk) continue;
      if ((S.owners[k] ?? null) !== seat) continue;
      const have = S.garrisons[k] || 0;
      if (have < 2) continue;
      const [sc2, sr2] = k.split(',').map(Number);
      const home = m.territoryAt(M, sc2, sr2);
      if (!home || !near.has(home.id)) continue;
      const path = m.travelPath(M, [sc2, sr2], [c, r], RULES.hopTicks, RULES.offRoadTicks);
      if (!path || !path.length) continue;
      const send = have - 1;
      S.garrisons[k] = 1;
      S.stacks.push({ id: S.nextId++, seat, count: send, path, leg: 0, prog: 0, from: [sc2, sr2] });
      sent += send;
    }
    return sent ? null : 'no troops in reach';
  }

  /** Where a stack is right now, in fractional province coords, for drawing. */
  function stackAt(S, st, M) {
    const prev = st.leg === 0 ? st.from : st.path[st.leg - 1];
    const next = st.path[st.leg];
    const t = st.prog / hopCost(M, next[0], next[1]);
    return [prev[0] + (next[0] - prev[0]) * t, prev[1] + (next[1] - prev[1]) * t];
  }

  /** FNV-1a over the integer state — the desync tripwire. */
  function hash(S) {
    let h = 0x811c9dc5;
    const mix = n => {
      h ^= n & 0xff; h = (h * 0x01000193) >>> 0;
      h ^= (n >>> 8) & 0xff; h = (h * 0x01000193) >>> 0;
      h ^= (n >>> 16) & 0xff; h = (h * 0x01000193) >>> 0;
    };
    mix(S.tick);
    // Mix the key's characters, not its length: "1,2" and "1,4" are different
    // provinces, and a length-only mix would call those states identical.
    const mixKey = k => { for (let i = 0; i < k.length; i++) mix(k.charCodeAt(i)); mix(0x1f); };
    for (const k of Object.keys(S.owners).sort()) { mixKey(k); mix(S.owners[k] + 1); }
    for (const k of Object.keys(S.garrisons).sort()) { mixKey(k); mix(S.garrisons[k]); }
    for (const k of Object.keys(S.barracks).sort()) { mixKey(k); mix(S.barracks[k] + 1); }
    for (const k of Object.keys(S.industry || {}).sort()) { mixKey(k); mix(S.industry[k] + 1); }
    // Stacks carry their route, so mix where they are as well as how many.
    for (const st of S.stacks) {
      mix(st.count); mix(st.leg); mix(st.prog); mix(st.seat + 1);
      const at = st.path[st.leg];
      if (at) { mix(at[0]); mix(at[1]); }
    }
    mix(S.money[0]); mix(S.money[1]);
    return ('0000000' + h.toString(16)).slice(-8);
  }

  return { RULES, hopCost, barrackCost, create, step, build, industry, march, reinforce, stackAt, hash };
});
