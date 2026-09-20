// board.js — Board View, rebuilt against the REAL `duel` board (see
// docs/MAP_SYSTEM.md) instead of a generic hand-painted grid, so a prop's
// placement previews against the actual territory shapes, roads, and
// capitals/cities board-render-3d.js draws in a real match — not an
// approximation of them.
//
// Static `FPMap.MAPS.duel` only, not the live D1-backed copy — this is a
// local dev-only page with no session, so it can't call the authenticated
// GET /api/maps/duel the way editor.html does (see tile-placer.html).
//
// Each tile is still exactly 1x1 and objects still save position/scale as
// fractions of it, same convention as Tile View — this view just adds
// *which* absolute board tile (tileX/tileZ = the real board's own c/r) each
// object sits on. See exportLayout() below for the exact JSON shape.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OBJECT_TYPES, onObjectTypeRegistered } from './objects.js';
import { makeGridTexture } from './gridTexture.js';
import { getLayoutObjects } from './main.js';
import { exportCustomTypes, importCustomTypes } from './glb.js';

// Set by the classic <script src="../map.js"> tag in tile-placer.html —
// same self.FPMap access pattern board-render-3d.js already uses, and safe
// for the same reason: a <script type="module"> always runs after every
// classic script on the page, regardless of source order.
const F = self.FPMap;
const M = F.build(F.MAPS.duel);
const { gridW, gridH } = M;

// ---------------------------------------------------------------------
// Scene / renderer / camera — dark, to match the in-game board look.
// ---------------------------------------------------------------------

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0c0a);
scene.fog = new THREE.Fog(0x0b0c0a, 20, 90);

const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 150);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.getElementById('board-viewport').appendChild(renderer.domElement);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.minDistance = 1;
orbit.maxDistance = 70;
orbit.maxPolarAngle = Math.PI * 0.49;

