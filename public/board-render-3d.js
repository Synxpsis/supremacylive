/* Four Provinces — 3D board renderer (Phase 2a of the free-camera engine).
 *
 * The Three.js counterpart to board-render.js, covering the same overlay
 * shape (owners/garrisons/barracks/industry/stacks/sel/armed/multi) — but as
 * a persistent scene + update(), not a stateless per-frame paint. Rebuilding
 * a whole WebGL scene every frame isn't the same kind of cheap as redrawing
 * a 2D canvas, so create() builds the static-per-match parts once and
 * update() diffs the rest in place.
 *
 * World axes: x = tile column, z = tile row, y = up. Tile (c, r)'s centre
 * sits at world (c + 0.5, 0, r + 0.5) — the same tile space map.js already
 * uses, just mapped straight into 3D instead of pre-flattened into an
 * isometric pixel offset.
 *
 * This module owns scene construction, per-frame update, and hit-testing —
 * NOT the render loop or animation timing. The caller drives that (see
 * proto3d.html): call controls.update(), renderer.render(), cssRenderer's
 * render() every frame, and call update(state) whenever the game state the
 * board should reflect has changed.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Shared with board-render.js via FPMap.STRUCTURE_KIT/STRUCTURE_RANK — one
// source of truth for both renderers, see docs/RENDERING.md. Module-load
// order is safe here: <script type="module"> always defers relative to the
// classic <script src="./map.js"> tag that sets this, regardless of position
// in the document.
const KIT = self.FPMap.STRUCTURE_KIT;
const PIECE_RANK = self.FPMap.STRUCTURE_RANK;

// ── real .glb models, opt-in per structure kind (see STRUCTURE_KIT's `model`
// field in map.js) ───────────────────────────────────────────────────────
//
// Loaded once per module (not per create() call) into modelTemplates, keyed
// by kind — every match/editor scene sharing this module reuses the same
// parsed template rather than re-fetching. A kind with no `model` entry, or
// whose load hasn't resolved yet (or failed), simply has no template here;
// upsertPiece() below falls back to the procedural box in that case, so
// there is no load-order race with gameplay and no regression for any kind
// that doesn't have a model yet.
const gltfLoader = new GLTFLoader();
const modelTemplates = new Map(); // kind -> normalized THREE.Group

// Centers the loaded scene on X/Z and drops it so its lowest point sits at
// Y=0 — this module's own "y=0 is the land surface" convention (see file
// header) — matching every other overlay here (pieces, rings, labels), all
// of which position relative to that plane. Same normalization the
// tile-placer tool's glb.js applies, so a scale tuned there transfers
// directly to STRUCTURE_KIT's `model.scale` with no re-derivation.
function normalizeModel(rawScene) {
  const box = new THREE.Box3().setFromObject(rawScene);
  const center = new THREE.Vector3();
  box.getCenter(center);
  rawScene.position.x -= center.x;
  rawScene.position.z -= center.z;
  rawScene.position.y -= box.min.y;
  const wrapper = new THREE.Group();
  wrapper.add(rawScene);
  return wrapper;
}

for (const [kind, k] of Object.entries(KIT)) {
  if (!k.model) continue;
  gltfLoader.load(
    k.model.file,
    (gltf) => modelTemplates.set(kind, normalizeModel(gltf.scene)),
    undefined,
    (err) => console.error(`board-render-3d: failed to load model for "${kind}" (${k.model.file})`, err)
  );
}

// Same algorithm as board-render.js's own shade() (string-hex there, numeric
// here — this module caches tokens as ints, see tokens() below), so a piece
// gets the identical brightening treatment in either renderer: f<1 darkens
// toward black, f>1 lightens toward white. Used to keep a structure's own
// colour visibly distinct from the ground it stands on (see upsertPiece()) —
// without it, a piece rendered at the raw, unbrightened faction colour reads
// as barely-there against ground already filled with a dimmed version of
// that same colour, especially the more a view angle favours the piece's
// flat (similarly-lit) top face over its shaded side walls.
function shade(hex, f) {
  const c = [hex >> 16 & 255, hex >> 8 & 255, hex & 255].map(v =>
    Math.max(0, Math.min(255, Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1)))));
  return c[0] << 16 | c[1] << 8 | c[2];
}

/* Three.js materials take numeric hex, not CSS colour strings, so the faction
 * tokens are read from the DOM once (as "#rrggbb") and parsed to numbers here,
 * then cached — the same reasoning as board-render.js's tokens(). Re-run this
 * if the palette (data-faction) ever changes at runtime; nothing does yet. */
