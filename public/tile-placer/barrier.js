// barrier.js
//
// Procedural 3D model of a military-style A-frame road barrier with
// caution stripes, carry handles and sandbags, built from Three.js
// geometry + canvas-generated textures (no external assets required).
//
// ES module usage:
//
//   import * as THREE from 'three';
//   import { createBarrier } from './barrier.js';
//
//   const barrier = createBarrier();
//   scene.add(barrier);
//
// createBarrier(options) returns a THREE.Group. Optional `options`:
//   { width, height, depth, seed }

import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const GREEN = '#727f5e';
const GREEN_DARK = '#495439';
const GREEN_LIGHT = '#98a37f';
const YELLOW = '#dcb62a';
const BLACK = '#1c1811';
const RUST = '#6b4a2c';
const SAND = '#c2ac83';
const SAND_DARK = '#93815f';
const METAL_DARK = '#242420';
const TIE_ROPE = '#4a4030';

// ---------------------------------------------------------------------------
// Small seeded PRNG so a given `seed` always produces the same weathering /
// sandbag lumps (nice for reproducible builds).
// ---------------------------------------------------------------------------

function makeRng(seed = 1) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ---------------------------------------------------------------------------
// Canvas texture helpers
// ---------------------------------------------------------------------------

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext('2d') };
}

