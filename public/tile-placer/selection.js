// selection.js — the gizmo wiring, click-vs-drag detection, and object
// removal/clear plumbing shared identically between the Tile View
// (main.js) and Board View (board.js) apps. spawn()/panel-sync/export
// stay in each file since those genuinely differ (board.js's is
// tile-relative — every position is stored relative to the active
// tile's origin — main.js's isn't), rather than being forced together.

import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { disposeSubtree } from './dispose.js';

/** Builds and wires a TransformControls gizmo the same way both apps do:
 *  dragging disables orbit so the two controls don't fight over the same
 *  drag gesture, and an objectChange re-syncs the side panel fields. */
export function createGizmo(camera, domElement, scene, orbit, onObjectChange) {
  const gizmo = new TransformControls(camera, domElement);
  gizmo.setMode('translate');
  gizmo.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; });
  gizmo.addEventListener('objectChange', () => onObjectChange());
  scene.add(gizmo.getHelper ? gizmo.getHelper() : gizmo);
  return gizmo;
}

/** Removes `entry` from `placed`, detaches its root from `objectsLayer`,
 *  and disposes its GPU resources — the exact removeEntry() both apps had
 *  a byte-identical (leaking, pre-dispose()) copy of. `clearAll()` (also
 *  returned) just repeats it for every entry, same as each app's own
 *  clearAll()/clearObjects() did. */
export function makeRemover({ placed, objectsLayer, getSelected, selectObject, refreshObjectList }) {
  function removeEntry(entry) {
    if (getSelected() === entry) selectObject(null);
    objectsLayer.remove(entry.root);
    disposeSubtree(entry.root);
    const i = placed.indexOf(entry);
    if (i >= 0) placed.splice(i, 1);
    refreshObjectList();
  }
  function clearAll() {
    for (const entry of [...placed]) removeEntry(entry);
  }
  return { removeEntry, clearAll };
}

/** Tracks pointerdown → pointerup on `domElement` and calls `onClick(e)`
 *  only for a genuine click — not a drag/orbit gesture (the `moved > 4`
 *  px threshold both apps used identically) and not a gizmo drag. A
 *  caller does its own raycasting from there, since what a click resolves
 *  to (an object, then possibly a tile) differs per app. */
export function trackClicks(domElement, gizmo, onClick) {
  let downPos = null;
  domElement.addEventListener('pointerdown', (e) => {
    downPos = { x: e.clientX, y: e.clientY };
  });
  domElement.addEventListener('pointerup', (e) => {
    if (!downPos) return;
    const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    downPos = null;
    if (moved > 4) return; // was a drag/orbit, not a click
    if (gizmo.dragging) return;
    onClick(e);
  });
}

/** Screen px (event clientX/Y) → normalized device coordinates for
 *  raycaster.setFromCamera(), written into `out` (a THREE.Vector2) — the
 *  identical conversion both apps' click handlers did inline. Named
 *  computeNDC rather than pointerNDC so it doesn't collide with either
 *  file's own `const pointerNDC = new THREE.Vector2()` scratch vector. */
export function computeNDC(e, domElement, out) {
  const rect = domElement.getBoundingClientRect();
  out.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  out.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  return out;
}