scene.add(new THREE.HemisphereLight(0x9fb2c8, 0x1a1a16, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(6, 9, 5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0015;
const shadowSpan = Math.max(gridW, gridH) / 2 + 2;
key.shadow.camera.left = -shadowSpan;
key.shadow.camera.right = shadowSpan;
key.shadow.camera.top = shadowSpan;
key.shadow.camera.bottom = -shadowSpan;
key.shadow.camera.far = 60;
key.shadow.camera.updateProjectionMatrix();
scene.add(key);
const fill = new THREE.DirectionalLight(0x7fa0c0, 0.5);
fill.position.set(-6, 4, -4);
scene.add(fill);

// ---------------------------------------------------------------------
// Tile materials — one per owner (seat 0/1/neutral) and a lightened "road"
// variant of each, plus a separate water treatment for any gap tile (see
// docs/MAP_SYSTEM.md → Sparse boards and water). Real seats are 0/1/null;
// this tool keeps the existing blue/red/neutral vocabulary its swatches
// already use — 0 → blue, 1 → red, null → neutral — same mapping
// board-render-3d.js makes via seatColour().
// ---------------------------------------------------------------------

const SEAT_KEY = { 0: 'blue', 1: 'red' };
const TILE_COLORS = { neutral: '#141614', blue: '#2f6fb0', red: '#b0503a' };
const WATER_COLOR = '#0d1b22';

function lighten(hex, amt) {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  const c = [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => Math.min(255, Math.round(v + (255 - v) * amt)));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

const tileMaterials = {}; // ownerKey -> { flat, road }
for (const [ownerKey, hex] of Object.entries(TILE_COLORS)) {
  tileMaterials[ownerKey] = {
    flat: new THREE.MeshStandardMaterial({
      map: makeGridTexture(hex, { borderAlpha: 0.4, divisions: 1, crosshair: false }),
      roughness: 0.92,
    }),
    // Roads read as a lighter strip in the live 3D renderer; this tool has
    // no per-tile road overlay geometry, so the road tiles' own base tile
    // gets lightened instead — enough to tell "this runs along a road"
    // apart from plain open ground while placing a prop near one.
    road: new THREE.MeshStandardMaterial({
      map: makeGridTexture(lighten(hex, 0.22), { borderAlpha: 0.4, divisions: 1, crosshair: false }),
      roughness: 0.92,
    }),
  };
}
const waterMaterial = new THREE.MeshStandardMaterial({
  map: makeGridTexture(WATER_COLOR, { borderAlpha: 0.4, divisions: 1, crosshair: false }),
  roughness: 0.4,
  metalness: 0.1,
});

const highlightMat = new THREE.LineBasicMaterial({ color: 0xffffff });

// ---------------------------------------------------------------------
// Board — one 1x1 tile per cell of the real board's gridW x gridH, coloured
// by real territory/road/water/starting-ownership data instead of painted
// by hand.
// ---------------------------------------------------------------------

const tiles = new Map(); // "x_z" -> { x, z, mesh, isWater, ownerOverride }
const boardGroup = new THREE.Group();
scene.add(boardGroup);
const landmarksGroup = new THREE.Group(); // capital/city reference markers
scene.add(landmarksGroup);

let activeTile = null; // { x, z, ... } — where new objects spawn
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
  highlightMat
);
highlight.rotation.x = -Math.PI / 2;
highlight.position.y = 0.006;
highlight.visible = false;
scene.add(highlight);

function tileWorldX(x) {
  return x - (gridW - 1) / 2;
}
function tileWorldZ(z) {
  return z - (gridH - 1) / 2;
}

function tileOwnerKey(tile) {
  if (tile.ownerOverride !== null) return tile.ownerOverride;
  const seat = startOwners[F.tileKey(tile.x, tile.z)];
  return seat === undefined || seat === null ? 'neutral' : SEAT_KEY[seat];
}

function materialFor(tile) {
  if (tile.isWater) return waterMaterial;
  const mats = tileMaterials[tileOwnerKey(tile)];
  return F.isRoad(M, tile.x, tile.z) ? mats.road : mats.flat;
}

// Real territory outlines (one rectangle per province, from the actual
// board definition) in place of the old fixed-7-tile "quadrant" grid lines
// — generalizes correctly even if a future board's territories aren't all
// the same size.
const territoryLineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
const territoryLines = new THREE.Group();
scene.add(territoryLines);

function buildTerritoryLines() {
  territoryLines.clear();
  const y = 0.004;
  for (const p of M.provinces) {
    const x0 = tileWorldX(p.c0) - 0.5, x1 = tileWorldX(p.c0 + p.w - 1) + 0.5;
    const z0 = tileWorldZ(p.r0) - 0.5, z1 = tileWorldZ(p.r0 + p.h - 1) + 0.5;
    const pts = [
      new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y, z0),
      new THREE.Vector3(x1, y, z0), new THREE.Vector3(x1, y, z1),
      new THREE.Vector3(x1, y, z1), new THREE.Vector3(x0, y, z1),
      new THREE.Vector3(x0, y, z1), new THREE.Vector3(x0, y, z0),
    ];
    territoryLines.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), territoryLineMat));
  }
}

// Small reference markers at every city tile — a taller cone for a
// territory's capital, a shorter box for a plain city — coloured by that
// city's own starting seat. Not part of `placed`: these describe the
// board itself, not something you can select/move/delete here.
function buildLandmarks() {
  landmarksGroup.clear();
  for (const city of M.cities) {
    const p = M.province(city.prov);
    if (!p) continue;
    const c = p.c0 + city.lc, r = p.r0 + city.lr;
    const ownerKey = city.seat === null || city.seat === undefined ? 'neutral' : SEAT_KEY[city.seat];
    const color = new THREE.Color(TILE_COLORS[ownerKey]);
    let mesh;
    if (city.capital) {
      mesh = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 12), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
      mesh.position.y = 0.27;
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.28), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
      mesh.position.y = 0.13;
    }
    mesh.position.x = tileWorldX(c);
    mesh.position.z = tileWorldZ(r);
    mesh.castShadow = true;
    landmarksGroup.add(mesh);
  }
}

let startOwners = {}; // tileKey -> seat, from FPMap.seedOwners(M) — recomputed on buildBoard()

