/* Four Provinces — map system (v2).
 *
 * Pure data + pure functions. No canvas, no DOM, no wall clock.
 * Loads as a classic script in the browser (window.FPMap) and as a CommonJS
 * module in a Worker / Durable Object / Node test, so the client, the server
 * sim and the determinism tests all read the same map from one place.
 *
 * Two coordinate spaces, deliberately separated:
 *   TILE space  — the truth. Distances, march times and adjacency live here.
 *   WORLD space — the 2:1 isometric projection. Rendering and hit-testing only.
 *
 * Never measure distance in world space: the iso projection squashes the
 * vertical axis 2:1, so a march that looks the same length on screen can take
 * twice as long depending on its direction. Tile space is isotropic.
 *
 * ── Board shape ──────────────────────────────────────────────────────────────
 * A board is a SLOT GRID: `slots` is cols × rows of province-sized cells, and
 * `block` is one province's tile footprint. A province declares which slot it
 * occupies; its absolute tile origin is derived (sc * block.w, sr * block.h),
 * so province blocks always abut exactly with no gap.
 *
 * Symmetry falls out of that: slot (sc, sr) pairs with (cols-1-sc, rows-1-sr)
 * and a city's local tile mirrors to (block.w-1-lc, block.h-1-lr). A FULL slot
 * grid is therefore 180°-rotationally symmetric by construction — 2×2 for four
 * provinces, 3×2 for six, 4×3 for twelve. Nothing here assumes four.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FPMap = api;
})(typeof self !== 'undefined' ? self : this, function () {

  // ── projection ────────────────────────────────────────────────────────────
  const ISO = { tw: 64, th: 32, thick: 13 };

  /** Tile coords (may be fractional) → world pixels. */
  const iso = (c, r) => ({ x: (c - r) * (ISO.tw / 2), y: (c + r) * (ISO.th / 2) });

  /** World bounds of a board's whole slot grid, including plateau thickness. */
  function worldBounds(map) {
    const gw = map && map.gridW ? map.gridW : 14;
    const gh = map && map.gridH ? map.gridH : 14;
    return {
      x0: -gh * (ISO.tw / 2), x1: gw * (ISO.tw / 2),
      y0: 0, y1: (gw + gh) * (ISO.th / 2) + ISO.thick,
    };
  }

  // ── camera ────────────────────────────────────────────────────────────────
  /* The board is a flat plane in 3D, and "2:1 isometric" is just one axonometric
   * camera onto it: yaw 45°, pitch asin(0.5). Generalising the projection is
   * what makes looking around possible at all — with yaw and pitch as free
   * parameters, tiles stay correct quads, verticals stay vertical, and the
   * default values reproduce the classic view exactly.
   *
   *   ex = ( c·cosY − r·sinY )
   *   ey = ( c·sinY + r·cosY )·sinP   −   height·(cosP / cosP₀)
   *
   * Unprojection is the inverse rotation, so hit-testing works at any angle.
   */
  const BASE_SCALE = ISO.tw / Math.SQRT2;      // px per tile unit at zoom 1
  const BASE_YAW = Math.PI / 4;
  const BASE_PITCH = Math.asin(0.5);           // the classic 2:1 squash
  const BASE_COSP = Math.cos(BASE_PITCH);

  function camera(o) {
    o = o || {};
    const yaw = o.yaw ?? BASE_YAW, pitch = o.pitch ?? BASE_PITCH;
    const S = o.scale ?? BASE_SCALE, ox = o.ox ?? 0, oy = o.oy ?? 0;
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const sinP = Math.sin(pitch), cosP = Math.cos(pitch);
    const vk = (S / BASE_SCALE) * (cosP / BASE_COSP);   // world px of height → screen px

    return {
      yaw, pitch, scale: S, ox, oy, sinP, cosP,
      /** Tile coords (+ optional height in world px) → screen px. */
      project: (c, r, h) => [
        ox + (c * cosY - r * sinY) * S,
        oy + (c * sinY + r * cosY) * S * sinP - (h || 0) * vk,
      ],
      /** Screen px → tile coords on the ground plane. */
      unproject: (sx, sy) => {
        const a = (sx - ox) / S, b = (sy - oy) / (S * sinP);
        return { c: a * cosY + b * sinY, r: -a * sinY + b * cosY };
      },
      /** Distance into the screen — sort ascending to paint back to front. */
      depth: (c, r) => c * sinY + r * cosY,
      /** Does a ground-plane normal (dc, dr) face the viewer? */
      faces: (dc, dr) => (dc * sinY + dr * cosY) > 0,
      /** Screen px for a vertical world-px extent. */
      vert: h => h * vk,
      /** Lambert-ish shade for a ground-plane face normal, light fixed in world space. */
      lit: (dc, dr) => {
        const len = Math.hypot(dc, dr) || 1;
        return Math.max(0, (dc * 0.32 + dr * 0.95) / len);
      },
    };
  }

  /** Projected extent of a board at scale 1, including plateau thickness. */
  function boardExtent(map, yaw, pitch) {
    const gw = (map && map.gridW) || 14, gh = (map && map.gridH) || 14;
    const cam = camera({ yaw, pitch, scale: 1 });
    const pts = [[0, 0], [gw, 0], [gw, gh], [0, gh]].map(([c, r]) => cam.project(c, r));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return {
      x0: Math.min(...xs), x1: Math.max(...xs),
      y0: Math.min(...ys), y1: Math.max(...ys) + cam.vert(ISO.thick) / 1,
    };
  }

  /**
   * Camera that frames a whole board in a W×H viewport, then applies the
   * viewer's zoom and pan. `fit` comes back on the camera so a caller can
   * express zoom limits relative to "whole board visible".
   */
  function fitCamera(map, W, H, o) {
    o = o || {};
    const yaw = o.yaw ?? BASE_YAW, pitch = o.pitch ?? BASE_PITCH;
    const pad = o.pad ?? 40, zoom = o.zoom ?? 1;
    const e = boardExtent(map, yaw, pitch);
    const fit = Math.min((W - pad * 2) / (e.x1 - e.x0 || 1), (H - pad * 2) / (e.y1 - e.y0 || 1));
    const S = fit * zoom;
    const cam = camera({
      yaw, pitch, scale: S,
      ox: W / 2 + (o.panX || 0) - ((e.x0 + e.x1) / 2) * S,
      oy: H / 2 + (o.panY || 0) - ((e.y0 + e.y1) / 2) * S,
    });
    cam.fit = fit;
    return cam;
  }

  /* The four bearings an orbit may rest on. A square tile projects to the same
   * diamond at 45° + k·90°; at 0°/90° the camera looks straight along the grid
   * axes and the same tile projects as a 2:1 rectangle instead. Restricting the
   * orbit to the diagonals is what keeps tile geometry identical all the way
   * round — it is a property of the projection, not something a scale can fix. */
  const ISO_BEARINGS = [0, 1, 2, 3].map(i => BASE_YAW + i * Math.PI / 2);

  /* Top-down has no such constraint: rotating a square grid in its own plane is
   * a pure rotation, so squares stay squares at any bearing. The orthogonal
   * detents are simply the ones that read as a map rather than a diamond. */
  const ORTHO_BEARINGS = [0, 1, 2, 3].map(i => i * Math.PI / 2);
  const TOP_DOWN = Math.PI / 2;

  /** Per-side viewport insets, so overlay chrome can be kept clear of the board. */
  function insetsOf(o) {
    const pad = o.pad ?? 40, i = o.insets || {};
    return { top: i.top ?? pad, right: i.right ?? pad, bottom: i.bottom ?? pad, left: i.left ?? pad };
  }

  /**
   * Scale that fits the board at EVERY listed bearing. A non-square board's
   * projected bounding box differs between bearings, so deriving scale from the
   * current one alone makes tiles change size as the camera comes round. Taking
   * the worst case gives one scale for the whole orbit.
   */
  function stableFit(map, W, H, o) {
    o = o || {};
    const pitch = o.pitch ?? BASE_PITCH;
    const ins = insetsOf(o);
    const availW = Math.max(1, W - ins.left - ins.right);
    const availH = Math.max(1, H - ins.top - ins.bottom);
    const bearings = o.bearings || ISO_BEARINGS;
    let fit = Infinity;
    for (const y of bearings) {
      const e = boardExtent(map, y, pitch);
      fit = Math.min(fit, availW / (e.x1 - e.x0 || 1), availH / (e.y1 - e.y0 || 1));
    }
    return fit;
  }

  /**
   * Camera for orbiting a board. One scale for all bearings, and centred on the
   * board's middle TILE — which is yaw-invariant, unlike the projected bounding
   * box, whose centre drifts as the board turns. Centring respects insets, so a
   * fitted board lands in the clear area rather than under the chrome.
   */
  function orbitCamera(map, W, H, o) {
    o = o || {};
    const yaw = o.yaw ?? BASE_YAW, pitch = o.pitch ?? BASE_PITCH, zoom = o.zoom ?? 1;
    const fit = stableFit(map, W, H, o);
    const S = fit * zoom;
    const ins = insetsOf(o);
    const cx = ins.left + (W - ins.left - ins.right) / 2;
    const cy = ins.top + (H - ins.top - ins.bottom) / 2;
    const mid = camera({ yaw, pitch, scale: S }).project((map.gridW || 14) / 2, (map.gridH || 14) / 2);
    const cam = camera({
      yaw, pitch, scale: S,
      ox: cx + (o.panX || 0) - mid[0],
      oy: cy + (o.panY || 0) - mid[1],
    });
    cam.fit = fit;
    return cam;
  }

  // ── tuning ────────────────────────────────────────────────────────────────
  const TUNING = {
    startMoney: 60,
    barrackBase: 40, barrackStep: 1.32,
    popBase: 0.18, popPerBarrack: 0.26,
    capBase: 40, capPerBarrack: 16,
    neutralRegen: 0.06, rousedRegen: 0.16, neutralMax: 1.45,
    marchTilesPerSec: 1.4,   // ≈3.0 s between a province's two cities, ≈10 s corner to corner
    raidEvery: 15, raidMin: 32, raidFraction: 0.45,
  };

  const DEFAULT_BLOCK = { w: 7, h: 7 };
  const DEFAULT_SLOTS = { cols: 2, rows: 2 };

  /* The structure kit — footprint (share of a tile's width) and height (world
   * units) per structure kind. The one shared source of truth for both
   * renderers: board-render.js's extruded-roof-and-walls paint and
   * board-render-3d.js's box meshes read these same numbers, so a kit change
   * can't drift between the 2D and 3D views the way two independent copies
   * eventually would. See docs/RENDERING.md.
   *
   * `model` (optional) points a kind at a real checked-in .glb instead of the
   * procedural box, 3D renderer only — see docs/RENDERING.md → Structures.
   * `file` is a path under public/models/; `scale` is the uniform multiplier
   * settled on in public/tile-placer.html (tile-relative — 1.0 ≈ fills a
   * tile), hand-tuned once and hardcoded here so it never needs recomputing;
   * `rotationY` (degrees, default 0) is optional. No `model` = today's box,
   * unchanged — this field is additive and every kind works with or without
   * one. */
  const STRUCTURE_KIT = {
    barracks: { fp: 0.54, h: 0.40, label: 'Barracks', authorable: true },
    industry: { fp: 0.74, h: 0.42, label: 'Industry', authorable: true },
    capital:  { fp: 0.66, h: 0.72, label: 'Capital', authorable: false },
    city:     { fp: 0.44, h: 0.26, label: 'City', authorable: false },
  };
  /* One structure wins per tile when more than one kind could occupy it in
   * the same paint/update pass — higher rank takes precedence. */
  const STRUCTURE_RANK = { capital: 3, industry: 2, barracks: 1, city: 0 };
  /* Kinds a board definition may place via `structures` (see build() below) —
   * `capital`/`city` come from the `cities` array instead. One source of
   * truth for the editor's placement tools, so a future kind (naval base,
   * missile silo, airbase, ...) needs only a STRUCTURE_KIT entry here, not a
   * new editor code path. */
  const AUTHORABLE_KINDS = Object.keys(STRUCTURE_KIT).filter(k => STRUCTURE_KIT[k].authorable);

  /** Names offered to newly created provinces and cities, in order. */
  const PROVINCE_NAMES = ['Verrand', 'Kolstig', 'Aumère', 'Dunmar', 'Ilmarsk', 'Craithe',
    'Vosgard', 'Pellamar', 'Torvhall', 'Espegny', 'Rundmark', 'Belloch'];
  const CITY_NAMES = ['Halbrook', 'Stenn', 'Ravensfeld', 'Ott', 'Lisiel', 'Fauconde',
    'Brackwater', 'Coilhaven', 'Deepmere', 'Karrow', 'Vantry', 'Solgeld', 'Ashen', 'Merrow',
    'Ferrand', 'Quillon', 'Thrave', 'Ombry', 'Nasker', 'Weltring', 'Caldis', 'Peny', 'Rookhold', 'Ysvane'];

  // ── boards ────────────────────────────────────────────────────────────────
  // `seat` = owner at match start (0 or 1). `garrison` = neutral starting
  // troops. A city has one or the other, never both.
  const MAPS = {
    /* The 1v1 board. Homes sit in diagonally opposite slots; the other two
     * provinces are the contested middle. Stats are 180°-rotationally
     * symmetric, so the two seats face identical boards — symmetry() checks it.
     *
     * The two neutral provinces are shaped differently on purpose: Aumère
     * offers seat 0 a cheap near city (Lisiel, 34) with the strong one deep
     * behind it, while Kolstig puts the strong city first (Ravensfeld, 60).
     * Same choice mirrored for seat 1. Fair, but not samey. */
    duel: {
      id: 'duel', name: 'Duel', seats: 2,
      note: 'Symmetric 1v1. Homes diagonally opposite, two neutral provinces contested.',
      slots: { cols: 2, rows: 2 }, block: { w: 7, h: 7 },
      starts: [{ seat: 0, territory: 'verrand' }, { seat: 1, territory: 'dunmar' }],
      // Province `name` is blank by default (2026-09-14) — same as a
      // sector the editor creates fresh — so a GM names their own world
      // instead of inheriting fantasy names, on every board this ships
      // with, not just new content. `id` is unrelated to `name` and stays
      // fixed (`starts`/city `prov` references, twin pairing) — only the
      // display name changed.
      provinces: [
        { id: 'verrand', name: '', sc: 0, sr: 0 },
        { id: 'kolstig', name: '', sc: 1, sr: 0 },
        { id: 'aumere', name: '', sc: 0, sr: 1 },
        { id: 'dunmar', name: '', sc: 1, sr: 1 },
      ],
      // capital: true picks the one city per province that pays income (see
      // map.js's capitalOf()) — assigned in mirrored pairs (Halbrook/
      // Coilhaven, Ravensfeld/Fauconde) so symmetry() sees a match on both
      // sides, same as wealth/garrison/seat already had to.
      cities: [
        { id: 'halbrook', name: 'Halbrook', prov: 'verrand', lc: 1, lr: 2, wealth: 3.0, seat: 0, capital: true },
        { id: 'stenn', name: 'Stenn', prov: 'verrand', lc: 4, lr: 5, wealth: 2.2, seat: 0 },
        { id: 'ravensfeld', name: 'Ravensfeld', prov: 'kolstig', lc: 2, lr: 1, wealth: 3.6, garrison: 60, capital: true },
        { id: 'ott', name: 'Ott', prov: 'kolstig', lc: 5, lr: 4, wealth: 2.4, garrison: 34 },
        { id: 'lisiel', name: 'Lisiel', prov: 'aumere', lc: 1, lr: 2, wealth: 2.4, garrison: 34 },
        { id: 'fauconde', name: 'Fauconde', prov: 'aumere', lc: 4, lr: 5, wealth: 3.6, garrison: 60, capital: true },
        { id: 'brackwater', name: 'Brackwater', prov: 'dunmar', lc: 2, lr: 1, wealth: 2.2, seat: 1 },
        { id: 'coilhaven', name: 'Coilhaven', prov: 'dunmar', lc: 5, lr: 4, wealth: 3.0, seat: 1, capital: true },
      ],
    },

    /* The original single-player board: one home, six neutrals of escalating
     * difficulty, Dunmar as the endgame. Kept because it is the balance tuning
     * reference and the AI's practice ground. Not symmetric, and symmetry()
     * correctly says so. */
    solo: {
      id: 'solo', name: 'Solo', seats: 1,
      note: 'Original campaign board. Asymmetric by design — Dunmar is the endgame.',
      slots: { cols: 2, rows: 2 }, block: { w: 7, h: 7 },
      starts: [{ seat: 0, territory: 'verrand' }],
      // See duel's own comment above — same reasoning, applied here too.
      provinces: [
        { id: 'verrand', name: '', sc: 0, sr: 0 },
        { id: 'kolstig', name: '', sc: 1, sr: 0 },
        { id: 'aumere', name: '', sc: 0, sr: 1 },
        { id: 'dunmar', name: '', sc: 1, sr: 1 },
      ],
      // No symmetry constraint here (solo isn't symmetric by design) — each
      // province's higher-wealth city is picked as its capital.
      cities: [
        { id: 'halbrook', name: 'Halbrook', prov: 'verrand', lc: 1, lr: 2, wealth: 3.0, seat: 0, capital: true },
        { id: 'stenn', name: 'Stenn', prov: 'verrand', lc: 4, lr: 5, wealth: 2.2, seat: 0 },
        { id: 'ott', name: 'Ott', prov: 'kolstig', lc: 5, lr: 4, wealth: 2.4, garrison: 34 },
        { id: 'ravensfeld', name: 'Ravensfeld', prov: 'kolstig', lc: 2, lr: 1, wealth: 3.6, garrison: 60, capital: true },
        { id: 'lisiel', name: 'Lisiel', prov: 'aumere', lc: 4, lr: 1, wealth: 2.8, garrison: 42 },
        { id: 'fauconde', name: 'Fauconde', prov: 'aumere', lc: 1, lr: 4, wealth: 3.2, garrison: 52, capital: true },
        { id: 'brackwater', name: 'Brackwater', prov: 'dunmar', lc: 2, lr: 2, wealth: 2.6, garrison: 55 },
        { id: 'coilhaven', name: 'Coilhaven', prov: 'dunmar', lc: 5, lr: 5, wealth: 4.0, garrison: 88, capital: true },
      ],
    },
  };

  /* The grand board from the design note: 5×5 territories, each 5×5 provinces,
   * so a province IS a tile and a territory IS a slot — 625 provinces in all.
   * Players start in opposite corners; 18 of 25 territories wins.
   *
     * Territories are unnamed by default (2026-09-14, same as duel/solo) —
     * a GM names their own world; see describeProvince()'s coordinate
     * fallback for anywhere a name is needed before that happens.
     *
     * Seat 0 starts at t44 and seat 1 at t00 — with the board presented as a
     * diamond (top-down at a 45° bearing) those are the bottom and top points,
     * so each player looks up the board at the other. */
  MAPS.grand = {
    id: 'grand', name: 'Grand', seats: 2,
    note: '25 territories × 25 provinces each. Start in opposite corners, hold 18 territories to win.',
    win: { territories: 18 },
    starts: [{ seat: 0, territory: 't44' }, { seat: 1, territory: 't00' }],
    slots: { cols: 5, rows: 5 }, block: { w: 5, h: 5 },
    // Blank by default, same as duel/solo (2026-09-14) — describeProvince()
    // (map.js) falls back to a coordinate label wherever one's needed
    // before a GM sets a real name.
    provinces: (() => {
      const out = [];
      for (let sr = 0; sr < 5; sr++) for (let sc = 0; sc < 5; sc++) {
        out.push({ id: `t${sc}${sr}`, name: '', sc, sr });
      }
      return out;
    })(),
    cities: (() => {
      // A city on every territory's centre province. Capturing that centre is
      // how a whole territory changes hands.
      const out = [];
      for (let sr = 0; sr < 5; sr++) for (let sc = 0; sc < 5; sc++) {
        const home = (sc === 4 && sr === 4) ? 'Halbrook' : (sc === 0 && sr === 0) ? 'Coilhaven' : null;
        const ring = Math.max(Math.abs(sc - 2), Math.abs(sr - 2));
        out.push({
          id: `c${sc}${sr}`,
          name: home || CITY_NAMES[(sr * 5 + sc) % CITY_NAMES.length],
          prov: `t${sc}${sr}`, lc: 2, lr: 2, capital: true,
          // Richer toward the middle: the centre of the board is worth fighting for.
          wealth: [3.6, 3.0, 2.4][ring] ?? 2.4,
        });
      }
      return out;
    })(),
  };

  // ── rules: adjacency, territories, scoring ─────────────────────────────────
  /* A province is one TILE and a territory is one BLOCK of them. Ownership is
   * held per province in a sparse map keyed "c,r" — sparse because 625 provinces
   * are mostly neutral ground, and because a sparse object is what you want to
   * ship over a wire and diff between ticks.
   *
   * Territory ownership is derived, never stored: a territory is yours when you
   * hold all of its provinces. Same rule as the four-province board, one level
   * up, so nothing here assumes 25 either. */
  const tileKey = (c, r) => c + ',' + r;

  /** Orthogonal neighbours in bounds. The front line is built out of these. */
  function neighbours(map, c, r) {
    const out = [];
    if (c > 0) out.push([c - 1, r]);
    if (r > 0) out.push([c, r - 1]);
    if (c < map.gridW - 1) out.push([c + 1, r]);
    if (r < map.gridH - 1) out.push([c, r + 1]);
    return out;
  }

  /** The territory a province sits in. */
  function territoryAt(map, c, r) {
    return map.provinceAtSlot(Math.floor(c / map.block.w), Math.floor(r / map.block.h));
  }

  /** Every province in a territory. */
  function tilesOf(map, p) {
    const out = [];
    for (let r = p.r0; r < p.r0 + p.h; r++) for (let c = p.c0; c < p.c0 + p.w; c++) out.push([c, r]);
    return out;
  }

  /** The centre province of a territory — the tile a military capture
   *  targets (territoryOwner() below reads ownership from here, and taking
   *  it flips the whole territory at once). Purely positional, and
   *  independent of which tile the territory's capital *city* actually
   *  stands on (see capitalOf()) — those used to be the same tile by
   *  convention; they no longer have to be. Even-sized blocks round down, so
   *  the choice is deterministic at any block size. */
  function centreTile(map, p) {
    return [p.c0 + ((p.w - 1) >> 1), p.r0 + ((p.h - 1) >> 1)];
  }

  /** A province's name, or — since every province defaults to unnamed now
   *  (2026-09-14: `duel`/`solo`/`grand`'s own fantasy names were dropped in
   *  favour of a blank slate the GM fills in, same as an editor-added
   *  sector already did) — its centre tile coordinate, in the same
   *  "(c, r)" format the tile inspector already uses for anything else
   *  unnamed. Used anywhere a province needs to be identified in a message
   *  a GM can actually act on: an internal `id` slug like "sector01" tells
   *  them nothing about where on the board it is; a coordinate does. */
  function describeProvince(map, p) {
    if (p.name) return p.name;
    const [c, r] = centreTile(map, p);
    return `Sector (${c}, ${r})`;
  }

  /** Same idea as describeProvince(), for a city. */
  function describeCity(c) {
    if (c.name) return c.name;
    return `City (${Math.floor(c.tc)}, ${Math.floor(c.tr)})`;
  }

  /** The territory's capital — the one city, anywhere in the territory, with
   *  `capital: true` — or null if none is marked yet. This is what pays
   *  income (sim.js's step()) and nothing else: a capital's board *position*
   *  is no longer relevant to anything (2026-09-14 — it used to have to sit
   *  on the territory's exact centre tile, capitalOf()'s old position-match
   *  implementation, which meant the very board this game ships with never
   *  actually had a real capital by that definition; see
   *  docs/KNOWN_ISSUES.md). A GM marks a city as the capital explicitly (the
   *  map editor's "Make capital" toggle) and can freely move it anywhere in
   *  its sector afterward without losing that status. */
  function capitalOf(map, p) {
    return map.cities.find(c => c.prov === p.id && c.capital) || null;
  }

  /** Every province that doesn't have exactly one capital, as ready-to-show
   *  messages (same shape as symmetry()'s issues list). Zero capitals means
   *  no income ever, silently; more than one is just ambiguous — capitalOf()
   *  would only ever see the first. worker.js's handlePutMap() refuses to
   *  save while this is non-empty; editor.html shows it live. */
  function capitalIssues(map) {
    const issues = [];
    for (const p of map.provinces) {
      const caps = map.cities.filter(c => c.prov === p.id && c.capital);
      const label = describeProvince(map, p);
      if (caps.length === 0) issues.push(`${label} has no capital — mark a city as its capital`);
      else if (caps.length > 1) issues.push(`${label} has ${caps.length} capitals — only one city per sector may be the capital`);
    }
    return issues;
  }

  /**
   * Who holds a territory. Ownership follows the CENTRE province alone: every
   * territory has a city on its centre, and taking that centre takes the whole
   * territory at once. So a territory is won in one decisive fight rather than
   * twenty-five small ones — which is also what makes 18 of 25 reachable inside
   * a session.
   */
  function territoryOwner(map, owners, p) {
    const [c, r] = centreTile(map, p);
    return owners[tileKey(c, r)] ?? null;
  }

  /** Territories and provinces held per seat, plus the target to win. */
  function score(map, owners) {
    const territories = {}, provinces = {};
    for (const p of map.provinces) {
      const o = territoryOwner(map, owners, p);
      if (o !== null) territories[o] = (territories[o] || 0) + 1;
    }
    for (const k in owners) {
      const o = owners[k];
      if (o !== null && o !== undefined) provinces[o] = (provinces[o] || 0) + 1;
    }
    return {
      territories, provinces,
      needed: (map.win && map.win.territories) || map.provinces.length,
    };
  }

  /** Provinces a seat may legally attack: not theirs, orthogonally adjacent to one that is. */
  function frontier(map, owners, seat) {
    const out = [], seen = new Set();
    for (const k in owners) {
      if (owners[k] !== seat) continue;
      const [c, r] = k.split(',').map(Number);
      for (const [nc, nr] of neighbours(map, c, r)) {
        const nk = tileKey(nc, nr);
        if (owners[nk] === seat || seen.has(nk)) continue;
        seen.add(nk);
        out.push([nc, nr]);
      }
    }
    return out;
  }

  /** Is this province on the road network? */
  function isRoad(map, c, r) {
    const p = territoryAt(map, c, r);
    if (!p) return false;
    return (c - p.c0) === ((p.w - 1) >> 1) || (r - p.r0) === ((p.h - 1) >> 1);
  }

  /* Roads are the centre cross of every territory. Because the crosses line up
   * across abutting blocks, they join into continuous highways running capital
   * to capital across the whole board — so the network needs no authoring, and
   * every capital sits on it by construction. */
  function roadTiles(map) {
    const out = [];
    for (const p of map.provinces) {
      for (const [c, r] of tilesOf(map, p)) if (isRoad(map, c, r)) out.push([c, r]);
    }
    return out;
  }

  /** Road-connected orthogonal neighbours. */
  function roadNeighbours(map, c, r) {
    return neighbours(map, c, r).filter(([nc, nr]) => isRoad(map, nc, nr));
  }

  /**
   * Shortest road route between two provinces, as the provinces entered (origin
   * excluded, destination included). Null when either end is off-road or
   * nothing connects them. Breadth-first over a fixed neighbour order, so the
   * route is identical on every machine.
   */
  function roadPath(map, from, to) {
    const [fc, fr] = from, [tc, tr] = to;
    if (!isRoad(map, fc, fr) || !isRoad(map, tc, tr)) return null;
    const start = tileKey(fc, fr), goal = tileKey(tc, tr);
    if (start === goal) return [];
    const prev = { [start]: null };
    let frontier = [[fc, fr]];
    while (frontier.length) {
      const next = [];
      for (const [c, r] of frontier) {
        for (const [nc, nr] of roadNeighbours(map, c, r)) {
          const k = tileKey(nc, nr);
          if (k in prev) continue;
          prev[k] = tileKey(c, r);
          if (k === goal) {
            const path = [];
            let at = goal;
            while (at !== start) { path.push(at.split(',').map(Number)); at = prev[at]; }
            return path.reverse();
          }
          next.push([nc, nr]);
        }
      }
      frontier = next;
    }
    return null;
  }

  /**
   * Cheapest route between any two provinces, as the provinces entered (origin
   * excluded, destination included). Troops may cross open ground anywhere;
   * roads are simply cheaper, so a route naturally runs along the highway and
   * only cuts across country for the last stretch.
   *
   * Dijkstra with ties broken by province key, so the route is identical on
   * every machine — a plain BFS would be non-deterministic once costs differ.
   */
  function travelPath(map, from, to, roadCost, offCost) {
    roadCost = roadCost || 1;
    offCost = offCost || 2;
    const [fc, fr] = from, [tc, tr] = to;
    if (!territoryAt(map, fc, fr) || !territoryAt(map, tc, tr)) return null;
    const start = tileKey(fc, fr), goal = tileKey(tc, tr);
    if (start === goal) return [];

    const dist = { [start]: 0 }, prev = { [start]: null };
    const open = new Set([start]);
    while (open.size) {
      let at = null, best = Infinity;
      for (const k of [...open].sort()) {           // sorted: deterministic ties
        if (dist[k] < best) { best = dist[k]; at = k; }
      }
      open.delete(at);
      if (at === goal) break;
      const [c, r] = at.split(',').map(Number);
      for (const [nc, nr] of neighbours(map, c, r)) {
        if (!territoryAt(map, nc, nr)) continue;
        const k = tileKey(nc, nr);
        const step = isRoad(map, nc, nr) ? roadCost : offCost;
        const alt = dist[at] + step;
        if (alt < (dist[k] ?? Infinity)) {
          dist[k] = alt; prev[k] = at; open.add(k);
        }
      }
    }
    if (!(goal in prev)) return null;
    const path = [];
    let at = goal;
    while (at !== start) { path.push(at.split(',').map(Number)); at = prev[at]; }
    return path.reverse();
  }

  /** The province diametrically opposite — the mirror used by every symmetry rule. */
  function mirrorTile(map, c, r) {
    return [map.gridW - 1 - c, map.gridH - 1 - r];
  }

  /** Expand a board's `starts` into an ownership map. */
  function seedOwners(map) {
    const owners = {};
    for (const s of map.starts || []) {
      const p = map.province(s.territory);
      if (!p) continue;
      for (const [c, r] of tilesOf(map, p)) owners[tileKey(c, r)] = s.seat;
    }
    return owners;
  }

  // ── slot arithmetic ───────────────────────────────────────────────────────
  const twinSlot = (slots, sc, sr) => ({ sc: slots.cols - 1 - sc, sr: slots.rows - 1 - sr });
  const mirrorLocal = (block, lc, lr) => ({ lc: block.w - 1 - lc, lr: block.h - 1 - lr });

  /** First unused name from a pool, else a numbered fallback. */
  function pickName(pool, taken, fallback) {
    const used = new Set(taken);
    for (const n of pool) if (!used.has(n)) return n;
    return `${fallback} ${taken.length + 1}`;
  }

  /** Slug an id off a name, keeping it unique within `taken`. */
  function pickId(name, taken) {
    const base = name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '') || 'x';
    if (!taken.includes(base)) return base;
    let n = 2;
    while (taken.includes(base + n)) n++;
    return base + n;
  }

  // ── build ─────────────────────────────────────────────────────────────────
  /**
   * Resolve a board definition into everything a renderer or sim needs: derived
   * tile origins, absolute tile centres, world positions, per-province city
   * lists, twin pairings, and the full city-to-city march matrix. Pure — same
   * input, same output, no mutation of the definition.
   */
  function build(which) {
    const def = typeof which === 'string' ? MAPS[which] : which;
    if (!def) throw new Error('unknown map: ' + which);
    const block = def.block || DEFAULT_BLOCK;
    const slots = def.slots || DEFAULT_SLOTS;
    const gridW = slots.cols * block.w, gridH = slots.rows * block.h;

    const provinces = (def.provinces || []).map((p, i) => ({
      ...p, index: i, w: block.w, h: block.h,
      c0: p.sc * block.w, r0: p.sr * block.h,
      cities: [], structures: [],
    }));
    const byId = Object.fromEntries(provinces.map(p => [p.id, p]));
    const bySlot = new Map(provinces.map(p => [p.sc + ',' + p.sr, p]));
    for (const p of provinces) {
      const t = twinSlot(slots, p.sc, p.sr);
      const tp = bySlot.get(t.sc + ',' + t.sr);
      p.twinSlot = t;
      p.twin = tp ? tp.id : null;
    }

    const cities = (def.cities || []).map((c, i) => {
      const p = byId[c.prov];
      if (!p) throw new Error('city ' + c.id + ' references unknown province ' + c.prov);
      const tc = p.c0 + c.lc + 0.5, tr = p.r0 + c.lr + 0.5;
      const w = iso(tc, tr);
      const seat = c.seat ?? null;
      const garrison = seat === null ? (c.garrison || 0) : 0;
      const city = {
        ...c, index: i, seat, provIndex: p.index,
        tc, tr, wx: w.x, wy: w.y,
        owner: seat, garrison,
        ceiling: seat === null ? Math.round(garrison * TUNING.neutralMax) : 0,
      };
      p.cities.push(city);
      return city;
    });

    // Twin city: mirrored local tile inside the twin province.
    for (const c of cities) {
      const p = byId[c.prov];
      const m = mirrorLocal(block, c.lc, c.lr);
      const t = cities.find(o => o.prov === p.twin && o.lc === m.lc && o.lr === m.lr);
      c.twin = t ? t.id : null;
    }

    // Pre-placed starting structures (industry/barracks) — see
    // docs/MAP_SYSTEM.md. Unlike a city, a structure's seat is authored
    // explicitly and must be one of the two seats; sim.create() additionally
    // requires it to match the tile's actual kickoff owner (map.starts), so
    // an authoring mistake never silently appears for even one frame.
    const structures = (def.structures || []).map((s, i) => {
      const p = byId[s.prov];
      if (!p) throw new Error('structure ' + s.id + ' references unknown province ' + s.prov);
      const kit = STRUCTURE_KIT[s.kind];
      if (!kit || !kit.authorable) throw new Error('invalid structure kind ' + s.kind);
      if (s.seat !== 0 && s.seat !== 1) throw new Error('structure ' + s.id + ' needs seat 0 or 1');
      const c = p.c0 + s.lc, r = p.r0 + s.lr;
      const structure = { ...s, index: i, provIndex: p.index, c, r };
      p.structures.push(structure);
      return structure;
    });

    // Twin structure: mirrored local tile inside the twin province, same kind.
    for (const s of structures) {
      const p = byId[s.prov];
      const m = mirrorLocal(block, s.lc, s.lr);
      const t = structures.find(o => o.prov === p.twin && o.kind === s.kind && o.lc === m.lc && o.lr === m.lr);
      s.twin = t ? t.id : null;
    }

    // March matrix, in tile space. Symmetric, so both halves are stored.
    const routes = cities.map(a => cities.map(b => {
      const d = Math.hypot(a.tc - b.tc, a.tr - b.tr);
      return { tiles: d, seconds: d / TUNING.marchTilesPerSec };
    }));

    return {
      ...def, iso: ISO, tuning: TUNING, block, slots, gridW, gridH,
      provinces, cities, structures, routes,
      province: id => byId[id],
      provinceAtSlot: (sc, sr) => bySlot.get(sc + ',' + sr) || null,
      city: id => cities.find(c => c.id === id),
      structure: id => structures.find(s => s.id === id),
      structureAt: (c, r) => structures.find(s => s.c === c && s.r === r) || null,
      route: (a, b) => routes[cities.findIndex(c => c.id === a)][cities.findIndex(c => c.id === b)],
    };
  }

  // ── symmetry check ────────────────────────────────────────────────────────
  /**
   * Verify a board is fair for a duel by checking it maps onto itself under a
   * 180° rotation with the seats swapped. Run this in CI — an asymmetric duel
   * map is a balance bug you cannot see by eye.
   */
  function symmetry(which) {
    const m = which && which.gridW ? which : build(which);
    const issues = [];

    for (const p of m.provinces) {
      if (!p.twin) issues.push(`${describeProvince(m, p)} has no province in the opposite slot`);
    }
    for (const a of m.cities) {
      const an = describeCity(a);
      const b = a.twin && m.city(a.twin);
      if (!b) { issues.push(`${an} has no counterpart across the board`); continue; }
      const bn = describeCity(b);
      if (a.wealth !== b.wealth) issues.push(`${an} pays ${a.wealth} but ${bn} pays ${b.wealth}`);
      if (a.garrison !== b.garrison) issues.push(`${an} holds ${a.garrison} but ${bn} holds ${b.garrison}`);
      const want = a.seat === null ? null : 1 - a.seat;
      if (b.seat !== want) issues.push(`${an} is ${a.seat === null ? 'neutral' : 'seat ' + a.seat} but ${bn} is ${b.seat === null ? 'neutral' : 'seat ' + b.seat}`);
      if (!!a.capital !== !!b.capital) issues.push(`${an} is${a.capital ? '' : ' not'} a capital but its twin ${bn} is${b.capital ? '' : ' not'}`);
    }
    for (const a of (m.structures || [])) {
      const b = a.twin && m.structure(a.twin);
      const label = (STRUCTURE_KIT[a.kind] && STRUCTURE_KIT[a.kind].label) || a.kind;
      if (!b) { issues.push(`${label} at ${a.prov} (${a.lc},${a.lr}) has no counterpart across the board`); continue; }
      if (b.seat !== 1 - a.seat) issues.push(`${label} at ${a.prov} is seat ${a.seat} but its twin is seat ${b.seat}`);
    }
    return { ok: issues.length === 0, pairs: Math.floor(m.cities.length / 2), issues };
  }

  /** Deterministic per-tile lightness jitter — no Math.random, identical everywhere. */
  function tileJitter(c, r, seed = 1) {
    let h = (c * 374761393 + r * 668265263 + seed * 2246822519) >>> 0;
    h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
    return ((h >>> 8) / 16777216 - 0.5) * 0.14;   // ±7%
  }

  return {
    ISO, iso, worldBounds, TUNING, MAPS, build, symmetry, tileJitter,
    camera, fitCamera, orbitCamera, stableFit, boardExtent, ISO_BEARINGS,
    ORTHO_BEARINGS, TOP_DOWN, BASE_SCALE, BASE_YAW, BASE_PITCH,
    tileKey, neighbours, territoryAt, tilesOf, territoryOwner, score, frontier,
    centreTile, capitalOf, capitalIssues, mirrorTile, seedOwners,
    isRoad, roadTiles, roadNeighbours, roadPath, travelPath,
    DEFAULT_BLOCK, DEFAULT_SLOTS, PROVINCE_NAMES, CITY_NAMES,
    STRUCTURE_KIT, STRUCTURE_RANK, AUTHORABLE_KINDS,
    twinSlot, mirrorLocal, pickName, pickId,
  };
});
