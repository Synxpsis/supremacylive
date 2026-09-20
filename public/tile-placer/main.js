// main.js — Tile Placer
//
// An editor for arranging 3D props onto a single 1x1 "tile" (the unit
// square you see on the ground), then exporting each object's position
// and scale AS FRACTIONS OF THE TILE. Because the numbers are relative
// to the tile (not to pixels or camera distance), your game can drop
// them onto a tile of any size — at any zoom or orbit angle — and the
// prop will land in the same spot on the tile at the same relative size.
//
// ---------------------------------------------------------------------
// JSON format (see exportLayout()):
//
//   {
//     "tileSize": 1,
//     "objects": [
//       {
//         "id": "barrier-1",
//         "type": "barrier",
//         "position": { "x": 0.1, "y": 0, "z": -0.2 },
//         "rotationY": 45,
//         "scale": 0.3
//       }
//     ]
//   }
//
// position.x / position.z: fraction of the tile's width/depth, measured
//   from the tile CENTER (so -0.5 = left/near edge, 0.5 = right/far edge).
// position.y: height above the tile surface, in the same tile-relative
//   units (0 = sitting on the tile).
// rotationY: yaw in degrees, world-up rotation.
// scale: uniform scale multiplier, also tile-relative.
//
// To place this in-game on a tile whose real size is S (in your world
// units) with its center at worldOrigin:
//
//   worldPos.x = worldOrigin.x + obj.position.x * S
//   worldPos.y = worldOrigin.y + obj.position.y * S
//   worldPos.z = worldOrigin.z + obj.position.z * S
//   mesh.rotation.y = obj.rotationY * Math.PI / 180
//   mesh.scale.setScalar(obj.scale * S)
//
// That's it — camera zoom/orbit never enters the math, so placement and
// size stay correct no matter how the player views the map.
// ---------------------------------------------------------------------

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OBJECT_TYPES, onObjectTypeRegistered } from './objects.js';
import { makeGridTexture } from './gridTexture.js';
import { exportCustomTypes, importCustomTypes } from './glb.js';
import { createGizmo, makeRemover, trackClicks, computeNDC } from './selection.js';

// ---------------------------------------------------------------------
// Scene / renderer / camera
// ---------------------------------------------------------------------

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef0ee);

const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
camera.position.set(1.6, 1.4, 1.8);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.getElementById('viewport').appendChild(renderer.domElement);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 0.15, 0);
orbit.enableDamping = true;
orbit.minDistance = 0.5;
orbit.maxDistance = 15;
orbit.maxPolarAngle = Math.PI * 0.49;
orbit.update();

scene.add(new THREE.HemisphereLight(0xffffff, 0x74705f, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(3, 5, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -3;
key.shadow.camera.right = 3;
key.shadow.camera.top = 3;
key.shadow.camera.bottom = -3;
key.shadow.bias = -0.0015;
scene.add(key);
const fill = new THREE.DirectionalLight(0xdfe8ee, 0.6);
fill.position.set(-3, 2, 2);
scene.add(fill);

// ---------------------------------------------------------------------
// The tile — a 1x1 unit square. Every saved position/scale is relative
// to this square, which is why it's built at exactly size 1.
// ---------------------------------------------------------------------

const tileMat = new THREE.MeshStandardMaterial({ map: makeGridTexture('#d8dcd3'), roughness: 0.9 });
const tile = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), tileMat);
tile.rotation.x = -Math.PI / 2;
tile.receiveShadow = true;
scene.add(tile);

// backdrop ground so the tile reads clearly against something
const backdrop = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.MeshStandardMaterial({ color: 0xf3f4f1, roughness: 1 })
);
backdrop.rotation.x = -Math.PI / 2;
backdrop.position.y = -0.003;
backdrop.receiveShadow = true;
scene.add(backdrop);

// ---------------------------------------------------------------------
// Placed objects
// ---------------------------------------------------------------------

const placed = []; // { id, type, root: THREE.Group }
let nextId = 1;
let selected = null;

const objectsLayer = new THREE.Group();
scene.add(objectsLayer);

function spawn(type, state = null) {
  const def = OBJECT_TYPES[type];
  if (!def) return null;
  const root = def.create();
  root.userData.placeable = true;
  root.userData.type = type;

  const id = state?.id || `${type}-${nextId++}`;
  root.userData.id = id;

  if (state) {
    root.position.set(state.position.x, state.position.y, state.position.z);
    root.rotation.y = (state.rotationY * Math.PI) / 180;
    root.scale.setScalar(state.scale);
  } else {
    root.position.set(0, 0, 0);
    root.scale.setScalar(def.defaultScale);
  }

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  objectsLayer.add(root);
  const entry = { id, type, root };
  placed.push(entry);
  refreshObjectList();
  return entry;
}

// ---------------------------------------------------------------------
// Selection + gizmo
// ---------------------------------------------------------------------

const gizmo = createGizmo(camera, renderer.domElement, scene, orbit, () => updatePanelFromSelection());

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

const { removeEntry, clearAll } = makeRemover({
  placed, objectsLayer, getSelected: () => selected, selectObject, refreshObjectList,
});

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

trackClicks(renderer.domElement, gizmo, (e) => {
  computeNDC(e, renderer.domElement, ndc);
  raycaster.setFromCamera(ndc, camera);

  const meshes = [];
  for (const entry of placed) {
    entry.root.traverse((o) => {
      if (o.isMesh) meshes.push(o);
    });
  }
  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length === 0) {
    selectObject(null);
    return;
  }
  let obj = hits[0].object;
  while (obj && !obj.userData.placeable) obj = obj.parent;
  const entry = placed.find((p) => p.root === obj);
  selectObject(entry || null);
});

// ---------------------------------------------------------------------
// Sidebar UI
// ---------------------------------------------------------------------