function buildBoard() {
  boardGroup.clear();
  tiles.clear();
  startOwners = F.seedOwners(M);

  for (let r = 0; r < gridH; r++) {
    for (let c = 0; c < gridW; c++) {
      const isWater = !F.territoryAt(M, c, r);
      const tile = { x: c, z: r, mesh: null, isWater, ownerOverride: null };
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), materialFor(tile));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(tileWorldX(c), 0, tileWorldZ(r));
      mesh.receiveShadow = true;
      mesh.userData.isTile = true;
      mesh.userData.tileX = c;
      mesh.userData.tileZ = r;
      tile.mesh = mesh;
      boardGroup.add(mesh);
      tiles.set(`${c}_${r}`, tile);
    }
  }

  buildTerritoryLines();
  buildLandmarks();

  const boardInfo = document.getElementById('board-info');
  boardInfo.textContent = `${F.MAPS.duel.name || 'duel'} — ${gridW}×${gridH} tiles, ${M.provinces.length} territories, ${M.cities.length} cities`;

  setActiveTile(tiles.get(`${Math.floor(gridW / 2)}_${Math.floor(gridH / 2)}`) || null);
  fitCameraToBoard();
}

function setActiveTile(tile) {
  activeTile = tile;
  if (tile) {
    highlight.position.set(tile.mesh.position.x, 0.006, tile.mesh.position.z);
    highlight.visible = true;
    const kind = tile.isWater ? 'water' : `land, ${tileOwnerKey(tile)}${F.isRoad(M, tile.x, tile.z) ? ', road' : ''}`;
    activeTileLabel.textContent = `Active tile: (${tile.x}, ${tile.z}) — ${kind}`;
  } else {
    highlight.visible = false;
    activeTileLabel.textContent = 'Active tile: none — click a tile';
  }
  updateColorButtons();
}

function setTileOwner(tile, ownerKey) {
  tile.ownerOverride = ownerKey;
  tile.mesh.material = materialFor(tile);
  updateColorButtons();
}

function fitCameraToBoard() {
  const span = Math.max(gridW, gridH);
  const dist = span * 2.3 + 1.5;
  camera.position.set(dist * 0.62, dist * 0.6, dist * 0.72);
  orbit.target.set(0, 0.15, 0);
  orbit.update();
}

// ---------------------------------------------------------------------
// Placed objects
// ---------------------------------------------------------------------

const placed = []; // { id, type, root, tileX, tileZ }
let nextId = 1;
let selected = null;

const objectsLayer = new THREE.Group();
scene.add(objectsLayer);

function spawn(type, tile, state = null) {
  const def = OBJECT_TYPES[type];
  if (!def || !tile) return null;
  const root = def.create();
  root.userData.placeable = true;
  root.userData.type = type;

  const id = state?.id || `${type}-${nextId++}`;
  root.userData.id = id;

  const originX = tileWorldX(tile.x);
  const originZ = tileWorldZ(tile.z);

  if (state) {
    root.position.set(
      originX + state.position.x,
      state.position.y,
      originZ + state.position.z
    );
    root.rotation.y = (state.rotationY * Math.PI) / 180;
    root.scale.setScalar(state.scale);
  } else {
    root.position.set(originX, 0, originZ);
    root.scale.setScalar(def.defaultScale);
  }

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  objectsLayer.add(root);
  const entry = { id, type, root, tileX: tile.x, tileZ: tile.z };
  placed.push(entry);
  refreshObjectList();
  return entry;
}

function removeEntry(entry) {
  if (selected === entry) selectObject(null);
  objectsLayer.remove(entry.root);
  const i = placed.indexOf(entry);
  if (i >= 0) placed.splice(i, 1);
  refreshObjectList();
}

function clearObjects() {
  for (const entry of [...placed]) removeEntry(entry);
}

// ---------------------------------------------------------------------
// Selection + gizmo
// ---------------------------------------------------------------------

const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setMode('translate');
gizmo.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
});
gizmo.addEventListener('objectChange', () => updatePanelFromSelection());
scene.add(gizmo.getHelper ? gizmo.getHelper() : gizmo);

function selectObject(entry) {
  selected = entry;
  if (entry) {
    gizmo.attach(entry.root);
  } else {
    gizmo.detach();
  }
  updatePanelFromSelection();
  refreshObjectList();
}

