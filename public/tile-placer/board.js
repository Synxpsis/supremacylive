// board.js — Board View, rendered against the REAL `duel` board (see
// docs/MAP_SYSTEM.md) instead of a generic hand-painted grid, so a prop's
// placement previews against the actual territory shapes and capitals/
// cities board-render-3d.js draws in a real match — not an approximation
// of them. Deliberately no visual distinction for road tiles: the real
// renderer doesn't draw one either (roads are pathfinding-only data, see
// docs/MECHANICS.md), and this tool's whole point is matching what a real
// match actually looks like. The active-tile label below still says
// "road" when relevant (real data, just not rendered) since knowing that
// while placing a prop is still useful.
//
// Static `FPMap.MAPS.duel` only, not the live D1-backed copy — this is a
// local dev-only page with no session, so it can't call the authenticated
// GET /api/maps/duel the way editor.html does (see tile-placer.html).
//
// Each tile is still exactly 1x1 and objects still save position/scale as
// fractions of it, same convention as Tile View — this view just adds
// *which* absolute board tile (tileX/tileZ = the real board's own c/r) each
// object sits on. See exportLayout() below for the exact JSON shape.
//
// 2026-09-21: the ground/territory/city rendering below is built directly
// against board-render-3d.js's exposed scene/camera/controls (the same
// pattern editor.html's own grow handles already use — see
// docs/RENDERING.md and docs/EDITOR_UPGRADE.md) instead of a second,
// hand-rolled copy of land/water/territory-line/city-marker drawing. This
// module owns nothing in board-render-3d.js itself and changes no behaviour
// for its other two callers (editor.html, game.html). What's genuinely kept
// local to this tool rather than shared: the PBR lighting (board-render-
// 3d.js uses flat, minimal gameplay lighting; this tool's whole job is
// judging how a .glb's real materials look, which needs richer lighting
// than in-match flatness provides), the manual per-tile colour override (a
// debug aid with no equivalent in the real game — see setTileOwner()'s own
// comment for the one real behaviour difference this causes), and
// everything below "Placed objects" (object placement, gizmo, save/load,
// export) — this tool's actual reason to exist, orthogonal to how the
// ground under it gets drawn.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { create } from '../board-render-3d.js';
import { OBJECT_TYPES, onObjectTypeRegistered } from './objects.js';
import { getLayoutObjects } from './main.js';
import { exportCustomTypes, importCustomTypes } from './glb.js';
import { createGizmo, makeRemover, trackClicks, computeNDC } from './selection.js';

// Set by the classic <script src="../map.js"> tag in tile-placer.html —
// same self.FPMap access pattern board-render-3d.js already uses, and safe
// for the same reason: a <script type="module"> always runs after every
// classic script on the page, regardless of source order.
const F = self.FPMap;
const M = F.build(F.MAPS.duel);
const { gridW, gridH } = M;

// board-render-3d.js's own tile-space convention: tile (c, r)'s centre
// sits at world (c + 0.5, 0, r + 0.5), y = 0 is the land surface — replaces
// this file's old centred-on-origin convention everywhere below. Every
// object position this tool saves is relative to a tile's origin (see
// exportLayout()), so switching conventions doesn't change the saved JSON
// shape at all, only where "relative to" actually points in world space.
function tileWorldX(c) { return c + 0.5; }
function tileWorldZ(r) { return r + 0.5; }

// ---------------------------------------------------------------------
// The shared 3D renderer, and everything built directly against its scene
// — deferred until this tab is first shown (see ensure3D() below), not
// built at module load. #board-tab starts `display: none` (see
// tile-placer.html), so a canvas created here would read a 0×0
// clientWidth/Height at create() time; editor.html's own ensure3D() exists
// for the same reason (S.built not ready yet there; a hidden tab here).
// ---------------------------------------------------------------------

let r3d = null;
let highlight = null;
let objectsLayer = null;
let gizmo = null;
let raycaster = null;
let ndc = null;
let removeEntry = null;
let clearObjects = null;