const paletteEl = document.getElementById('palette');
function addPaletteButton(type, def) {
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = `+ ${def.label}`;
  btn.addEventListener('click', () => {
    const entry = spawn(type);
    selectObject(entry);
  });
  paletteEl.appendChild(btn);
}
for (const [type, def] of Object.entries(OBJECT_TYPES)) addPaletteButton(type, def);
// A .glb dropped anywhere registers a new type at runtime — pick that up
// live instead of only building the palette once at load.
onObjectTypeRegistered((type, def) => addPaletteButton(type, def));

// Called by tabs.js right after registering a dropped .glb, so it
// appears on the tile immediately instead of waiting for a click.
export function spawnType(type) {
  const entry = spawn(type);
  selectObject(entry);
  return entry;
}

const panel = document.getElementById('panel');
const fieldX = document.getElementById('field-x');
const fieldY = document.getElementById('field-y');
const fieldZ = document.getElementById('field-z');
const fieldRot = document.getElementById('field-rot');
const fieldScale = document.getElementById('field-scale');
const selLabel = document.getElementById('sel-label');
const deleteBtn = document.getElementById('delete-btn');
const modeButtons = document.querySelectorAll('[data-mode]');

function updatePanelFromSelection() {
  if (!selected) {
    panel.classList.add('disabled');
    selLabel.textContent = 'Nothing selected';
    return;
  }
  panel.classList.remove('disabled');
  const def = OBJECT_TYPES[selected.type];
  selLabel.textContent = `${def.label}  ·  ${selected.id}`;
  fieldX.value = selected.root.position.x.toFixed(3);
  fieldY.value = selected.root.position.y.toFixed(3);
  fieldZ.value = selected.root.position.z.toFixed(3);
  fieldRot.value = ((selected.root.rotation.y * 180) / Math.PI).toFixed(1);
  fieldScale.value = selected.root.scale.x.toFixed(3);
}

function applyFieldsToSelection() {
  if (!selected) return;
  selected.root.position.set(
    parseFloat(fieldX.value) || 0,
    parseFloat(fieldY.value) || 0,
    parseFloat(fieldZ.value) || 0
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

const listEl = document.getElementById('object-list');
function refreshObjectList() {
  listEl.innerHTML = '';
  for (const entry of placed) {
    const row = document.createElement('div');
    row.className = 'list-row' + (entry === selected ? ' active' : '');
    const label = document.createElement('span');
    label.textContent = `${OBJECT_TYPES[entry.type].label} — ${entry.id}`;
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

function exportLayout() {
  return {
    tileSize: 1,
    // GLB-backed types embed their model bytes here so the file is
    // self-contained — Load JSON works without the original .glb.
    customTypes: exportCustomTypes(placed),
    objects: placed.map((entry) => ({
      id: entry.id,
      type: entry.type,
      position: {
        x: round(entry.root.position.x),
        y: round(entry.root.position.y),
        z: round(entry.root.position.z),
      },
      rotationY: round((entry.root.rotation.y * 180) / Math.PI, 1),
      scale: round(entry.root.scale.x),
    })),
  };
}

function round(n, d = 4) {
  const m = 10 ** d;
  return Math.round(n * m) / m;
}

// Used by board.js's "Place Tile Editor layout" button — hands over the
// current arrangement (which may be several objects) so it can be
// stamped onto a board tile at the same tile-relative transforms.
// Deliberately no `id` field, so each stamp gets a fresh one.
export function getLayoutObjects() {
  return placed.map((entry) => ({
    type: entry.type,
    position: {
      x: round(entry.root.position.x),
      y: round(entry.root.position.y),
      z: round(entry.root.position.z),
    },
    rotationY: round((entry.root.rotation.y * 180) / Math.PI, 1),
    scale: round(entry.root.scale.x),
  }));
}

document.getElementById('save-btn').addEventListener('click', () => {
  const data = JSON.stringify(exportLayout(), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tile-layout.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// Shared by the file-picker input below and by the app-wide drag-and-drop
// handler in tabs.js, so both paths load a layout the same way. Async
// because embedded GLB types need to be re-parsed before anything that
// references them can spawn.
export async function loadTileData(data) {
  clearAll();
  await importCustomTypes(data.customTypes);
  for (const obj of data.objects || []) {
    if (!OBJECT_TYPES[obj.type]) continue;
    spawn(obj.type, obj);
  }
}

document.getElementById('load-input').addEventListener('change', async (e) => {
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
  // otherwise be caught until loadTileData() reads data.customTypes below.
  if (!data || typeof data !== 'object') {
    alert('That file is not valid JSON.');
    return;
  }
  await loadTileData(data);
  e.target.value = '';
});

document.getElementById('clear-btn').addEventListener('click', () => {
  if (placed.length && !confirm('Clear all placed objects?')) return;
  clearAll();
});

document.getElementById('load-btn').addEventListener('click', () => {
  document.getElementById('load-input').click();
});

// ---------------------------------------------------------------------
// Resize + render loop
//
// setActive() is called by tabs.js when this tab is shown/hidden, so the
// renderer isn't doing pointless work while the Board Simulation tab is
// the one on screen — and so sizing gets recomputed once this tab's
// container actually has real dimensions again.
// ---------------------------------------------------------------------

function resize() {
  const el = document.getElementById('viewport');
  const w = el.clientWidth,
    h = el.clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', resize);
resize();

let isRunning = true;
function animate() {
  if (!isRunning) return;
  requestAnimationFrame(animate);
  orbit.update();
  renderer.render(scene, camera);
}
animate();

export function setActive(active) {
  const wasRunning = isRunning;
  isRunning = active;
  if (active) {
    resize();
    if (!wasRunning) animate();
  }
}

updatePanelFromSelection();