const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
let downPos = null;

renderer.domElement.addEventListener('pointerdown', (e) => {
  downPos = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downPos) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  downPos = null;
  if (moved > 4) return; // was a drag/orbit, not a click
  if (gizmo.dragging) return;

  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);

  // objects take priority over tiles
  const meshes = [];
  for (const entry of placed) {
    entry.root.traverse((o) => {
      if (o.isMesh) meshes.push(o);
    });
  }
  const objectHits = raycaster.intersectObjects(meshes, false);
  if (objectHits.length > 0) {
    let obj = objectHits[0].object;
    while (obj && !obj.userData.placeable) obj = obj.parent;
    const entry = placed.find((p) => p.root === obj);
    selectObject(entry || null);
    return;
  }

  const tileHits = raycaster.intersectObjects(boardGroup.children, false);
  if (tileHits.length > 0) {
    const t = tileHits[0].object.userData;
    selectObject(null);
    setActiveTile(tiles.get(`${t.tileX}_${t.tileZ}`));
    return;
  }

  selectObject(null);
});

// ---------------------------------------------------------------------
// "R" to fit the whole board in view (matches the in-game hint) — but
// not while the user is typing in a sidebar field.
// ---------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (!isRunning) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.key.toLowerCase() === 'r') fitCameraToBoard();
});

// ---------------------------------------------------------------------
// Sidebar UI
// ---------------------------------------------------------------------

// "Place Tile Editor layout" stamps whatever arrangement is currently
// built in Tile View (one object or several, each at its own tuned
// position/rotation/scale) onto the active board tile, at the exact
// same tile-relative transforms — so a barricade sized to fit a tile
// there lands at the same size here.
const stampBtn = document.getElementById('board-stamp-btn');
stampBtn.addEventListener('click', () => {
  if (!activeTile) return;
  const layout = getLayoutObjects();
  if (!layout.length) {
    stampBtn.textContent = 'Tile View is empty — add objects there first';
    setTimeout(() => (stampBtn.textContent = 'Place Tile Editor layout'), 1800);
    return;
  }
  let last = null;
  for (const obj of layout) {
    if (!OBJECT_TYPES[obj.type]) continue;
    last = spawn(obj.type, activeTile, obj);
  }
  if (last) selectObject(last);
});

const paletteEl = document.getElementById('board-palette');
function addPaletteButton(type, def) {
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = `+ ${def.label} (default size)`;
  btn.addEventListener('click', () => {
    if (!activeTile) return;
    const entry = spawn(type, activeTile);
    selectObject(entry);
  });
  paletteEl.appendChild(btn);
}
for (const [type, def] of Object.entries(OBJECT_TYPES)) addPaletteButton(type, def);
// A .glb dropped anywhere registers a new type at runtime — pick that up
// live instead of only building the palette once at load.
onObjectTypeRegistered((type, def) => addPaletteButton(type, def));

// Called by tabs.js right after registering a dropped .glb, so it
// appears on the active tile immediately instead of waiting for a click.
export function spawnType(type) {
  if (!activeTile) return null;
  const entry = spawn(type, activeTile);
  selectObject(entry);
  return entry;
}

const activeTileLabel = document.getElementById('board-active-tile');
const paintTerritoryCheckbox = document.getElementById('board-paint-quadrant');
const colorButtons = document.querySelectorAll('[data-owner]');
colorButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!activeTile || activeTile.isWater) return;
    if (paintTerritoryCheckbox.checked) {
      const p = F.territoryAt(M, activeTile.x, activeTile.z);
      for (const [c, r] of F.tilesOf(M, p)) setTileOwner(tiles.get(`${c}_${r}`), btn.dataset.owner);
    } else {
      setTileOwner(activeTile, btn.dataset.owner);
    }
  });
});
function updateColorButtons() {
  const disabled = !activeTile || activeTile.isWater;
  colorButtons.forEach((btn) => {
    btn.classList.toggle('active', !disabled && tileOwnerKey(activeTile) === btn.dataset.owner);
    btn.disabled = disabled;
  });
}

