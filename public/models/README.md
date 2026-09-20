# Structure models

Checked-in `.glb` files for real (non-procedural) structure rendering. Served directly by Workers
Assets like everything else under `public/` — no build step, no separate asset pipeline.

## Adding a model

1. Author and tune the model against a real tile in [`public/tile-placer.html`](../tile-placer.html)
   (Board View there loads the actual `duel` board geometry) until its position, rotation, and
   scale look right.
2. Drop the `.glb` file in this directory.
3. Add or edit the matching entry's `model` field in `STRUCTURE_KIT` (`public/map.js`):

   ```js
   capital: { fp: 0.66, h: 0.72, label: 'Capital', authorable: false,
              model: { file: 'models/capital.glb', scale: 1.0, rotationY: 0 } },
   ```

   `scale` is the tile-relative multiplier the placer tool settled on (1.0 ≈ fills a tile) — this
   is the number that makes the model's size permanent: it's hardcoded here, versioned in git, and
   never recomputed at runtime. `rotationY` (degrees, optional, default 0) covers a model authored
   facing the wrong way.
4. `public/board-render-3d.js` picks up any kind with a `model` entry automatically — no other code
   changes needed. A kind with no `model` entry keeps rendering as the procedural box, unchanged.

See [`docs/RENDERING.md`](../../docs/RENDERING.md) → Structures and
[`docs/MAP_SYSTEM.md`](../../docs/MAP_SYSTEM.md) → `STRUCTURE_KIT` for the full contract.
