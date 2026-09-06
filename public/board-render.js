/* Four Provinces — board renderer.
 *
 * Draws a built board (from map.js) through a camera onto a 2D context. Pure
 * paint: no state, no listeners, no reads of anything but its arguments — so
 * the game client and the creation table render from one code path and cannot
 * drift apart.
 *
 * Top-down (pitch 90°) has no elevation, so there are no plateau skirts, cast
 * shadows or extruded buildings here. Ownership, seams and structures carry the
 * whole read.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FPRender = api;
})(typeof self !== 'undefined' ? self : this, function () {

  const LAND = '#6d675a';
  const NEUTRAL = '#8b8272';

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(v =>
      Math.max(0, Math.min(255, Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1)))));
    return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  }

  const defaultSeatColour = seat =>
    seat === 0 ? '#48a37c' : seat === 1 ? '#c0483c' : NEUTRAL;

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
    const P = (c, r) => cam.project(c, r);

    const quad = (c, r) => {
      const a = P(c, r), b = P(c + 1, r), d = P(c + 1, r + 1), e = P(c, r + 1);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(d[0], d[1]); ctx.lineTo(e[0], e[1]);
      ctx.closePath();
    };
    const block = (c0, r0, w, h) => {
      const a = P(c0, r0), b = P(c0 + w, r0), d = P(c0 + w, r0 + h), e = P(c0, r0 + h);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(d[0], d[1]); ctx.lineTo(e[0], e[1]);
      ctx.closePath();
    };

    // Provinces. Ownership carries the colour; the jitter is deterministic so
    // the texture never shimmers between frames. A territory whose capital has
    // fallen is held whole, so every province in it takes the holder's colour
    // at full strength — a claimed territory reads as one solid block of land,
    // while a contested one shows its provinces individually.
    for (const p of M.provinces) {
      const terr = F.territoryOwner(M, owners, p);
      for (let r = p.r0; r < p.r0 + p.h; r++) for (let c = p.c0; c < p.c0 + p.w; c++) {
        const own = terr !== null ? terr : (owners[F.tileKey(c, r)] ?? null);
        const base = own === null ? LAND
          : shade(seatColour(own), terr !== null ? 0.82 : 0.62);
        ctx.fillStyle = shade(base, 1 + F.tileJitter(c, r));
        quad(c, r); ctx.fill();
      }
    }

    // Roads: the centre cross of each territory, joined into highways. Drawn
    // over the land but under everything that stands on it.
    ctx.fillStyle = 'rgba(239,230,213,0.07)';
    for (const [c, r] of F.roadTiles(M)) { quad(c, r); ctx.fill(); }

    ctx.strokeStyle = 'rgba(11,18,25,0.34)'; ctx.lineWidth = 1;
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
        ctx.fillStyle = 'rgba(239,230,213,0.03)'; ctx.fill();
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = 'rgba(239,230,213,0.28)'; ctx.lineWidth = 1.3; ctx.stroke();
        ctx.setLineDash([]);
        const mid = P(c0 + M.block.w / 2, r0 + M.block.h / 2);
        ctx.font = `400 ${Math.max(15, 1.4 * S)}px 'Barlow Semi Condensed', sans-serif`;
        ctx.fillStyle = 'rgba(239,230,213,0.36)';
        ctx.fillText('+', mid[0], mid[1]);
      }
    }

    // Exactly the provinces the reach rule allows that seat to attack.
    if (o.frontier !== null && o.frontier !== undefined) {
      ctx.fillStyle = 'rgba(217,164,65,0.16)';
      ctx.strokeStyle = 'rgba(217,164,65,0.85)';
      ctx.lineWidth = 1.6;
      for (const [c, r] of F.frontier(M, owners, o.frontier)) {
        if (!F.territoryAt(M, c, r)) continue;
        quad(c, r); ctx.fill(); ctx.stroke();
      }
    }

    // Structures. A capital sits on its territory's centre province and is the
    // object that decides the territory, so it reads heavier than a plain city.
    for (const p of M.provinces) {
      const cap = F.capitalOf(M, p);
      for (const city of M.cities) {
        if (city.prov !== p.id) continue;
        const c = p.c0 + city.lc, r = p.r0 + city.lr;
        const own = owners[F.tileKey(c, r)] ?? null;
        const mid = P(c + 0.5, r + 0.5);
        const isCap = cap && cap.id === city.id;
        const rad = Math.max(3, (isCap ? 0.34 : 0.26) * S);
        ctx.fillStyle = 'rgba(11,18,25,0.55)';
        ctx.beginPath(); ctx.arc(mid[0], mid[1], rad * 1.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = shade(seatColour(own), 1.35);
        ctx.beginPath(); ctx.arc(mid[0], mid[1], rad, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(11,18,25,0.8)'; ctx.lineWidth = 1.2; ctx.stroke();
        if (isCap && rad > 5) {
          ctx.strokeStyle = shade(seatColour(own), 1.7);
          ctx.lineWidth = Math.max(1.2, rad * 0.22);
          ctx.beginPath(); ctx.arc(mid[0], mid[1], rad * 1.75, 0, Math.PI * 2); ctx.stroke();
        }
      }
    }

    // Barracks: a square plate, so it never reads as a capital's disc.
    const barracks = o.barracks || {};
    for (const k of Object.keys(barracks)) {
      const [c, r] = k.split(',').map(Number);
      if (!F.territoryAt(M, c, r)) continue;
      const mid = P(c + 0.5, r + 0.5);
      const s = Math.max(3, 0.2 * S);
      ctx.fillStyle = 'rgba(11,18,25,0.6)';
      ctx.fillRect(mid[0] - s - 1, mid[1] - s - 1, (s + 1) * 2, (s + 1) * 2);
      ctx.fillStyle = shade(seatColour(barracks[k]), 1.2);
      ctx.fillRect(mid[0] - s, mid[1] - s, s * 2, s * 2);
    }

    // Industry: a diamond plate, so barracks / industry / capital never read
    // as the same object at a glance.
    const industry = o.industry || {};
    for (const k of Object.keys(industry)) {
      const [c, r] = k.split(',').map(Number);
      if (!F.territoryAt(M, c, r)) continue;
      const mid = P(c + 0.5, r + 0.5);
      const s = Math.max(4, 0.24 * S);
      const dia = (rad, fill) => {
        ctx.beginPath();
        ctx.moveTo(mid[0], mid[1] - rad); ctx.lineTo(mid[0] + rad, mid[1]);
        ctx.lineTo(mid[0], mid[1] + rad); ctx.lineTo(mid[0] - rad, mid[1]);
        ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
      };
      dia(s + 1.5, 'rgba(11,18,25,0.6)');
      dia(s, shade(seatColour(industry[k]), 1.1));
      ctx.strokeStyle = '#d9a441';
      ctx.lineWidth = Math.max(1, s * 0.16);
      ctx.stroke();
    }

    // Garrison strength, where there is any and the board is close enough.
    const garrisons = o.garrisons || {};
    if (S > 26) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const fs = Math.max(9, Math.min(15, 0.2 * S));
      ctx.font = `600 ${fs}px 'Barlow Semi Condensed', sans-serif`;
      for (const k of Object.keys(garrisons)) {
        const n = garrisons[k];
        if (!n) continue;
        const [c, r] = k.split(',').map(Number);
        if (!F.territoryAt(M, c, r)) continue;
        const mid = P(c + 0.5, r + 0.5);
        const y = mid[1] + 0.34 * S;
        const w = ctx.measureText(String(n)).width + fs * 0.8;
        ctx.fillStyle = 'rgba(11,18,25,0.78)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(mid[0] - w / 2, y - fs * 0.7, w, fs * 1.4, 2);
        else ctx.rect(mid[0] - w / 2, y - fs * 0.7, w, fs * 1.4);
        ctx.fill();
        ctx.fillStyle = '#efe6d5';
        ctx.fillText(String(n), mid[0], y);
      }
    }

    // Troops in transit.
    for (const st of (o.stacks || [])) {
      const at = o.stackAt ? o.stackAt(st) : null;
      if (!at) continue;
      const mid = P(at[0] + 0.5, at[1] + 0.5);
      const rad = Math.max(3.5, 0.19 * S);
      ctx.fillStyle = 'rgba(11,18,25,0.6)';
      ctx.beginPath(); ctx.arc(mid[0], mid[1], rad * 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade(seatColour(st.seat), 1.55);
      ctx.beginPath(); ctx.arc(mid[0], mid[1], rad, 0, Math.PI * 2); ctx.fill();
      if (S > 26) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const fs = Math.max(9, Math.min(14, 0.18 * S));
        ctx.font = `600 ${fs}px 'Barlow Semi Condensed', sans-serif`;
        ctx.fillStyle = '#0b1219';
        ctx.fillText(String(st.count), mid[0], mid[1] + 0.5);
      }
    }

    // Territory borders, weighted by whether the whole thing is held.
    for (const p of M.provinces) {
      const own = F.territoryOwner(M, owners, p);
      block(p.c0, p.r0, p.w, p.h);
      if (own !== null) { ctx.strokeStyle = shade(seatColour(own), 1.5); ctx.lineWidth = 3; }
      else { ctx.strokeStyle = 'rgba(11,18,25,0.8)'; ctx.lineWidth = 2; }
      ctx.stroke();
    }

    if (o.sel && F.territoryAt(M, o.sel.c, o.sel.r)) {
      quad(o.sel.c, o.sel.r);
      ctx.fillStyle = 'rgba(217,164,65,0.24)'; ctx.fill();
      ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 2.2; ctx.stroke();
    }

    // Labels last, and only when a territory is big enough on screen to hold
    // its name — at 25 territories zoomed out they would just be noise. Placed
    // off block centre, since the centre province is a natural place to build.
    const labelPx = Math.min(M.block.w, M.block.h) * S;
    if (labels && labelPx > 46) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const fs = Math.max(10, Math.min(20, 0.2 * labelPx));
      ctx.font = `600 ${fs}px Bitter, serif`;
      for (const p of M.provinces) {
        const own = F.territoryOwner(M, owners, p);
        const mid = P(p.c0 + p.w / 2, p.r0 + 0.5);
        const w = ctx.measureText(p.name).width + fs * 0.9, h = fs * 1.5;
        ctx.fillStyle = 'rgba(11,18,25,0.5)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(mid[0] - w / 2, mid[1] - h / 2, w, h, 3);
        else ctx.rect(mid[0] - w / 2, mid[1] - h / 2, w, h);
        ctx.fill();
        ctx.fillStyle = own === null ? 'rgba(239,230,213,0.6)' : shade(seatColour(own), 1.7);
        ctx.fillText(p.name, mid[0], mid[1]);
      }
    }
  }

  return { board, shade, defaultSeatColour, LAND, NEUTRAL };
});