document.getElementById('board-rebuild').addEventListener('click', () => {
  if (placed.length && !confirm('Reset the board? This clears all placed objects and any manual tile-colour overrides.')) return;
  clearObjects();
  buildBoard();
});

const panel = document.getElementById('board-panel');
const fieldX = document.getElementById('board-field-x');
const fieldY = document.getElementById('board-field-y');
const fieldZ = document.getElementById('board-field-z');
const fieldRot = document.getElementById('board-field-rot');
const fieldScale = document.getElementById('board-field-scale');
const selLabel = document.getElementById('board-sel-label');
const deleteBtn = document.getElementById('board-delete-btn');
const modeButtons = document.querySelectorAll('#board-tab [data-mode]');

function updatePanelFromSelection() {
  if (!selected) {
    panel.classList.add('disabled');
    selLabel.textContent = 'Nothing selected';
    return;
  }
  panel.classList.remove('disabled');
  const def = OBJECT_TYPES[selected.type];
  selLabel.textContent = `${def.label} · tile (${selected.tileX},${selected.tileZ}) · ${selected.id}`;
  const originX = tileWorldX(selected.tileX);
  const originZ = tileWorldZ(selected.tileZ);
  fieldX.value = (selected.root.position.x - originX).toFixed(3);
  fieldY.value = selected.root.position.y.toFixed(3);
  fieldZ.value = (selected.root.position.z - originZ).toFixed(3);
  fieldRot.value = ((selected.root.rotation.y * 180) / Math.PI).toFixed(1);
  fieldScale.value = selected.root.scale.x.toFixed(3);
}

function applyFieldsToSelection() {
  if (!selected) return;
  const originX = tileWorldX(selected.tileX);
  const originZ = tileWorldZ(selected.tileZ);
  selected.root.position.set(
    originX + (parseFloat(fieldX.value) || 0),
    parseFloat(fieldY.value) || 0,
    originZ + (parseFloat(fieldZ.value) || 0)
  );
  selected.root.rotation.y = ((parseFloat(fieldRot.value) || 0) * Math.PI) / 180;
  const s = Math.max(0.001, parseFloat(fieldScale.value) || 0.001);
  selected.root.scale.setScalar(s);
}

[fieldX, fieldY, fieldZ, fieldRot, fieldScale].forEach((el) => {
  el.addEventListener('input', applyFieldsToSelection);
});

deleteBtn.addEventListener('click', () => {
  if (selected) removeEntry(selected);
});

modeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    modeButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    gizmo.setMode(btn.dataset.mode);
  });
});

const listEl = document.getElementById('board-object-list');
function refreshObjectList() {
  listEl.innerHTML = '';
  for (const entry of placed) {
    const row = document.createElement('div');
    row.className = 'list-row' + (entry === selected ? ' active' : '');
    const label = document.createElement('span');
    label.textContent = `${OBJECT_TYPES[entry.type].label} — (${entry.tileX},${entry.tileZ}) — ${entry.id}`;
    row.appendChild(label);
    const del = document.createElement('button');
    del.className = 'list-del';
    del.textContent = '×';
    del.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeEntry(entry);
    });
    row.appendChild(del);
    row.addEventListener('click', () => selectObject(entry));
    listEl.appendChild(row);
  }
}

// ---------------------------------------------------------------------
// Save / load
// ---------------------------------------------------------------------

function round(n, d = 4) {
  const m = 10 ** d;
  return Math.round(n * m) / m;
}

function exportLayout() {
  return {
    tileSize: 1,
    board: { key: 'duel', rows: gridH, cols: gridW },
    // GLB-backed types embed their model bytes here so the file is
    // self-contained — Load JSON works without the original .glb.
    customTypes: exportCustomTypes(placed),
    // Manual tile-colour overrides only — the real starting ownership
    // (seedOwners()) is derived fresh from map.js on every load, not saved.
    tiles: [...tiles.values()]
      .filter((t) => t.ownerOverride !== null)
      .map((t) => ({ x: t.x, z: t.z, owner: t.ownerOverride })),
    objects: placed.map((entry) => {
      const originX = tileWorldX(entry.tileX);
      const originZ = tileWorldZ(entry.tileZ);
      return {
        id: entry.id,
        type: entry.type,
        tileX: entry.tileX,
        tileZ: entry.tileZ,
        position: {
          x: round(entry.root.position.x - originX),
          y: round(entry.root.position.y),
          z: round(entry.root.position.z - originZ),
        },
        rotationY: round((entry.root.rotation.y * 180) / Math.PI, 1),
        scale: round(entry.root.scale.x),
      };
    }),
  };
}

