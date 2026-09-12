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

const KIT = {
  barracks: { fp: 0.54, h: 0.40 },
  industry: { fp: 0.74, h: 0.42 },
  capital: { fp: 0.66, h: 0.72 },
  city: { fp: 0.44, h: 0.26 },
};
const PIECE_RANK = { capital: 3, industry: 2, barracks: 1, city: 0 };

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
 *  @param M      built board from FPMap.build — same input board-render.js takes */
export function create(canvas, M) {
  const F = self.FPMap;
  const gridW = M.gridW, gridH = M.gridH;
  const boardCenter = new THREE.Vector3(gridW / 2, 0, gridH / 2);

  // ── renderers ─────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(tokens().ink100);
  scene.fog = new THREE.Fog(tokens().ink100, Math.max(gridW, gridH) * 2.4, Math.max(gridW, gridH) * 5);

  const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
  camera.position.set(boardCenter.x + gridW * 0.55, gridW * 0.6, boardCenter.z + gridH * 0.55);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(self.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;

  const cssRenderer = new CSS2DRenderer();
  cssRenderer.domElement.style.position = 'absolute';
  cssRenderer.domElement.style.inset = '0';
  cssRenderer.domElement.style.pointerEvents = 'none';
  canvas.parentElement.appendChild(cssRenderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(boardCenter);
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
  // (196 tiles for duel, 625 for grand — one draw call either way.)
  const TILE_COUNT = gridW * gridH;
  const tileGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  // No `vertexColors: true` here — that flag reads a per-vertex `color`
  // BufferAttribute, which this plane geometry doesn't have; WebGL fills the
  // missing attribute with zero, which multiplies straight through to black
  // before instanceColor is even applied. Instance colours apply on their
  // own whenever mesh.isInstancedMesh && mesh.instanceColor exist, regardless
  // of this flag — it isn't needed and was actively wrong to set.
  const tileMesh = new THREE.InstancedMesh(tileGeo, new THREE.MeshStandardMaterial({ roughness: 0.95 }), TILE_COUNT);
  tileMesh.receiveShadow = true;
  // InstancedMesh's bounding sphere is derived from the base (untransformed)
  // geometry — a 1x1 plane at the origin — not the actual spread of instance
  // positions, so the default frustum-culling check thinks the whole mesh
  // occupies a sliver near world origin and culls it once the camera is
  // positioned to see the real, much larger board.
  tileMesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const tileColor = new THREE.Color();
  const LAND_COLOR = new THREE.Color(tokens().land);
  const tileIndex = (c, r) => r * gridW + c;
  for (let r = 0; r < gridH; r++) for (let c = 0; c < gridW; c++) {
    dummy.position.set(c + 0.5, 0, r + 0.5);
    dummy.updateMatrix();
    tileMesh.setMatrixAt(tileIndex(c, r), dummy.matrix);
    // Seeding instanceColor here, before the mesh is ever rendered, matters:
    // the material's shader is compiled on first render, keyed in part on
    // whether mesh.instanceColor exists yet. Leaving it to update()'s first
    // setColorAt() call means that first compile can happen (and get cached)
    // without instance-colour support ever baked in — every tile then
    // renders unlit black forever after, no amount of instanceColor.needsUpdate
    // fixes a shader that was never compiled to read it.
    tileMesh.setColorAt(tileIndex(c, r), LAND_COLOR);
  }
  // Tiles outside any province (grid padding, if a board ever has gaps)
  // stay hidden — scale to zero rather than colouring them.
  for (let r = 0; r < gridH; r++) for (let c = 0; c < gridW; c++) {
    if (!F.territoryAt(M, c, r)) { dummy.scale.set(0, 0, 0); dummy.updateMatrix(); tileMesh.setMatrixAt(tileIndex(c, r), dummy.matrix); dummy.scale.set(1, 1, 1); }
  }
  tileMesh.instanceMatrix.needsUpdate = true;
  scene.add(tileMesh);

  // Ground plane for raycasting — math only, no mesh needed.
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  // ── province grid lines + territory borders ──────────────────────────
  const gridLineMat = new THREE.LineBasicMaterial({ color: tokens().ink000, transparent: true, opacity: 0.5 });
  for (const p of M.provinces) {
    const pts = [];
    for (let i = 0; i <= p.w; i++) pts.push(new THREE.Vector3(p.c0 + i, 0.01, p.r0), new THREE.Vector3(p.c0 + i, 0.01, p.r0 + p.h));
    for (let i = 0; i <= p.h; i++) pts.push(new THREE.Vector3(p.c0, 0.01, p.r0 + i), new THREE.Vector3(p.c0 + p.w, 0.01, p.r0 + i));
    scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), gridLineMat));
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

  // ── structures: one box per occupied tile, added/removed/recoloured as
  // the piece set changes; positions never move once placed. ────────────
  const pieceGeo = {};
  for (const kind of Object.keys(KIT)) {
    const k = KIT[kind];
    pieceGeo[kind] = new THREE.BoxGeometry(k.fp, k.h, k.fp);
  }
  const pieces = new Map(); // tileKey -> { mesh, kind, owner }

  function upsertPiece(key, c, r, kind, owner) {
    const cur = pieces.get(key);
    if (cur && cur.kind === kind && cur.owner === owner) return;
    if (cur) { scene.remove(cur.mesh); cur.mesh.geometry.dispose(); cur.mesh.material.dispose(); }
    const k = KIT[kind];
    const mesh = new THREE.Mesh(pieceGeo[kind], new THREE.MeshStandardMaterial({
      color: owner === null ? tokens().neutral : seatColorHex(owner), roughness: 0.6,
    }));
    mesh.position.set(c + 0.5, k.h / 2, r + 0.5);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    pieces.set(key, { mesh, kind, owner });
  }
  function removePiece(key) {
    const cur = pieces.get(key);
    if (!cur) return;
    scene.remove(cur.mesh); cur.mesh.material.dispose();
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
    for (const p of M.provinces) {
      const cap = F.capitalOf(M, p);
      for (const city of M.cities) {
        if (city.prov !== p.id) continue;
        const c = p.c0 + city.lc, r = p.r0 + city.lr;
        put(c, r, cap && cap.id === city.id ? 'capital' : 'city', owners[F.tileKey(c, r)] ?? null);
      }
    }
    for (const k of Object.keys(o.barracks || {})) { const [c, r] = k.split(',').map(Number); if (F.territoryAt(M, c, r)) put(c, r, 'barracks', o.barracks[k]); }
    for (const k of Object.keys(o.industry || {})) { const [c, r] = k.split(',').map(Number); if (F.territoryAt(M, c, r)) put(c, r, 'industry', o.industry[k]); }

    for (const key of [...pieces.keys()]) if (!wanted.has(key)) removePiece(key);
    for (const [key, w] of wanted) upsertPiece(key, w.c, w.r, w.kind, w.own);

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
    const focus = o.sel || o.armed || null;
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

  /** Screen px (relative to the canvas) -> the province tile under it, or
   *  null off the board. Simpler than map.js's cam.unproject(): a straight
   *  ray/plane intersection, no inverse-rotation math, and correct at any
   *  camera angle rather than only at the four locked bearings. */
  function tileAt(mx, my) {
    const rect = canvas.getBoundingClientRect();
    ndc.set((mx / rect.width) * 2 - 1, -(my / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return null;
    const c = Math.floor(hitPoint.x), r = Math.floor(hitPoint.z);
    if (c < 0 || r < 0 || c >= gridW || r >= gridH) return null;
    if (!F.territoryAt(M, c, r)) return null;
    return { c, r };
  }

  function dispose() {
    controls.dispose();
    cssRenderer.domElement.remove();
    renderer.dispose();
  }

  return { scene, camera, controls, renderer, cssRenderer, update, tileAt, resize, dispose };
}