let _tok = null;
function tokens() {
  if (_tok) return _tok;
  const toHex = (v, fallback) => {
    const m = /^#([0-9a-f]{6})$/i.exec((v || '').trim());
    return m ? parseInt(m[1], 16) : fallback;
  };
  // --sl-seam-* tokens are rgba() strings (see tokens.css), not #rrggbb —
  // Three.js materials only take a bare colour, so this pulls the RGB triple
  // out and leaves alpha to the material's own `opacity`, tuned per use below.
  const toHexRgba = (v, fallback) => {
    const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec((v || '').trim());
    return m ? (parseInt(m[1], 10) << 16 | parseInt(m[2], 10) << 8 | parseInt(m[3], 10)) : fallback;
  };
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  const g = n => root ? getComputedStyle(root).getPropertyValue(n) : '';
  _tok = {
    self: toHex(g('--sl-faction-self'), 0x3d8fd4),
    foe: toHex(g('--sl-faction-foe'), 0xe0574a),
    neutral: toHex(g('--sl-faction-neutral'), 0x7d8683),
    signal: toHex(g('--sl-signal'), 0xd5d9d4),
    land: toHex(g('--sl-ink-300'), 0x141a1f),
    ink000: toHex(g('--sl-ink-000'), 0x06080a),
    ink100: toHex(g('--sl-ink-100'), 0x0a0d10),
    // The board's own perimeter/piece outlines stay ink000 (a shadow line,
    // meant to recede) — grid lines use the lighter seam tone instead (see
    // their own comment below): a boundary hairline drawn in the exact
    // colour of the void it sits against is invisible by construction,
    // which is what made unclaimed ground unreadable as "there" rather than
    // empty (2026-09-15).
    seam: toHexRgba(g('--sl-seam-strong'), 0xe6e8e4),
    // Water is the one deliberate exception to the board's achromatic
    // palette — it borrows the existing --sl-info token (status blue)
    // rather than inventing a new hue, so there's no new gap to flag.
    water: toHex(g('--sl-info'), 0x4aa8c8),
  };
  return _tok;
}

function seatColorHex(seat) {
  const t = tokens();
  return seat === 0 ? t.self : seat === 1 ? t.foe : t.neutral;
}

function labelDiv(text, cls) {
  const el = document.createElement('div');
  el.className = 'fp3d-label' + (cls ? ' ' + cls : '');
  el.textContent = text;
  return el;
}

/** @param canvas the WebGL canvas element (sized by the caller)
 *  @param M      built board from FPMap.build — same input board-render.js takes
 *  @param opts.selectionLock  Recentre the orbit target on whatever's selected
 *    and freeze rotate/pan until it clears (default true — game.html relies on
 *    this so a player can't spin away from a tile they just committed to
 *    mid-order). editor.html passes false: it treats a click as "inspect this
 *    tile," not "commit to it," and every click there selects *something*
 *    (even open water), so this lock would otherwise fire almost constantly
 *    and fight free camera navigation while authoring a board.
 *  @param opts.gridLabels  Draw static column-letter / row-number axis labels
 *    along the board's two edges (default false — a match has no use for
 *    them; editor.html passes true so a GM can reference a tile by grid
 *    coordinate, e.g. "the tile at C, 4"). Built once here, not in update():
 *    like the province grid lines/borders just above, the coordinate grid
 *    itself never changes without a full scene rebuild (reset3D()).
 *  @param opts.labelOrigin  { c, r } tile-space offset subtracted from a
 *    label's own position before it's drawn (default { c: 0, r: 0 }, i.e. no
 *    offset — labels count up from the board's actual edge, same as before
 *    this option existed). editor.html tracks this across a low-edge grow
 *    (growing "north"/"west" shifts every existing tile's internal position
 *    over to make room — see its addTerritory()) so an already-labelled
 *    tile keeps the same displayed row/column instead of relabelling every
 *    time the board grows that direction; the newly-grown tiles pick up
 *    negative-going labels instead. Ignored unless gridLabels is also true.
 *  @param opts.camera  { position, target } to seed the camera/orbit-target
 *    with instead of the default overview angle — editor.html reads its old
 *    camera/controls back out before disposing a scene (see reset3D()) and
 *    passes them straight back in here, so a content edit that forces a
 *    full rebuild (add/remove sector, resize) doesn't snap the view back to
 *    the default framing out from under whoever's orbiting the board. */