function addGrime(ctx, w, h, rng, amount = 5500, maxAlpha = 0.10) {
  for (let i = 0; i < amount; i++) {
    const v = rng() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${(rng() * maxAlpha).toFixed(3)})`;
    const x = rng() * w;
    const y = rng() * h;
    const s = 1 + rng() * 2.5;
    ctx.fillRect(x, y, s, s);
  }
}

function addScratches(ctx, w, h, rng, count = 26) {
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const len = 10 + rng() * 60;
    const ang = rng() * Math.PI;
    ctx.strokeStyle = `rgba(230,230,220,${(0.05 + rng() * 0.12).toFixed(3)})`;
    ctx.lineWidth = 0.6 + rng() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
  ctx.restore();
}

function addRustStreaks(ctx, w, h, rng, count = 10) {
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = rng() * w;
    const y0 = rng() * h * 0.4;
    const len = 20 + rng() * h * 0.5;
    const grad = ctx.createLinearGradient(x, y0, x, y0 + len);
    grad.addColorStop(0, 'rgba(107,74,44,0.22)');
    grad.addColorStop(1, 'rgba(107,74,44,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - (2 + rng() * 3), y0, 4 + rng() * 6, len);
  }
  ctx.restore();
}

function drawBolt(ctx, x, y, r) {
  const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  grad.addColorStop(0, '#8a8a82');
  grad.addColorStop(0.6, METAL_DARK);
  grad.addColorStop(1, '#0e0e0c');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// Chamfered-rectangle ("octagon") recessed panel, matching the stamped
// panel look on the source barrier.
function drawOctPanel(ctx, x, y, w, h, chamfer) {
  const r = chamfer;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.lineTo(x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.lineTo(x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.lineTo(x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.closePath();

  ctx.fillStyle = GREEN_DARK;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  const br = Math.max(3, chamfer * 0.35);
  drawBolt(ctx, x + r * 0.7, y + r * 0.7, br);
  drawBolt(ctx, x + w - r * 0.7, y + r * 0.7, br);
  drawBolt(ctx, x + r * 0.7, y + h - r * 0.7, br);
  drawBolt(ctx, x + w - r * 0.7, y + h - r * 0.7, br);
}

function drawCautionStripes(ctx, x, y, w, h, stripeW = 22, clipPath = null) {
  ctx.save();
  ctx.beginPath();
  if (clipPath) {
    clipPath(ctx);
  } else {
    ctx.rect(x, y, w, h);
  }
  ctx.clip();
  ctx.fillStyle = BLACK;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = YELLOW;
  const diag = w + h;
  for (let off = -h; off < diag; off += stripeW * 2) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + off, y);
    ctx.lineTo(x + off + stripeW, y);
    ctx.lineTo(x + off + stripeW - h, y + h);
    ctx.lineTo(x + off - h, y + h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// Main front-panel texture: base coat, octagon insets, caution stripe
// bands (left/right, gap in the middle) and weathering.
function createPanelTexture(rng) {
  const W = 1536, H = 480;
  const { c, ctx } = canvas2d(W, H);

  ctx.fillStyle = GREEN;
  ctx.fillRect(0, 0, W, H);

  // soft vertical shading
  const shade = ctx.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, 'rgba(255,255,255,0.05)');
  shade.addColorStop(0.5, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  // top caution stripe band, gap in the middle (matches reference photo)
  const stripeH = H * 0.30;
  drawCautionStripes(ctx, W * 0.02, 10, W * 0.30, stripeH, 30);
  drawCautionStripes(ctx, W * 0.68, 10, W * 0.30, stripeH, 30);

  // center plain cap plate
  drawOctPanel(ctx, W * 0.36, 6, W * 0.28, stripeH + 4, 10);

  // lower octagon panel row (4 recessed panels)
  const rowY = H * 0.42;
  const rowH = H * 0.54;
  const gap = W * 0.015;
  const panelW = (W - gap * 5) / 4;
  for (let i = 0; i < 4; i++) {
    drawOctPanel(ctx, gap + i * (panelW + gap), rowY, panelW, rowH, 22);
  }

  // edge bolts along the top seam
  for (let i = 0; i < 14; i++) {
    drawBolt(ctx, (i + 0.5) * (W / 14), stripeH + 22, 5);
  }

  addRustStreaks(ctx, W, H, rng, 14);
  addScratches(ctx, W, H, rng, 40);
  addGrime(ctx, W, H, rng, 9000, 0.09);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Plain weathered green metal (legs, feet, back, corner caps).
function createMetalTexture(rng, { stripeCorner = false } = {}) {
  const W = 512, H = 512;
  const { c, ctx } = canvas2d(W, H);
  ctx.fillStyle = GREEN;
  ctx.fillRect(0, 0, W, H);
  const shade = ctx.createLinearGradient(0, 0, W, H);
  shade.addColorStop(0, 'rgba(255,255,255,0.06)');
  shade.addColorStop(1, 'rgba(0,0,0,0.14)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  if (stripeCorner) {
    // small diagonal caution badge in the bottom-outer corner, like the
    // triangular patch on the barrier's foot in the reference photo.
    drawCautionStripes(ctx, 0, 0, W, H, 16, (ctx2) => {
      ctx2.moveTo(W, H * 0.35);
      ctx2.lineTo(W, H);
      ctx2.lineTo(W * 0.45, H);
      ctx2.closePath();
    });
  }

  addRustStreaks(ctx, W, H, rng, 6);
  addScratches(ctx, W, H, rng, 22);
  addGrime(ctx, W, H, rng, 4000, 0.10);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createSandbagTexture(rng) {
  const W = 512, H = 512;
  const { c, ctx } = canvas2d(W, H);
  ctx.fillStyle = SAND;
  ctx.fillRect(0, 0, W, H);

  // woven burlap crosshatch
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 6) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += 6) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // fold shadows
  for (let i = 0; i < 10; i++) {
    const y = rng() * H;
    const grad = ctx.createLinearGradient(0, y - 14, 0, y + 14);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, `rgba(0,0,0,${0.10 + rng() * 0.12})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, y - 14, W, 28);
  }

  ctx.fillStyle = SAND_DARK;
  addGrime(ctx, W, H, rng, 5000, 0.08);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.5, 1.5);
  return tex;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

// Planar UV projection (XY) normalised to the geometry's own bounding box.
// Good enough for flat/near-flat extruded panels; side faces just inherit a
// stretched-but-unnoticeable projection of the same texture.
function planarUV(geometry) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const sx = bb.max.x - bb.min.x || 1;
  const sy = bb.max.y - bb.min.y || 1;
  const pos = geometry.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - bb.min.x) / sx;
    uv[i * 2 + 1] = (pos.getY(i) - bb.min.y) / sy;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function chamferedRectShape(w, h, chamfer) {
  const shape = new THREE.Shape();
  const hw = w / 2, hh = h / 2;
  shape.moveTo(-hw + chamfer, -hh);
  shape.lineTo(hw - chamfer, -hh);
  shape.lineTo(hw, -hh + chamfer);
  shape.lineTo(hw, hh - chamfer);
  shape.lineTo(hw - chamfer, hh);
  shape.lineTo(-hw + chamfer, hh);
  shape.lineTo(-hw, hh - chamfer);
  shape.lineTo(-hw, -hh + chamfer);
  shape.closePath();
  return shape;
}