function ensure3D() {
  if (r3d) return;

  const viewportEl = document.getElementById('board-viewport');
  const canvas = document.createElement('canvas');
  // board-render-3d.js's own resize() calls renderer.setSize(w, h, false) —
  // the trailing `false` skips setting the canvas's CSS size, since its
  // other two callers (editor.html/game.html) already size their <canvas>
  // via CSS. This one is created at runtime with no such rule, so it's set
  // directly.
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  viewportEl.appendChild(canvas);

  // selectionLock: false — this tool never calls update() with a truthy
  // `sel`/`armed` (it has no concept of "the currently selected game
  // piece," only its own placed props, selected via a separate raycast
  // below), so the lock would never actually engage either way; passed
  // explicitly to match editor.html/game.html's own reasoning rather than
  // relying on the default.
  r3d = create(canvas, M, { selectionLock: false });

  // Strip the shared renderer's flat gameplay lighting (a plain ambient
  // light plus one directional "sun," matching what a player sees
  // mid-match — see board-render-3d.js's own lighting comment) and replace
  // it with PBR image-based lighting instead — see this file's header
  // comment for why that stays this tool's own rather than shared.
  for (const child of [...r3d.scene.children]) {
    if (child.isLight) r3d.scene.remove(child);
  }
  r3d.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  r3d.renderer.outputColorSpace = THREE.SRGBColorSpace;
  r3d.renderer.toneMappingExposure = 1.0;
  const pmrem = new THREE.PMREMGenerator(r3d.renderer);
  r3d.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  r3d.scene.add(new THREE.HemisphereLight(0x9fb2c8, 0x1a1a16, 0.55));
  const sunKey = new THREE.DirectionalLight(0xffffff, 2.0);
  sunKey.position.set(gridW * 0.4, Math.max(gridW, gridH) * 0.9, -gridH * 0.3);
  sunKey.castShadow = true;
  sunKey.shadow.mapSize.set(2048, 2048);
  sunKey.shadow.bias = -0.0015;
  const shadowSpan = Math.max(gridW, gridH) / 2 + 2;
  sunKey.shadow.camera.left = -shadowSpan;
  sunKey.shadow.camera.right = shadowSpan;
  sunKey.shadow.camera.top = shadowSpan;
  sunKey.shadow.camera.bottom = -shadowSpan;
  sunKey.shadow.camera.far = 60;
  sunKey.shadow.camera.updateProjectionMatrix();
  r3d.scene.add(sunKey);
  const fill = new THREE.DirectionalLight(0x7fa0c0, 0.5);
  fill.position.set(-6, 4, -4);
  r3d.scene.add(fill);

  const highlightMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  highlight = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), highlightMat);
  highlight.rotation.x = -Math.PI / 2;
  highlight.position.y = 0.006;
  highlight.visible = false;
  r3d.scene.add(highlight);

  objectsLayer = new THREE.Group();
  r3d.scene.add(objectsLayer);

  // Built lazily too (not at module scope) — objectsLayer doesn't exist
  // until just above, and makeRemover() closes over whatever value it's
  // handed at call time, not a live reference to the outer variable.
  ({ removeEntry, clearAll: clearObjects } = makeRemover({
    placed, objectsLayer, getSelected: () => selected, selectObject, refreshObjectList,
  }));

  gizmo = createGizmo(r3d.camera, r3d.renderer.domElement, r3d.scene, r3d.controls, () => updatePanelFromSelection());

  raycaster = new THREE.Raycaster();
  ndc = new THREE.Vector2();

  trackClicks(r3d.renderer.domElement, gizmo, (e) => {
    computeNDC(e, r3d.renderer.domElement, ndc);
    raycaster.setFromCamera(ndc, r3d.camera);

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

    const rect = r3d.renderer.domElement.getBoundingClientRect();
    const t = r3d.tileAtAny(e.clientX - rect.left, e.clientY - rect.top);
    if (t) {
      selectObject(null);
      setActiveTile({ x: t.c, z: t.r, isWater: !F.territoryAt(M, t.c, t.r) });
      return;
    }

    selectObject(null);
  });

  buildBoard();
}

// ---------------------------------------------------------------------
// Ownership — merges the board's real starting owners (seedOwners(), same
// as a real match's kickoff) with this tool's own manual per-tile colour
// overrides, then hands the result to r3d.update() so land colour, the
// territory-border colour, and city/capital piece colour all read from one
// source of truth instead of a second hand-maintained copy.
//
// One real behaviour difference from the old hand-rolled renderer: an
// override on a single tile *inside an already-owned territory* (verrand/
// dunmar) won't visibly change anything, because board-render-3d.js colours
// a whole territory from its centre tile's owner once that territory is
// owned at all (territoryOwner() — see docs/GLOSSARY.md), the same as a
// real match. Overriding the centre tile itself (or checking "paint whole
// territory" below, which does exactly that) still recolours the whole
// territory; a single non-centre override only shows on a currently-
// neutral territory (kolstig/aumere). Arguably more correct for a tool
// whose job is previewing against *real* geometry, not an idealized one —
// flagged here since it's a visible change from before.
// ---------------------------------------------------------------------

const OWNER_TO_SEAT = { blue: 0, red: 1, neutral: null };
const SEAT_TO_OWNER = { 0: 'blue', 1: 'red' };

let startOwners = {}; // tileKey -> seat, from FPMap.seedOwners(M)
const overrides = {}; // tileKey -> ownerKey ('blue'/'red'/'neutral'), only for explicitly painted tiles

function tileOwnerKey(tile) {
  const tk = F.tileKey(tile.x, tile.z);
  if (tk in overrides) return overrides[tk];
  const seat = startOwners[tk];
  return seat === undefined || seat === null ? 'neutral' : SEAT_TO_OWNER[seat];
}

