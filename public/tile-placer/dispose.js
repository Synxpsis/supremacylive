// dispose.js — frees GPU-side resources before an Object3D subtree (or a
// group's children) is dropped from the scene. Both the Tile View and
// Board View apps place/remove objects continuously while tuning a
// layout, and board.js rebuilds its whole tile grid on every "Reset
// board" click — without this, every removal/rebuild leaks whatever
// geometry, material, and texture memory that content held. The built-in
// "Road Barrier" type is the worst case: ~40 fresh geometries/materials
// plus four freshly-painted CanvasTextures per spawn, none of them shared.

/** Disposes every mesh's geometry, material(s), and any texture a material
 *  references, for `root` and everything under it. Use for a subtree whose
 *  materials are NOT shared with anything still on screen — a placed prop
 *  (def.create() builds fresh resources, or clones a template that isn't
 *  itself in the scene) or a rebuilt landmark marker. */
export function disposeSubtree(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry?.dispose();
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of materials) {
      if (!m) continue;
      for (const key of Object.keys(m)) {
        const v = m[key];
        if (v && v.isTexture) v.dispose();
      }
      m.dispose();
    }
  });
}

/** Disposes only each direct child's own geometry, never its material — for
 *  a group whose meshes share cached materials still in use elsewhere (the
 *  board's per-tile PlaneGeometry meshes, which all share one of a handful
 *  of cached tileMaterials/waterMaterial; disposing those would break every
 *  tile still using them, not just the ones being rebuilt). */
export function disposeGeometryOnly(group) {
  for (const child of group.children) child.geometry?.dispose();
}
