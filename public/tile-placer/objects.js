// objects.js
//
// Registry of placeable 3D object types. Add more built-in props here —
// each one just needs a `create()` factory that returns a THREE.Group,
// plus a sensible `defaultScale` so it roughly fits a 1x1 tile when
// first spawned.
//
// The registry is mutable: dropping a .glb file onto the app (see
// glb.js) registers a new entry here at runtime, the same shape as a
// built-in one, so both tabs' palettes and the gizmo/save/load code
// treat it identically.

import { createBarrier } from './barrier.js';

export const OBJECT_TYPES = {
  barrier: {
    label: 'Road Barrier',
    create: () => createBarrier({ seed: Math.floor(Math.random() * 1000) }),
    // barrier is ~3.4 units wide by default — this scale brings it down
    // to roughly fill a 1x1 tile.
    defaultScale: 0.28,
  },

  // Example of how to add another built-in prop later:
  // import { createCrate } from './crate.js';
  // crate: {
  //   label: 'Crate',
  //   create: () => createCrate(),
  //   defaultScale: 1,
  // },
};

const listeners = new Set();

// main.js / board.js call this once to be told whenever a new type
// (built-in or a dropped .glb) is registered, so they can add a palette
// button for it without polling.
export function onObjectTypeRegistered(fn) {
  listeners.add(fn);
}

export function registerObjectType(key, def) {
  OBJECT_TYPES[key] = def;
  for (const fn of listeners) fn(key, def);
  return key;
}
