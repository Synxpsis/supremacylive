// gridTexture.js — shared canvas-generated tile texture used by both the
// single-tile editor and the board simulation, so every tile (whatever
// its color) reads with the same fine grid + border styling.

import * as THREE from 'three';

function luminance(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function makeGridTexture(baseColor = '#d8dcd3', opts = {}) {
  const { divisions = 10, borderAlpha = 0.45, crosshair = true } = opts;
  const dark = luminance(baseColor) < 0.5;
  const lineRGB = dark ? '255,255,255' : '0,0,0';

  const N = 512;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, N, N);

  ctx.strokeStyle = `rgba(${lineRGB},0.10)`;
  ctx.lineWidth = 1;
  for (let i = 1; i < divisions; i++) {
    const p = (i / divisions) * N;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, N);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(N, p);
    ctx.stroke();
  }
  // center crosshair
  if (crosshair) {
    ctx.strokeStyle = `rgba(${lineRGB},0.22)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(N / 2, 0);
    ctx.lineTo(N / 2, N);
    ctx.moveTo(0, N / 2);
    ctx.lineTo(N, N / 2);
    ctx.stroke();
  }
  // border
  ctx.strokeStyle = dark ? `rgba(255,255,255,${borderAlpha})` : `rgba(0,0,0,${borderAlpha})`;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, N - 6, N - 6);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
