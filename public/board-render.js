/* Four Provinces — board renderer.
 *
 * Draws a built board (from map.js) through a camera onto a 2D context. Pure
 * paint: no state, no listeners, no reads of anything but its arguments — so
 * the game client and the creation table render from one code path and cannot
 * drift apart.
 *
 * Structures are real extruded volumes: a lit roof plus the two viewer-facing
 * wall quads, projected through the camera's height axis. Roof colour carries
 * ownership and walls stay neutral, so a dense board reads as a skyline rather
 * than as colour soup. Footprint and height are the only two dials — see KIT.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FPRender = api;
})(typeof self !== 'undefined' ? self : this, function () {

  /* Canvas can't resolve var(--sl-*), so every token board-render.js needs is
   * read from the DOM once and cached here, then reused on every paint.
   * Re-run readTokens() if the palette (data-faction) ever changes at
   * runtime — nothing does yet, so a lazy first-call read is enough for now.
   * Fallbacks mirror tokens.css's own defaults, for the rare non-browser
   * (test) context where there is no computed style to read. */
  let _tok = null;
  function tokens() {
    if (_tok) return _tok;
    const root = typeof document !== 'undefined' ? document.documentElement : null;
    const g = (n, fallback) => {
      const v = root ? getComputedStyle(root).getPropertyValue(n).trim() : '';
      return v || fallback;
    };
    const rgba = (hex, a) => {
      const n = parseInt(hex.replace('#', ''), 16);
      return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
    };
    const ink000 = g('--sl-ink-000', '#06080a');
    const seamBase = '239,230,213'; // legacy seam hue predates the token system's own seam RGB; alpha is what actually carries weight here
    _tok = {
      self: g('--sl-faction-self', '#3d8fd4'),
      foe: g('--sl-faction-foe', '#e0574a'),
      neutral: g('--sl-faction-neutral', '#7d8683'),
      signal: g('--sl-signal', '#d5d9d4'),
      signalWash: g('--sl-signal-wash', 'rgba(255,255,255,0.10)'),
      text: g('--sl-text', '#e6e8e4'),
      textInvert: g('--sl-text-invert', '#06080a'),
      land: g('--sl-ink-300', '#141a1f'),
      wallNear: g('--sl-ink-400', '#1b2328'),
      wallSide: g('--sl-ink-300', '#141a1f'),
      boardEdge: ink000,
      ink000Wash: a => rgba(ink000, a),
      seam: `rgba(${seamBase},0.09)`,
      seamDash: `rgba(${seamBase},0.14)`,
      seamWash: a => `rgba(${seamBase},${a})`,
    };
    return _tok;
  }
  const NEUTRAL = () => tokens().neutral;

  /* The structure kit. `fp` is the share of the tile the footprint covers (the
   * remainder is the margin that stops a built-up board looking welded
   * together); `h` is height in tile units. Nothing else distinguishes the
   * types, which is what lets new ones be added without new art.
   * Shared with board-render-3d.js via FPMap.STRUCTURE_KIT — one source of
   * truth for both renderers, see docs/RENDERING.md. */
  const KIT = (typeof self !== 'undefined' ? self : this).FPMap.STRUCTURE_KIT;

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(v =>
      Math.max(0, Math.min(255, Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1)))));
    return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  }

  const defaultSeatColour = seat => {
    const t = tokens();
    return seat === 0 ? t.self : seat === 1 ? t.foe : t.neutral;
  };

  /**
   * @param ctx   2D context, already cleared and DPR-transformed
   * @param cam   camera from FPMap.orbitCamera
   * @param M     built board from FPMap.build
   * @param o     { owners, seatColour, sel, frontier, labels, slots }
   *              owners    – sparse "c,r" → seat map
   *              garrisons – sparse "c,r" → troop count
   *              barracks  – sparse "c,r" → seat
   *              industry  – sparse "c,r" → seat
   *              stacks    – troops in transit, with stackAt(st) → [c,r]
   *              seatColour– seat → hex; defaults to the house palette
   *              sel       – {c,r} to highlight, or null
   *              frontier  – seat whose legal attacks to outline, or null
   *              labels    – draw territory names (default true)
   *              slots     – draw empty slots as "+" placeholders (default false)
   */
  function board(ctx, cam, M, o) {
    o = o || {};
    const F = (typeof self !== 'undefined' ? self : this).FPMap;
    const owners = o.owners || {};
    const seatColour = o.seatColour || defaultSeatColour;
    const labels = o.labels !== false;
    const S = cam.scale;
    const P = (c, r, h) => cam.project(c, r, h);

    const quad = (c, r) => {
      const a = P(c, r), b = P(c + 1, r), d = P(c + 1, r + 1), e = P(c, r + 1);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(d[0], d[1]); ctx.lineTo(e[0], e[1]);
      ctx.closePath();
    };
    /* One extruded box. Heights are tile units scaled by BASE_SCALE, since
     * cam.project takes height in world px. The board only ever sits at one
     * of the four ISO_BEARINGS (45° normally, +180° for a seat-1 viewer — see
     * game.html's viewYaw), and at any of those the two viewer-facing walls
     * are the r-normal and c-normal edges, just possibly the -r/-c one
     * instead of +r/+c — cam.faces() (already yaw-aware) picks the right one
     * instead of assuming +r/+c the way a fixed-bearing board could. */
    const HU = F.BASE_SCALE;
    const rNear = cam.faces(0, 1), cNear = cam.faces(1, 0);
    const prism = (c0, r0, w, d, hT, roof, near, side) => {
      const h = hT * HU;
      const c1 = c0 + w, r1 = r0 + d;
      const rE = rNear ? r1 : r0, cE = cNear ? c1 : c0;
      const face = (pts, fill) => {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.fillStyle = fill; ctx.fill();
      };
      face([P(c0, rE, h), P(c1, rE, h), P(c1, rE, 0), P(c0, rE, 0)], near);
      face([P(cE, r0, h), P(cE, r1, h), P(cE, r1, 0), P(cE, r0, 0)], side);
      face([P(c0, r0, h), P(c1, r0, h), P(c1, r1, h), P(c0, r1, h)], roof);
    };

    /* A structure centred on its tile, sized from the kit. */
    const piece = (c, r, kind, own) => {
      const k = KIT[kind] || KIT.city;
      const m = (1 - k.fp) / 2;
      const roof = own === null ? shade(NEUTRAL(), 1.3) : shade(seatColour(own), 1.5);
      prism(c + m, r + m, k.fp, k.fp, k.h, roof, tokens().wallNear, tokens().wallSide);
    };

    const block = (c0, r0, w, h) => {
      const a = P(c0, r0), b = P(c0 + w, r0), d = P(c0 + w, r0 + h), e = P(c0, r0 + h);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(d[0], d[1]); ctx.lineTo(e[0], e[1]);
      ctx.closePath();
    };

    // The board as a physical slab: the two viewer-facing perimeter faces,
    // dropped below the tile plane. Gives the board thickness and presence
    // instead of reading as a flat painted diamond. Same near-edge-per-axis
    // logic as prism() above, for the same reason.
    {
      const gw = M.gridW || 14, gh = M.gridH || 14;
      const t = -F.ISO.thick * 2.2;
      const rEdge = rNear ? gh : 0, cEdge = cNear ? gw : 0;
      const face = (pts, fill) => {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.fillStyle = fill; ctx.fill();
      };
      face([P(0, rEdge, 0), P(gw, rEdge, 0), P(gw, rEdge, t), P(0, rEdge, t)], tokens().boardEdge);
      face([P(cEdge, 0, 0), P(cEdge, gh, 0), P(cEdge, gh, t), P(cEdge, 0, t)], shade(tokens().boardEdge, 0.72));
    }

    // Provinces. Ownership carries the colour; the jitter is deterministic so
    // the texture never shimmers between frames. A territory whose capital has
    // fallen is held whole, so every province in it takes the holder's colour
    // at full strength — a claimed territory reads as one solid block of land,
    // while a contested one shows its provinces individually.
    for (const p of M.provinces) {
      const terr = F.territoryOwner(M, owners, p);
      for (let r = p.r0; r < p.r0 + p.h; r++) for (let c = p.c0; c < p.c0 + p.w; c++) {
        const own = terr !== null ? terr : (owners[F.tileKey(c, r)] ?? null);
        const base = own === null ? tokens().land
          : shade(seatColour(own), terr !== null ? 0.82 : 0.62);
        ctx.fillStyle = shade(base, 1 + F.tileJitter(c, r));
        quad(c, r); ctx.fill();
      }
    }

    // Roads: the centre cross of each territory, joined into highways. Drawn
    // over the land but under everything that stands on it.
    ctx.fillStyle = tokens().seam;
    for (const [c, r] of F.roadTiles(M)) { quad(c, r); ctx.fill(); }

    ctx.strokeStyle = tokens().ink000Wash(0.34); ctx.lineWidth = 1;
    for (const p of M.provinces) {
      for (let i = 0; i <= p.w; i++) {
        const a = P(p.c0 + i, p.r0), z = P(p.c0 + i, p.r0 + p.h);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(z[0], z[1]); ctx.stroke();
      }
      for (let i = 0; i <= p.h; i++) {
        const a = P(p.c0, p.r0 + i), z = P(p.c0 + p.w, p.r0 + i);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(z[0], z[1]); ctx.stroke();
      }
    }

    if (o.slots) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let sr = 0; sr < M.slots.rows; sr++) for (let sc = 0; sc < M.slots.cols; sc++) {
        if (M.provinceAtSlot(sc, sr)) continue;
        const c0 = sc * M.block.w, r0 = sr * M.block.h;
        block(c0, r0, M.block.w, M.block.h);
        ctx.fillStyle = tokens().seam; ctx.fill();
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = tokens().seamDash; ctx.lineWidth = 1.3; ctx.stroke();
        ctx.setLineDash([]);
        const mid = P(c0 + M.block.w / 2, r0 + M.block.h / 2);
        ctx.font = `400 ${Math.max(15, 1.4 * S)}px 'Barlow Semi Condensed', sans-serif`;
        ctx.fillStyle = tokens().seamWash(0.36);
        ctx.fillText('+', mid[0], mid[1]);
      }
    }

    // Exactly the provinces the reach rule allows that seat to attack.
    if (o.frontier !== null && o.frontier !== undefined) {
      ctx.fillStyle = tokens().signalWash;
      ctx.strokeStyle = tokens().signal;
      ctx.lineWidth = 1.6;
      for (const [c, r] of F.frontier(M, owners, o.frontier)) {
        if (!F.territoryAt(M, c, r)) continue;
        quad(c, r); ctx.fill(); ctx.stroke();
      }
    }

    // Structures, as one depth-sorted pass. Farther tiles paint first so
    // nearer volumes overlap them correctly — separate per-type loops would
    // let a distant capital draw over a near barracks. One piece per tile,
    // strongest claim winning, so volumes never intersect. cam.depth() rather
    // than a raw c+r sum, so this stays correct at either viewer bearing —
    // c+r only increases screenward at yaw 45°, and flips at yaw 225°.
    {
      const pieces = new Map();
      const put = (c, r, kind, own) => {
        const rank = { capital: 3, industry: 2, barracks: 1, city: 0 };
        const k = F.tileKey(c, r);
        const cur = pieces.get(k);
        if (cur && rank[cur.kind] >= rank[kind]) return;
        pieces.set(k, { c, r, kind, own });
      };

      for (const p of M.provinces) {
        const cap = F.capitalOf(M, p);
        for (const city of M.cities) {
          if (city.prov !== p.id) continue;
          const c = p.c0 + city.lc, r = p.r0 + city.lr;
          const own = owners[F.tileKey(c, r)] ?? null;
          put(c, r, cap && cap.id === city.id ? 'capital' : 'city', own);
        }
      }
      const barracks = o.barracks || {};
      for (const k of Object.keys(barracks)) {
        const [c, r] = k.split(',').map(Number);
        if (!F.territoryAt(M, c, r)) continue;
        put(c, r, 'barracks', barracks[k]);
      }
      const industry = o.industry || {};
      for (const k of Object.keys(industry)) {
        const [c, r] = k.split(',').map(Number);
        if (!F.territoryAt(M, c, r)) continue;
        put(c, r, 'industry', industry[k]);
      }

      const order = [...pieces.values()].sort((a, b) => cam.depth(a.c, a.r) - cam.depth(b.c, b.r));
      for (const pc of order) piece(pc.c, pc.r, pc.kind, pc.own);
    }

    // Garrison strength, where there is any and the board is close enough.
    // The gate is tied to the fit scale: a 25×25 board fitted at zoom 1 gives
    // S ≈ 19, so anything above that hides troop counts on join. The font is
    // already pinned to its 9px floor at this scale, so drawing here costs no
    // legibility — raise this only if the default zoom rises with it.
    const garrisons = o.garrisons || {};
    if (S > 18) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const fs = Math.max(9, Math.min(15, 0.2 * S));
      ctx.font = `500 ${fs}px 'JetBrains Mono', monospace`;
      for (const k of Object.keys(garrisons)) {
        const n = garrisons[k];
        if (!n) continue;
        const [c, r] = k.split(',').map(Number);
        if (!F.territoryAt(M, c, r)) continue;
        const mid = P(c + 0.5, r + 0.5);
        const y = mid[1] + 0.34 * S;
        const w = ctx.measureText(String(n)).width + fs * 0.8;
        ctx.fillStyle = tokens().ink000Wash(0.78);
        ctx.beginPath();
        ctx.rect(mid[0] - w / 2, y - fs * 0.7, w, fs * 1.4);
        ctx.fill();
        ctx.fillStyle = tokens().text;
        ctx.fillText(String(n), mid[0], y);
      }
    }

    // Troops in transit.
    for (const st of (o.stacks || [])) {
      const at = o.stackAt ? o.stackAt(st) : null;
      if (!at) continue;
      const mid = P(at[0] + 0.5, at[1] + 0.5);
      const rad = Math.max(3.5, 0.19 * S);
      ctx.fillStyle = tokens().ink000Wash(0.6);
      ctx.beginPath(); ctx.arc(mid[0], mid[1], rad * 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade(seatColour(st.seat), 1.55);
      ctx.beginPath(); ctx.arc(mid[0], mid[1], rad, 0, Math.PI * 2); ctx.fill();
      if (S > 18) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const fs = Math.max(9, Math.min(14, 0.18 * S));
        ctx.font = `500 ${fs}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = tokens().textInvert;
        ctx.fillText(String(st.count), mid[0], mid[1] + 0.5);
      }
    }

    // Territory borders, weighted by whether the whole thing is held.
    for (const p of M.provinces) {
      const own = F.territoryOwner(M, owners, p);
      block(p.c0, p.r0, p.w, p.h);
      if (own !== null) { ctx.strokeStyle = shade(seatColour(own), 1.5); ctx.lineWidth = 3; }
      else { ctx.strokeStyle = tokens().ink000Wash(0.8); ctx.lineWidth = 2; }
      ctx.stroke();
    }

    if (o.sel && F.territoryAt(M, o.sel.c, o.sel.r)) {
      quad(o.sel.c, o.sel.r);
      ctx.fillStyle = tokens().signalWash; ctx.fill();
      ctx.strokeStyle = tokens().signal; ctx.lineWidth = 2.2; ctx.stroke();
    }

    // Labels last, and only when a territory is big enough on screen to hold
    // its name — at 25 territories zoomed out they would just be noise. Placed
    // off block centre, since the centre province is a natural place to build.
    const labelPx = Math.min(M.block.w, M.block.h) * S;
    if (labels && labelPx > 46) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const fs = Math.max(10, Math.min(20, 0.2 * labelPx));
      ctx.font = `700 ${fs}px 'Barlow Condensed', sans-serif`;
      for (const p of M.provinces) {
        const own = F.territoryOwner(M, owners, p);
        const name = p.name.toUpperCase();
        const mid = P(p.c0 + p.w / 2, p.r0 + 0.5);
        const w = ctx.measureText(name).width + fs * 0.9, h = fs * 1.5;
        ctx.fillStyle = tokens().ink000Wash(0.5);
        ctx.beginPath();
        ctx.rect(mid[0] - w / 2, mid[1] - h / 2, w, h);
        ctx.fill();
        ctx.fillStyle = own === null ? tokens().text : shade(seatColour(own), 1.7);
        ctx.fillText(name, mid[0], mid[1]);
      }
    }
  }

  return { board, shade, defaultSeatColour, KIT, NEUTRAL };
});
