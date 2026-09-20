// model-normalize.js — shared by board-render-3d.js and tile-placer/glb.js
// so a loaded .glb's "sit at the game's convention" transform is computed
// in exactly one place, not hand-copied into two. Both consumers place a
// model the same way: centered on X/Z, resting on the ground at Y=0
// (feet/base at the origin) — a scale hand-tuned in the tile-placer tool
// for this convention transfers directly to STRUCTURE_KIT's `model.scale`
// (see docs/MAP_SYSTEM.md) with no re-derivation, which only holds if this
// math can't drift between the two call sites the way two independently
// hand-copied versions eventually would.
import * as THREE from 'three';

/** Re-centers a loaded glTF scene's root on X/Z and drops it so its lowest
 *  point sits at Y=0, wrapped in a THREE.Group so the original scene's own
 *  transform stays untouched by whatever the caller does to the wrapper
 *  (scale, rotation, position) afterward. Returns { wrapper, size } — size
 *  is the model's own bounding-box extent before normalization, for a
 *  caller that sizes a default scale off it (tile-placer/glb.js); a caller
 *  that doesn't need it (board-render-3d.js) just destructures { wrapper }. */
export function normalizeModel(rawScene) {
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