function refreshBoardVisual() {
  const owners = { ...startOwners };
  for (const [tk, ownerKey] of Object.entries(overrides)) owners[tk] = OWNER_TO_SEAT[ownerKey];
  r3d.update({ owners, cities: M.cities });
}

function setTileOwner(tile, ownerKey) {
  overrides[F.tileKey(tile.x, tile.z)] = ownerKey;
  refreshBoardVisual();
  updateColorButtons();
}

// ---------------------------------------------------------------------
// Camera framing — board-render-3d.js's own default (a fixed relative
// offset from the board's centre) is reasonable but tuned for a live
// match's HUD, not this tool's bare viewport; kept close to this file's
// previous framing instead, just re-centred on the new tile-space origin.
// ---------------------------------------------------------------------

function fitCameraToBoard() {
  const span = Math.max(gridW, gridH);
  const dist = span * 2.3 + 1.5;
  const cx = gridW / 2, cz = gridH / 2;
  r3d.camera.position.set(cx + dist * 0.62, dist * 0.6, cz + dist * 0.72);
  r3d.controls.target.set(cx, 0.15, cz);
  r3d.controls.update();
}

let activeTile = null; // { x, z, isWater } — where new objects spawn

function setActiveTile(tile) {
  activeTile = tile;
  if (tile) {
    highlight.position.set(tileWorldX(tile.x), 0.006, tileWorldZ(tile.z));
    highlight.visible = true;
    const kind = tile.isWater ? 'water' : `land, ${tileOwnerKey(tile)}${F.isRoad(M, tile.x, tile.z) ? ', road' : ''}`;
    activeTileLabel.textContent = `Active tile: (${tile.x}, ${tile.z}) — ${kind}`;
  } else {
    highlight.visible = false;
    activeTileLabel.textContent = 'Active tile: none — click a tile';
  }
  updateColorButtons();
}

function buildBoard() {
  startOwners = F.seedOwners(M);
  for (const k of Object.keys(overrides)) delete overrides[k];
  refreshBoardVisual();

  const boardInfo = document.getElementById('board-info');
  boardInfo.textContent = `${F.MAPS.duel.name || 'duel'} — ${gridW}×${gridH} tiles, ${M.provinces.length} territories, ${M.cities.length} cities`;

  const cx = Math.floor(gridW / 2), cz = Math.floor(gridH / 2);
  setActiveTile({ x: cx, z: cz, isWater: !F.territoryAt(M, cx, cz) });
  fitCameraToBoard();
}

// ---------------------------------------------------------------------
// Placed objects
// ---------------------------------------------------------------------

const placed = []; // { id, type, root, tileX, tileZ }
let nextId = 1;
let selected = null;

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

// ---------------------------------------------------------------------
// Selection + gizmo
// ---------------------------------------------------------------------

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
      for (const [c, r] of F.tilesOf(M, p)) setTileOwner({ x: c, z: r }, btn.dataset.owner);
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
    tiles: Object.entries(overrides).map(([tk, owner]) => {
      const [x, z] = tk.split(',').map(Number);
      return { x, z, owner };
    }),
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
// references them can spawn. tabs.js always shows this tab (activating
// this module, via ensure3D()) before calling this, so r3d is guaranteed
// to exist by the time this runs.
export async function loadBoardData(data) {
  ensure3D();
  clearObjects();
  buildBoard();
  await importCustomTypes(data.customTypes);

  for (const t of data.tiles || []) {
    const tile = { x: t.x, z: t.z, isWater: !F.territoryAt(M, t.x, t.z) };
    if (!tile.isWater && OWNER_TO_SEAT[t.owner] !== undefined) setTileOwner(tile, t.owner);
  }
  for (const obj of data.objects || []) {
    if (!OBJECT_TYPES[obj.type]) continue;
    spawn(obj.type, { x: obj.tileX, z: obj.tileZ }, obj);
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
  // Same guard as tabs.js's handleJSONDrop() — JSON.parse('null') succeeds
  // (data === null), so a valid-JSON-but-wrong-shape file wouldn't
  // otherwise be caught until loadBoardData() reads data.customTypes below.
  if (!data || typeof data !== 'object') {
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

window.addEventListener('resize', () => { if (isRunning && r3d) r3d.resize(); });

let isRunning = false; // starts hidden until tabs.js activates this tab
function animate() {
  if (!isRunning) return;
  requestAnimationFrame(animate);
  r3d.controls.update();
  r3d.renderer.render(r3d.scene, r3d.camera);
  r3d.cssRenderer.render(r3d.scene, r3d.camera);
}

export function setActive(active) {
  const wasRunning = isRunning;
  isRunning = active;
  if (active) {
    ensure3D();
    r3d.resize();
    if (!wasRunning) animate();
  }
}

updatePanelFromSelection();