export function create(canvas, M, opts = {}) {
  const selectionLock = opts.selectionLock !== false;
  const gridLabels = !!opts.gridLabels;
  const labelOriginC = (opts.labelOrigin && opts.labelOrigin.c) || 0;
  const labelOriginR = (opts.labelOrigin && opts.labelOrigin.r) || 0;
  const F = self.FPMap;
  const gridW = M.gridW, gridH = M.gridH;
  const boardCenter = new THREE.Vector3(gridW / 2, 0, gridH / 2);

  // ── renderers ─────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(tokens().ink100);
  scene.fog = new THREE.Fog(tokens().ink100, Math.max(gridW, gridH) * 2.4, Math.max(gridW, gridH) * 5);

  const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
  if (opts.camera) camera.position.copy(opts.camera.position);
  else camera.position.set(boardCenter.x + gridW * 0.55, gridW * 0.6, boardCenter.z + gridH * 0.55);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(self.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;

  const cssRenderer = new CSS2DRenderer();
  cssRenderer.domElement.style.position = 'absolute';
  cssRenderer.domElement.style.inset = '0';
  cssRenderer.domElement.style.pointerEvents = 'none';
  canvas.parentElement.appendChild(cssRenderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(opts.camera ? opts.camera.target : boardCenter);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  controls.minDistance = 3;
  controls.maxDistance = Math.max(gridW, gridH) * 3;

  function resize() {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H, false);
    cssRenderer.setSize(W, H);
  }
  resize();

  // ── lighting ──────────────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xfff3d9, 1.05);
  sun.position.set(gridW * 0.4, gridW * 0.9, -gridH * 0.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -gridW; sun.shadow.camera.right = gridW;
  sun.shadow.camera.top = gridH; sun.shadow.camera.bottom = -gridH;
  scene.add(sun);

  // ── ground: one instance per tile, so cost stays flat as boards grow ────
  // (196 tiles for duel, 625 for grand — two draw calls either way, one per
  // mesh below.) Land is an extruded slab, not a flat sheet — the box's top
  // face still sits at
  // y=0 (every overlay above this — pieces, rings, labels, march paths —
  // anchors to that plane), so it reads as ground raised out of the world
  // rather than a floating sheet, and every existing y-offset stays correct.
  // Gap tiles (outside any province — none exist on today's maps, but the
  // map editor will introduce them) get a second, thinner instanced mesh
  // recessed below land level instead of being hidden, so the world can be
  // filled with water once boards have irregular coastlines.
  const TILE_COUNT = gridW * gridH;
  const LAND_DEPTH = 0.26, WATER_DEPTH = 0.05, WATER_SINK = 0.14;
  const tileGeo = new THREE.BoxGeometry(1, LAND_DEPTH, 1);
  const waterGeo = new THREE.BoxGeometry(1, WATER_DEPTH, 1);
  // No `vertexColors: true` here — that flag reads a per-vertex `color`
  // BufferAttribute, which these box geometries don't have; WebGL fills the
  // missing attribute with zero, which multiplies straight through to black
  // before instanceColor is even applied. Instance colours apply on their
  // own whenever mesh.isInstancedMesh && mesh.instanceColor exist, regardless
  // of this flag — it isn't needed and was actively wrong to set.
  const tileMesh = new THREE.InstancedMesh(tileGeo, new THREE.MeshStandardMaterial({ roughness: 0.95 }), TILE_COUNT);
  tileMesh.receiveShadow = true;
  tileMesh.castShadow = true; // land now has real volume, so it can shadow the water it rises out of
  const waterMesh = new THREE.InstancedMesh(waterGeo, new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.05 }), TILE_COUNT);
  waterMesh.receiveShadow = true;
  // InstancedMesh's bounding sphere is derived from the base (untransformed)
  // geometry — a 1x1 box at the origin — not the actual spread of instance
  // positions, so the default frustum-culling check thinks the whole mesh
  // occupies a sliver near world origin and culls it once the camera is
  // positioned to see the real, much larger board.
  tileMesh.frustumCulled = false;
  waterMesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const tileColor = new THREE.Color();
  const LAND_COLOR = new THREE.Color(tokens().land);
  const WATER_COLOR = new THREE.Color(tokens().water);
  const tileIndex = (c, r) => r * gridW + c;
  for (let r = 0; r < gridH; r++) for (let c = 0; c < gridW; c++) {
    const i = tileIndex(c, r);
    const onLand = !!F.territoryAt(M, c, r);

    // Land, and gap tiles hidden (scaled to zero) rather than coloured —
    // see the water block below for the inverse.
    dummy.position.set(c + 0.5, -LAND_DEPTH / 2, r + 0.5);
    dummy.scale.setScalar(onLand ? 1 : 0);
    dummy.updateMatrix();
    tileMesh.setMatrixAt(i, dummy.matrix);
    // Seeding instanceColor here, before the mesh is ever rendered, matters:
    // the material's shader is compiled on first render, keyed in part on
    // whether mesh.instanceColor exists yet. Leaving it to update()'s first
    // setColorAt() call means that first compile can happen (and get cached)
    // without instance-colour support ever baked in — every tile then
    // renders unlit black forever after, no amount of instanceColor.needsUpdate
    // fixes a shader that was never compiled to read it.
    tileMesh.setColorAt(i, LAND_COLOR);

    // Water fills exactly the gap tiles, recessed below land level so a
    // coastline reads as a cliff edge rather than two coplanar sheets. It
    // never changes at runtime (territory shape is fixed for a match), so
    // this seeding is the only place its instanceColor is ever set.
    dummy.position.set(c + 0.5, -WATER_SINK - WATER_DEPTH / 2, r + 0.5);
    dummy.scale.setScalar(onLand ? 0 : 1);
    dummy.updateMatrix();
    waterMesh.setMatrixAt(i, dummy.matrix);
    waterMesh.setColorAt(i, WATER_COLOR);
  }
  dummy.scale.setScalar(1);
  tileMesh.instanceMatrix.needsUpdate = true;
  scene.add(tileMesh);
  waterMesh.instanceMatrix.needsUpdate = true;
  scene.add(waterMesh);

  // Ground plane for raycasting — math only, no mesh needed.
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  // ── slot grid lines + territory borders ──────────────────────────────
  // Every slot gets its own tile grid, sector or not — an empty (water)
  // slot is exactly as many addressable tiles as a sector, it just has no
  // province sitting on it, so it reads as a submerged grid rather than one
  // undivided pool. Land lines sit right at the land surface (y=0); water
  // lines sit at the water surface (y=-WATER_SINK, see the water mesh above)
  // so they don't float above/clip through the recessed water tiles.
  // Colour is the seam tone (a light, desaturated hairline — see tokens()'s
  // own comment on why ink000 was the wrong choice), opacity borrowed
  // straight from the CSS tokens these stand in for: --sl-seam-strong's 0.18
  // ("panel edge, control edge" — a defined boundary) for land, --sl-seam-
  // dash's 0.14 ("placeholder, empty, drop-zone" — exactly what an
  // unclaimed/water slot is) for water, so nothing here is an invented value.
  const gridLineMat = new THREE.LineBasicMaterial({ color: tokens().seam, transparent: true, opacity: 0.18 });
  const waterGridLineMat = new THREE.LineBasicMaterial({ color: tokens().seam, transparent: true, opacity: 0.14 });
  for (let sr = 0; sr < M.slots.rows; sr++) for (let sc = 0; sc < M.slots.cols; sc++) {
    const onLand = !!M.provinceAtSlot(sc, sr);
    const c0 = sc * M.block.w, r0 = sr * M.block.h, w = M.block.w, h = M.block.h;
    const y = onLand ? 0.01 : -WATER_SINK + 0.01;
    const pts = [];
    for (let i = 0; i <= w; i++) pts.push(new THREE.Vector3(c0 + i, y, r0), new THREE.Vector3(c0 + i, y, r0 + h));
    for (let i = 0; i <= h; i++) pts.push(new THREE.Vector3(c0, y, r0 + i), new THREE.Vector3(c0 + w, y, r0 + i));
    scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), onLand ? gridLineMat : waterGridLineMat));
  }
  const borders = new Map(); // province id -> Line2-ish loop (LineLoop is fine at this scale)
  for (const p of M.provinces) {
    const pts = [
      new THREE.Vector3(p.c0, 0.02, p.r0), new THREE.Vector3(p.c0 + p.w, 0.02, p.r0),
      new THREE.Vector3(p.c0 + p.w, 0.02, p.r0 + p.h), new THREE.Vector3(p.c0, 0.02, p.r0 + p.h),
    ];
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: tokens().ink000 }));
    scene.add(line);
    borders.set(p.id, line);
  }

  // ── grid-reference axis labels (A, B, C… along one edge; 1, 2, 3… along
  // the other) — spreadsheet-style column naming so a board wider than 26
  // tiles still gets unambiguous, ever-increasing labels (Z, AA, AB…). A
  // *negative* index (once labelOriginC/R is subtracted — see this side of
  // a low-edge grow the caller made, opts.labelOrigin's own doc comment
  // above) mirrors the same scheme below the origin: "-A", "-B"… for
  // columns, plain negative integers (0, -1, -2…) for rows, since those
  // already read fine without a letter scheme to invert. ────────────────
  if (gridLabels) {
    const colName = i => {
      const neg = i < 0;
      let n = neg ? -i - 1 : i;
      let s = '';
      for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
      return neg ? '-' + s : s;
    };
    for (let c = 0; c < gridW; c++) {
      const lbl = new CSS2DObject(labelDiv(colName(c - labelOriginC), 'fp3d-gridref'));
      lbl.center.set(0.5, 0.5);
      lbl.position.set(c + 0.5, 0.02, -0.6);
      scene.add(lbl);
    }
    for (let r = 0; r < gridH; r++) {
      const lbl = new CSS2DObject(labelDiv(String(r - labelOriginR + 1), 'fp3d-gridref'));
      lbl.center.set(0.5, 0.5);
      lbl.position.set(-0.6, 0.02, r + 0.5);
      scene.add(lbl);
    }
  }

  // ── structures: one box per occupied tile, added/removed/recoloured as
  // the piece set changes; positions never move once placed. ────────────
  const pieceGeo = {};
  for (const kind of Object.keys(KIT)) {
    const k = KIT[kind];
    pieceGeo[kind] = new THREE.BoxGeometry(k.fp, k.h, k.fp);
  }
  const pieces = new Map(); // tileKey -> { mesh, kind, owner }

  /** `seatColour` is the caller's viewer-relative mapping (from update()'s
   *  own closure, not the bare module-level seatColorHex below) — a piece
   *  must render in *your* self colour when you own it and the opponent's
   *  foe colour when they do, same as every ground tile already does. Taking
   *  the module-level absolute seat→colour function here instead was a real
   *  bug: seat 0 always rendered as self-blue and seat 1 always as foe-red,
   *  regardless of who was actually looking — a seat-1 player saw their own
   *  capital in the opponent's colour. Fixed 2026-09-12; see docs/KNOWN_ISSUES.md.
   *
   *  If `kind` has a `model` entry in STRUCTURE_KIT AND that model has
   *  finished loading (see modelTemplates above), a clone of the real .glb
   *  replaces the procedural box. Until then — or for any kind with no
   *  `model` entry at all — this renders the box exactly as before. The
   *  `hasModel` check below (not just kind/owner) is what upgrades an
   *  already-placed box to the real model the moment its load resolves,
   *  rather than only re-evaluating on the next ownership/kind change. A
   *  loaded model keeps its own authored materials/textures rather than
   *  being tinted the seat colour the way a box is — ownership still reads
   *  from the ground tile beneath it (see the tile-colouring loop above)
   *  and the selection ring, same as it does for any other piece. */
  function upsertPiece(key, c, r, kind, owner, seatColour) {
    const cur = pieces.get(key);
    const hasModel = modelTemplates.has(kind);
    if (cur && cur.kind === kind && cur.owner === owner && cur.isModel === hasModel) return;
    if (cur) { scene.remove(cur.mesh); if (!cur.isModel) { cur.mesh.geometry.dispose(); cur.mesh.material.dispose(); } }
    const k = KIT[kind];
    let mesh;
    if (hasModel) {
      mesh = modelTemplates.get(kind).clone(true);
      mesh.scale.setScalar(k.model.scale ?? 1);
      mesh.rotation.y = ((k.model.rotationY || 0) * Math.PI) / 180;
      mesh.position.set(c + 0.5, 0, r + 0.5);
      mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    } else {
      // Brightened the same way board-render.js's own piece() already treats
      // its roof colour (2026-09-15 — this used to be the raw, unbrightened
      // faction colour here, unlike 2D, which is what let a piece blend into
      // ground already filled with a dimmed version of that same hue).
      mesh = new THREE.Mesh(pieceGeo[kind], new THREE.MeshStandardMaterial({
        color: owner === null ? shade(tokens().neutral, 1.3) : shade(seatColour(owner), 1.5), roughness: 0.6,
      }));
      mesh.position.set(c + 0.5, k.h / 2, r + 0.5);
      mesh.castShadow = true; mesh.receiveShadow = true;
    }
    scene.add(mesh);
    pieces.set(key, { mesh, kind, owner, isModel: hasModel });
  }
  function removePiece(key) {
    const cur = pieces.get(key);
    if (!cur) return;
    scene.remove(cur.mesh); if (!cur.isModel) cur.mesh.material.dispose();
    pieces.delete(key);
  }

  // ── garrison labels, troop stacks, selection/armed rings ────────────
  const garrisonLabels = new Map(); // tileKey -> CSS2DObject
  const troopMeshes = new Map();    // stack id -> { sphere, label }

  const selRing = new THREE.Mesh(
    new THREE.RingGeometry(0.32, 0.42, 24),
    new THREE.MeshBasicMaterial({ color: tokens().signal, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
  );
  selRing.rotation.x = -Math.PI / 2;
  selRing.visible = false;
  scene.add(selRing);

  const armedRing = selRing.clone();
  armedRing.material = armedRing.material.clone();
  armedRing.visible = false;
  scene.add(armedRing);

  const focusTarget = new THREE.Vector3(); // scratch for the selection camera-lock, below

  const multiGroup = new THREE.Group();
  scene.add(multiGroup);
  const multiMat = new THREE.MeshBasicMaterial({ color: tokens().signal, transparent: true, opacity: 0.22, side: THREE.DoubleSide });

  // Drag-to-march preview: a thin box strip per path segment (cheap, no
  // extra geometry types to load) plus a floating label at the destination.
  const marchGroup = new THREE.Group();
  scene.add(marchGroup);
  let marchLabel = null;

  // ── update ────────────────────────────────────────────────────────────
  /** @param o same shape board-render.js's `board()` takes: owners,
   *  garrisons, barracks, industry, stacks, stackAt, seatColour, sel, armed,
   *  multi, marchPath (array of [c,r] tiles, or null), marchLabel (string) */
  function update(o) {
    o = o || {};
    const owners = o.owners || {};
    const toHex = c => (typeof c === 'number' ? c : parseInt(String(c).replace('#', '0x')));
    const seatColour = o.seatColour ? (s => toHex(o.seatColour(s))) : seatColorHex;

    // Tiles + territory borders.
    for (const p of M.provinces) {
      const terr = F.territoryOwner(M, owners, p);
      const borderLine = borders.get(p.id);
      borderLine.material.color.set(terr !== null ? seatColour(terr) : tokens().ink000);
      for (let r = p.r0; r < p.r0 + p.h; r++) for (let c = p.c0; c < p.c0 + p.w; c++) {
        const own = terr !== null ? terr : (owners[F.tileKey(c, r)] ?? null);
        tileColor.set(own === null ? tokens().land : seatColour(own));
        if (own !== null) tileColor.multiplyScalar(terr !== null ? 0.82 : 0.62); // dimmer once fully held, dimmer still while contested — same weighting as board-render.js
        tileMesh.setColorAt(tileIndex(c, r), tileColor);
      }
    }
    tileMesh.instanceColor.needsUpdate = true;

    // Structures — same piece-per-tile rule as board-render.js: cities keep
    // their province's capital vs. plain-city status, barracks/industry are
    // sparse overlays, one piece wins per tile (capital > industry > barracks > city).
    const wanted = new Map();
    const put = (c, r, kind, own) => {
      const key = F.tileKey(c, r);
      const cur = wanted.get(key);
      if (cur && PIECE_RANK[cur.kind] >= PIECE_RANK[kind]) return;
      wanted.set(key, { c, r, kind, own });
    };
    // o.cities lets a caller whose city list can change after create() (the
    // map editor — add/delete/move a city without a full scene rebuild) hand
    // in the live list each frame; game.html never passes this (a match's
    // cities are fixed for its whole lifetime) and gets the original,
    // create()-time M.cities, same as before this option existed.
    const liveCities = o.cities || M.cities;
    for (const p of M.provinces) {
      const cap = F.capitalOf({ cities: liveCities }, p);
      for (const city of liveCities) {
        if (city.prov !== p.id) continue;
        const c = p.c0 + city.lc, r = p.r0 + city.lr;
        put(c, r, cap && cap.id === city.id ? 'capital' : 'city', owners[F.tileKey(c, r)] ?? null);
      }
    }
    for (const k of Object.keys(o.barracks || {})) { const [c, r] = k.split(',').map(Number); if (F.territoryAt(M, c, r)) put(c, r, 'barracks', o.barracks[k]); }
    for (const k of Object.keys(o.industry || {})) { const [c, r] = k.split(',').map(Number); if (F.territoryAt(M, c, r)) put(c, r, 'industry', o.industry[k]); }

    for (const key of [...pieces.keys()]) if (!wanted.has(key)) removePiece(key);
    for (const [key, w] of wanted) upsertPiece(key, w.c, w.r, w.kind, w.own, seatColour);

    // Garrison labels.
    const garrisons = o.garrisons || {};
    const wantedLabels = new Set(Object.keys(garrisons).filter(k => garrisons[k] > 0));
    for (const key of [...garrisonLabels.keys()]) if (!wantedLabels.has(key)) { scene.remove(garrisonLabels.get(key)); garrisonLabels.delete(key); }
    for (const key of wantedLabels) {
      const [c, r] = key.split(',').map(Number);
      let obj = garrisonLabels.get(key);
      if (!obj) {
        obj = new CSS2DObject(labelDiv('', 'fp3d-garrison'));
        obj.center.set(0.5, 1); // anchor above the tile point, not centred on it
        obj.position.set(c + 0.5, 0.05, r + 0.5);
        scene.add(obj); garrisonLabels.set(key, obj);
      }
      obj.element.textContent = String(garrisons[key]);
    }

    // Troops in transit.
    const stacks = o.stacks || [];
    const liveIds = new Set();
    for (const st of stacks) {
      const at = o.stackAt ? o.stackAt(st) : null;
      if (!at) continue;
      liveIds.add(st.id);
      let t = troopMeshes.get(st.id);
      if (!t) {
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshStandardMaterial({ roughness: 0.4 }));
        sphere.castShadow = true;
        scene.add(sphere);
        const label = new CSS2DObject(labelDiv('', 'fp3d-troop'));
        label.center.set(0.5, 1.4); // float above the sphere, not centred on it
        sphere.add(label);
        label.position.set(0, 0.35, 0);
        t = { sphere, label };
        troopMeshes.set(st.id, t);
      }
      t.sphere.position.set(at[0] + 0.5, 0.3, at[1] + 0.5);
      t.sphere.material.color.set(seatColour(st.seat));
      t.label.element.textContent = String(st.count);
    }
    for (const id of [...troopMeshes.keys()]) if (!liveIds.has(id)) {
      const t = troopMeshes.get(id);
      // t.label is a CSS2DObject nested under t.sphere, not a direct child of
      // scene — scene.remove(sphere) only dispatches Object3D's 'removed'
      // event on sphere itself, not recursively on its descendants, so the
      // label's DOM node never gets cleaned up and CSS2DRenderer (which
      // walks down from `scene`) can no longer reach it to reposition it.
      // Left like this, the number freezes on screen at its last projected
      // spot forever, ignoring all further camera movement. Detaching the
      // label directly fires its own 'removed' listener first.
      t.sphere.remove(t.label);
      scene.remove(t.sphere);
      troopMeshes.delete(id);
    }

    // Selection / armed rings.
    const placeRing = (ring, tile) => {
      if (!tile) { ring.visible = false; return; }
      ring.visible = true;
      ring.position.set(tile.c + 0.5, 0.06, tile.r + 0.5);
    };
    placeRing(selRing, o.sel || null);
    placeRing(armedRing, o.armed || null);

    // Camera lock + centre-on-selection: whichever tile is selected or armed
    // becomes the orbit target, and rotate/pan are frozen so the player can't
    // pan or spin away from a tile they just committed to mid-order — only
    // zoom stays live. The lock lifts the instant nothing is selected, which
    // game.html already arranges by clearing sel/armed on a click outside
    // the board.
    const focus = selectionLock ? (o.sel || o.armed || null) : null;
    if (focus) {
      controls.enableRotate = false;
      controls.enablePan = false;
      focusTarget.set(focus.c + 0.5, 0, focus.r + 0.5);
      controls.target.lerp(focusTarget, 0.15);
    } else {
      controls.enableRotate = true;
      controls.enablePan = true;
    }

    // Multi-select tile outlines.
    while (multiGroup.children.length) { const m = multiGroup.children.pop(); m.geometry.dispose(); }
    for (const key of (o.multi || [])) {
      const [c, r] = key.split(',').map(Number);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), multiMat);
      mesh.position.set(c + 0.5, 0.04, r + 0.5);
      multiGroup.add(mesh);
    }

    // Drag-to-march preview path.
    while (marchGroup.children.length) { const m = marchGroup.children.pop(); m.geometry.dispose(); m.material.dispose(); }
    if (marchLabel) { scene.remove(marchLabel); marchLabel = null; }
    if (o.marchPath && o.marchPath.length > 1) {
      const pts = o.marchPath.map(([c, r]) => new THREE.Vector3(c + 0.5, 0.08, r + 0.5));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: tokens().signal, linewidth: 2 }));
      marchGroup.add(line);
      if (o.marchLabelText) {
        marchLabel = new CSS2DObject(labelDiv(o.marchLabelText, 'fp3d-march'));
        marchLabel.center.set(0.5, 1);
        const end = pts[pts.length - 1];
        marchLabel.position.set(end.x, 0.6, end.z);
        scene.add(marchLabel);
      }
    }
  }

  // ── hit-testing ───────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hitPoint = new THREE.Vector3();

  /** Screen px (relative to the canvas) -> the tile under it, or null off the
   *  grid entirely — land or water, occupied slot or empty one, no territory
   *  filtering. Simpler than map.js's cam.unproject(): a straight ray/plane
   *  intersection, no inverse-rotation math, and correct at any camera angle
   *  rather than only at the four locked bearings. Exists as its own function
   *  (rather than folded into tileAt below) for the map editor, which needs
   *  to hit-test an empty slot to offer "place a territory here" — the live
   *  match client has no use for a tile outside any territory and keeps
   *  calling tileAt(), which still rejects those exactly as before. */
  function tileAtAny(mx, my) {
    const rect = canvas.getBoundingClientRect();
    ndc.set((mx / rect.width) * 2 - 1, -(my / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return null;
    const c = Math.floor(hitPoint.x), r = Math.floor(hitPoint.z);
    if (c < 0 || r < 0 || c >= gridW || r >= gridH) return null;
    return { c, r };
  }

  /** Screen px -> the province tile under it, or null off the board (off the
   *  grid, or on it but in an empty/unclaimable slot). What the live match
   *  client uses for all its click-to-select/march hit-testing. */
  function tileAt(mx, my) {
    const t = tileAtAny(mx, my);
    if (!t || !F.territoryAt(M, t.c, t.r)) return null;
    return t;
  }

  function dispose() {
    controls.dispose();
    cssRenderer.domElement.remove();
    renderer.dispose();
  }

  return { scene, camera, controls, renderer, cssRenderer, update, tileAt, tileAtAny, resize, dispose };
}