function trapezoidShape(topW, bottomW, h) {
  const shape = new THREE.Shape();
  shape.moveTo(-bottomW / 2, 0);
  shape.lineTo(bottomW / 2, 0);
  shape.lineTo(topW / 2, h);
  shape.lineTo(-topW / 2, h);
  shape.closePath();
  return shape;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Lumpy, tied-off sandbag: an icosphere with per-vertex noise displacement
// (bulging burlap folds) plus a pinch near the X extremes so the ends read
// as a cinched/tied sack rather than a plain ball — matches the pillow-like
// bags stacked along the base of the reference barrier.
function makeSandbagGeometry(radius, rng) {
  // Random per-lump phase offsets (constant across the whole mesh, so
  // vertices that share a position on the sphere get identical
  // displacement — that's what keeps the surface smooth instead of
  // crystalline/spiky).
  const px = rng() * 100, py = rng() * 100, pz = rng() * 100;

  let geo = new THREE.IcosahedronGeometry(radius, 4);
  geo = mergeVertices(geo);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const bump =
      1 +
      0.09 * Math.sin(n.x * 3.2 + px) +
      0.07 * Math.sin(n.y * 3.6 + py) +
      0.08 * Math.sin(n.z * 2.8 + pz) +
      0.05 * Math.sin((n.x + n.y) * 4.1 + px + py);
    const pinch = 1 - 0.4 * smoothstep(0.5, 0.98, Math.abs(n.x));
    v.multiplyScalar(bump * pinch);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

// A complete square-cornered carry handle / bail: two straight vertical
// legs rising from the mounting block, joined by a single straight
// horizontal bar across the top, with small rounded fillets only at the
// two corner joints. Built from merged primitives (not a smoothed curve)
// so the sides and top stay flat/square instead of bowing into an arc —
// and the loop spans the X axis (the block's own width), i.e. turned 90°
// from a front-to-back span, matching the reference photo.
function makeHandleGeometry(halfSpan, legHeight, tubeRadius) {
  const embed = tubeRadius * 1.6; // buried into the mounting block, no visible gap
  const cornerR = tubeRadius * 1.15; // small fillet — just enough to hide the seam

  const legLen = legHeight + embed;
  const leftLeg = new THREE.CylinderGeometry(tubeRadius, tubeRadius, legLen, 10);
  leftLeg.translate(-halfSpan, (legHeight - embed) / 2, 0);

  const rightLeg = new THREE.CylinderGeometry(tubeRadius, tubeRadius, legLen, 10);
  rightLeg.translate(halfSpan, (legHeight - embed) / 2, 0);

  const topBar = new THREE.CylinderGeometry(tubeRadius, tubeRadius, halfSpan * 2, 10);
  topBar.rotateZ(Math.PI / 2);
  topBar.translate(0, legHeight, 0);

  const leftCorner = new THREE.SphereGeometry(cornerR, 10, 8);
  leftCorner.translate(-halfSpan, legHeight, 0);
  const rightCorner = new THREE.SphereGeometry(cornerR, 10, 8);
  rightCorner.translate(halfSpan, legHeight, 0);

  const merged = mergeGeometries([leftLeg, rightLeg, topBar, leftCorner, rightCorner], false);
  merged.computeVertexNormals();
  return merged;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createBarrier(options = {}) {
  const {
    width = 3.4,
    height = 1.15,
    depth = 0.85,
    seed = 7,
  } = options;

  const rng = makeRng(seed);
  const group = new THREE.Group();
  group.name = 'RoadBarrier';

  const panelTex = createPanelTexture(rng);
  const metalTex = createMetalTexture(rng);
  const metalStripeTex = createMetalTexture(rng, { stripeCorner: true });
  const sandbagTex = createSandbagTexture(rng);

  const panelMat = new THREE.MeshStandardMaterial({
    map: panelTex,
    roughness: 0.75,
    metalness: 0.35,
  });
  const metalMat = new THREE.MeshStandardMaterial({
    map: metalTex,
    roughness: 0.8,
    metalness: 0.3,
  });
  const footMat = new THREE.MeshStandardMaterial({
    map: metalStripeTex,
    roughness: 0.8,
    metalness: 0.3,
  });
  const darkMetalMat = new THREE.MeshStandardMaterial({
    color: METAL_DARK,
    roughness: 0.5,
    metalness: 0.7,
  });
  const sandbagMat = new THREE.MeshStandardMaterial({
    map: sandbagTex,
    roughness: 1,
    metalness: 0,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: GREEN_LIGHT,
    roughness: 0.55,
    metalness: 0.45,
  });
  const ropeMat = new THREE.MeshStandardMaterial({
    color: TIE_ROPE,
    roughness: 1,
    metalness: 0,
  });

  const panelH = height * 0.82;
  const panelW = width * 0.82;
  const panelThickness = depth * 0.14;
  const groundClearance = height * 0.10;

  // --- main front/back panel -------------------------------------------------
  const panelShape = chamferedRectShape(panelW, panelH, Math.min(panelW, panelH) * 0.03);
  const panelGeo = new THREE.ExtrudeGeometry(panelShape, {
    depth: panelThickness,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 2,
  });
  panelGeo.translate(0, 0, -panelThickness / 2);
  planarUV(panelGeo);
  const panel = new THREE.Mesh(panelGeo, panelMat);
  panel.position.y = groundClearance + panelH / 2;
  panel.castShadow = true;
  panel.receiveShadow = true;
  group.add(panel);

  // thin lighter trim strip along the top edge of the panel — reads as the
  // highlighted top bevel visible in the reference photo.
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(panelW + 0.02, panelH * 0.035, panelThickness + 0.02),
    trimMat
  );
  trim.position.y = groundClearance + panelH - panelH * 0.02;
  group.add(trim);

  // --- legs + feet (mirrored left/right) --------------------------------
  // Distinct triangular A-frame brace: narrow where it meets the top
  // corner, flaring out to a wide foot — built as its own piece flush
  // against the panel's outer edge (with a bolted seam between them),
  // rather than blending into the panel.
  const legTopW = width * 0.055;
  const legBottomW = width * 0.20;
  const legH = groundClearance + panelH * 0.98;
  const footH = groundClearance * 1.05;
  const legThickness = depth * 0.5;
  const footThickness = depth * 0.62;

  function buildLegAndFoot(sign) {
    const innerX = sign * (panelW / 2); // flush against panel edge
    const legShape = trapezoidShape(legTopW, legBottomW, legH);
    const legGeo = new THREE.ExtrudeGeometry(legShape, {
      depth: legThickness,
      bevelEnabled: true,
      bevelThickness: 0.006,
      bevelSize: 0.006,
      bevelSegments: 1,
    });
    legGeo.translate(0, 0, -legThickness / 2);
    planarUV(legGeo);
    const leg = new THREE.Mesh(legGeo, metalMat);
    // shift outward so the leg's narrow top-inner edge sits at the panel edge
    leg.position.x = innerX + sign * (legTopW / 2);
    leg.castShadow = true;
    leg.receiveShadow = true;
    group.add(leg);

    // bolted seam strip marking the join between panel and leg
    const seam = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.012, legH * 0.92, legThickness * 0.5),
      darkMetalMat
    );
    seam.position.set(innerX, legH / 2, panelThickness / 2 + 0.01);
    group.add(seam);
    for (let i = 0; i < 5; i++) {
      const bolt = new THREE.Mesh(
        new THREE.CylinderGeometry(width * 0.006, width * 0.006, 0.01, 8),
        darkMetalMat
      );
      bolt.rotation.x = Math.PI / 2;
      bolt.position.set(innerX, legH * (0.12 + i * 0.19), panelThickness / 2 + 0.015);
      group.add(bolt);
    }

    // wide foot block with a caution-stripe corner badge, flush on the
    // ground. Default box UVs (planarUV is only meant for the near-flat
    // extruded panel/leg shapes — applying it to a true 3D box degenerates
    // the UVs on the thin top/side faces). A per-face material array puts
    // the stripe badge only on the outward-facing side, like the photo.
    const footW = legBottomW * 1.55;
    const footGeo = new THREE.BoxGeometry(footW, footH, footThickness);
    // face order: +x, -x, +y, -y, +z, -z
    const footFaces = [metalMat, metalMat, metalMat, metalMat, metalMat, metalMat];
    footFaces[sign > 0 ? 0 : 1] = footMat;
    const foot = new THREE.Mesh(footGeo, footFaces);
    foot.position.set(innerX + sign * (legBottomW / 2), footH / 2, 0);
    foot.castShadow = true;
    foot.receiveShadow = true;
    group.add(foot);

    // fork-pocket notch cut suggestion via a darker inset strip (visual only)
    const notch = new THREE.Mesh(
      new THREE.BoxGeometry(footW * 0.3, footH * 0.5, footThickness * 1.02),
      darkMetalMat
    );
    notch.position.set(innerX + sign * (legBottomW / 2), footH * 0.5, 0);
    group.add(notch);
  }

  buildLegAndFoot(-1);
  buildLegAndFoot(1);

  // --- corner caps + carry handles --------------------------------------------
  const capW = width * 0.09;
  const capH = height * 0.10;
  const capD = depth * 0.5;
  const handleR = capW * 0.55;
  const handleTube = handleR * 0.16;

  function buildHandleCorner(sign) {
    const x = sign * (panelW / 2 - capW * 0.6);
    const y = groundClearance + panelH + capH / 2 - 0.01;

    const cap = new THREE.Mesh(new THREE.BoxGeometry(capW, capH, capD), metalMat);
    cap.position.set(x, y, 0);
    cap.castShadow = true;
    cap.receiveShadow = true;
    group.add(cap);

    const handleGeo = makeHandleGeometry(capW * 0.3, handleR * 1.3, handleTube);
    const handle = new THREE.Mesh(handleGeo, darkMetalMat);
    handle.position.set(x, y + capH / 2, 0);
    handle.castShadow = true;
    handle.receiveShadow = true;
    group.add(handle);
  }

  buildHandleCorner(-1);
  buildHandleCorner(1);

  // --- sandbags along the bottom, front and back ------------------------
  const bagCount = 4;
  const bagRadius = (panelW / bagCount) * 0.60;
  const bagScale = { x: 1.55, y: 0.58, z: 0.92 };

  function buildSandbagRow(zSign) {
    const bagsGroup = new THREE.Group();
    for (let i = 0; i < bagCount; i++) {
      const t = (i + 0.5) / bagCount - 0.5;
      const bagGeo = makeSandbagGeometry(bagRadius, rng);
      const bag = new THREE.Mesh(bagGeo, sandbagMat);
      bag.scale.set(bagScale.x, bagScale.y, bagScale.z);
      const bx = t * panelW * 0.96;
      const by = bagRadius * bagScale.y * (0.95 + rng() * 0.1);
      const bz = zSign * (panelThickness / 2 + bagRadius * 0.85);
      bag.position.set(bx, by, bz);
      bag.rotation.y = (rng() - 0.5) * 0.4;
      bag.rotation.z = (rng() - 0.5) * 0.12;
      bag.castShadow = true;
      bag.receiveShadow = true;
      bagsGroup.add(bag);

      // small twisted-tie nub at each cinched end of the sack
      for (const side of [-1, 1]) {
        const tie = new THREE.Mesh(new THREE.SphereGeometry(bagRadius * 0.14, 8, 6), ropeMat);
        tie.scale.set(1, 0.8, 0.8);
        tie.position.set(
          bx + Math.cos(bag.rotation.y) * side * bagRadius * bagScale.x * 0.98,
          by * 0.9,
          bz + Math.sin(bag.rotation.y) * side * bagRadius * bagScale.x * 0.98
        );
        bagsGroup.add(tie);
      }
    }
    group.add(bagsGroup);
  }

  buildSandbagRow(1); // front
  buildSandbagRow(-1); // back

  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  return group;
}

export default createBarrier;