// For "Export as STRUCTURE_KIT entry": the currently-selected object's
// tile-relative transform, in the exact shape docs/MAP_SYSTEM.md's
// `STRUCTURE_KIT[kind].model` field expects — pastes straight into
// public/map.js once you've settled on a placement. Only meaningful for a
// single GLB-backed prop; scale/rotationY come straight off the object,
// same numbers exportLayout() would save.
function exportStructureKitEntry() {
  if (!selected) return null;
  const def = OBJECT_TYPES[selected.type];
  if (!def?.isGLB) return null;
  return {
    file: `models/${selected.type.replace(/^glb-\d+-/, '')}.glb`,
    scale: round(selected.root.scale.x),
    rotationY: round((selected.root.rotation.y * 180) / Math.PI, 1),
  };
}

document.getElementById('board-save-btn').addEventListener('click', () => {
  const data = JSON.stringify(exportLayout(), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'board-layout.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

document.getElementById('board-export-kit-btn').addEventListener('click', async () => {
  const entry = exportStructureKitEntry();
  const btn = document.getElementById('board-export-kit-btn');
  if (!entry) {
    btn.textContent = 'Select a placed .glb prop first';
    setTimeout(() => (btn.textContent = 'Export as STRUCTURE_KIT entry'), 1800);
    return;
  }
  const snippet = `model: ${JSON.stringify(entry, null, 2).replace(/\n/g, '\n  ')}`;
  try {
    await navigator.clipboard.writeText(snippet);
    btn.textContent = 'Copied — paste into STRUCTURE_KIT in map.js';
  } catch {
    prompt('Copy this into the matching STRUCTURE_KIT entry in public/map.js:', snippet);
    btn.textContent = 'Export as STRUCTURE_KIT entry';
    return;
  }
  setTimeout(() => (btn.textContent = 'Export as STRUCTURE_KIT entry'), 2200);
});

document.getElementById('board-load-btn').addEventListener('click', () => {
  document.getElementById('board-load-input').click();
});

// Shared by the file-picker input below and by the app-wide drag-and-drop
// handler in tabs.js, so both paths load a layout the same way. Async
// because embedded GLB types need to be re-parsed before anything that
// references them can spawn.
export async function loadBoardData(data) {
  clearObjects();
  buildBoard();
  await importCustomTypes(data.customTypes);

  for (const t of data.tiles || []) {
    const tile = tiles.get(`${t.x}_${t.z}`);
    if (tile && !tile.isWater && tileMaterials[t.owner]) setTileOwner(tile, t.owner);
  }
  for (const obj of data.objects || []) {
    const tile = tiles.get(`${obj.tileX}_${obj.tileZ}`);
    if (!tile || !OBJECT_TYPES[obj.type]) continue;
    spawn(obj.type, tile, obj);
  }
}

document.getElementById('board-load-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    alert('That file is not valid JSON.');
    return;
  }
  await loadBoardData(data);
  e.target.value = '';
});

document.getElementById('board-clear-btn').addEventListener('click', () => {
  if (placed.length && !confirm('Clear all placed objects?')) return;
  clearObjects();
});

// ---------------------------------------------------------------------
// Resize + render loop
// ---------------------------------------------------------------------

function resize() {
  const el = document.getElementById('board-viewport');
  const w = el.clientWidth,
    h = el.clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', resize);

let isRunning = false; // starts hidden until tabs.js activates this tab
function animate() {
  if (!isRunning) return;
  requestAnimationFrame(animate);
  orbit.update();
  renderer.render(scene, camera);
}

export function setActive(active) {
  const wasRunning = isRunning;
  isRunning = active;
  if (active) {
    resize();
    if (!wasRunning) animate();
  }
}

buildBoard();
updatePanelFromSelection();
