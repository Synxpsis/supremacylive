// glb.js — load a dropped .glb/.gltf file, normalize it to the same
// convention every other prop in this app uses (centered on X/Z,
// sitting on the ground at Y=0, sized relative to a 1x1 tile), and
// register it as a new placeable type.
//
// The raw file bytes are kept on the registered type as a base64 data
// URL so saved layouts can embed the model and reload it later without
// needing the original .glb file again — see main.js/board.js's
// exportLayout()/loadTileData()/loadBoardData().

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJECT_TYPES, registerObjectType } from './objects.js';

const loader = new GLTFLoader();
let nextGlbId = 1;

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function parseGLTF(arrayBuffer) {
  return new Promise((resolve, reject) => {
    loader.parse(arrayBuffer, '', (gltf) => resolve(gltf), (err) => reject(err));
  });
}

// Re-centers X/Z on the model's own bounding box and drops it so its
// lowest point sits at Y=0 — matching every built-in prop's convention
// (feet/base at the origin), so gizmo moves and tile-relative save data
// behave the same regardless of object type.
function normalize(rawScene) {
  const box = new THREE.Box3().setFromObject(rawScene);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  rawScene.position.x -= center.x;
  rawScene.position.z -= center.z;
  rawScene.position.y -= box.min.y;

  const wrapper = new THREE.Group();
  wrapper.add(rawScene);
  return { wrapper, size };
}

// Builds a registry entry ({ label, create, defaultScale, isGLB,
// glbBase64 }) from raw .glb bytes. `create()` returns a fresh clone
// each time so multiple placed instances don't share a transform.
export async function makeGLBObjectType(arrayBuffer, fileName) {
  const gltf = await parseGLTF(arrayBuffer.slice(0));
  const { wrapper: template, size } = normalize(gltf.scene);

  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  // sized so the model's largest dimension fills ~90% of a 1x1 tile
  const defaultScale = 0.9 / maxDim;

  const label = fileName.replace(/\.(glb|gltf)$/i, '').slice(0, 40) || `Model ${nextGlbId}`;
  const key = `glb-${nextGlbId++}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return {
    key,
    def: {
      label,
      isGLB: true,
      glbBase64: arrayBufferToBase64(arrayBuffer),
      defaultScale,
      create: () => template.clone(true),
    },
  };
}

// Parses + registers a dropped .glb's bytes as a new placeable type in
// one step. Returns the registry key (already usable with spawn()).
export async function registerGLBFile(arrayBuffer, fileName) {
  const { key, def } = await makeGLBObjectType(arrayBuffer, fileName);
  return registerObjectType(key, def);
}

// For exportLayout(): given the list of currently-placed entries, pull
// out just the GLB-backed types actually in use, with their bytes, so
// the saved JSON is fully self-contained — reloading it doesn't need
// the original .glb file again.
export function exportCustomTypes(placedEntries) {
  const seen = new Set();
  const out = [];
  for (const entry of placedEntries) {
    const def = OBJECT_TYPES[entry.type];
    if (!def?.isGLB || seen.has(entry.type)) continue;
    seen.add(entry.type);
    out.push({
      key: entry.type,
      label: def.label,
      defaultScale: def.defaultScale,
      glbBase64: def.glbBase64,
    });
  }
  return out;
}

// For loadTileData()/loadBoardData(): re-registers any GLB types a
// saved layout embedded, skipping ones already present (e.g. reloading
// the same file twice in one session).
export async function importCustomTypes(customTypes = []) {
  for (const c of customTypes) {
    if (OBJECT_TYPES[c.key]) continue;
    const buffer = base64ToArrayBuffer(c.glbBase64);
    const gltf = await parseGLTF(buffer.slice(0));
    const { wrapper: template } = normalize(gltf.scene);
    registerObjectType(c.key, {
      label: c.label,
      isGLB: true,
      glbBase64: c.glbBase64,
      defaultScale: c.defaultScale,
      create: () => template.clone(true),
    });
  }
}
