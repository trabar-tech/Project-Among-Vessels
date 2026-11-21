/**
 * render/textures.js
 * Bridges the pure pixel generators in surfacegen.js to three.js textures.
 * Generation is async and yields between surfaces so the loading screen paints.
 */
import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { generateSurfaceData, SURFACE_SPECS } from './surfacegen.js';

function canvasFrom(data, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { alpha: false });
  const img = ctx.createImageData(size, size);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function textureFrom(data, size, srgb, anisotropy) {
  const tex = new THREE.CanvasTexture(canvasFrom(data, size));
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * @param {{onProgress?:(label:string, fraction:number)=>void, anisotropy?:number}} opts
 */
export async function createSurfaceTextures({ onProgress, anisotropy = CONFIG.ANISOTROPY } = {}) {
  const names = Object.keys(SURFACE_SPECS);
  /** @type {Record<string, any>} */
  const out = {};

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    onProgress?.(name, i / names.length);
    // Yield so the loading overlay can repaint between surfaces.
    await new Promise((r) => setTimeout(r, 0));

    const data = generateSurfaceData(name, { seed: CONFIG.TEXTURE_SEED });
    const map = textureFrom(data.albedo, data.size, true, anisotropy);
    const normalMap = textureFrom(data.normal, data.size, false, anisotropy);
    // One texture serves both: three samples .g for roughness and .b for metalness.
    const orm = textureFrom(data.orm, data.size, false, anisotropy);

    out[name] = {
      map,
      normalMap,
      roughnessMap: orm,
      metalnessMap: orm,
      meters: data.meters,
      size: data.size,
    };
  }

  onProgress?.('done', 1);
  return out;
}

/* ------------------------------------------------------------- decal art -- */

const FONT_STACK = '"Courier New", ui-monospace, monospace';

function drawStencil(ctx, text, x, y, size, color, align = 'center') {
  ctx.font = `bold ${size}px ${FONT_STACK}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Room / hazard signage. */
export function makeSignTexture(title, subtitle = '', opts = {}) {
  const w = 512;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = opts.bg ?? '#151a18';
  ctx.fillRect(0, 0, w, h);

  // scuffed border
  ctx.strokeStyle = opts.border ?? '#8a7638';
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, w - 20, h - 20);

  drawStencil(ctx, title.toUpperCase(), w / 2, subtitle ? h * 0.42 : h * 0.52, 54, opts.fg ?? '#d8c9a0');
  if (subtitle) {
    drawStencil(ctx, subtitle.toUpperCase(), w / 2, h * 0.72, 24, opts.sub ?? '#8e8a7c');
  }

  // grime pass
  ctx.globalAlpha = 0.12;
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? '#000' : '#c9b98a';
    const r = 2 + Math.random() * 20;
    ctx.fillRect(Math.random() * w, Math.random() * h, r, r * 0.6);
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = CONFIG.ANISOTROPY;
  return tex;
}

/** Console screen: emits light, carries fake telemetry. */
export function makeScreenTexture(title = 'SYS', accent = '#43d0e0') {
  const s = 256;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#050b0d';
  ctx.fillRect(0, 0, s, s);

  drawStencil(ctx, title, 12, 24, 22, accent, 'left');

  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.moveTo(12, 44);
  ctx.lineTo(s - 12, 44);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // fake data rows
  ctx.font = `11px ${FONT_STACK}`;
  ctx.textAlign = 'left';
  const words = ['PWR', 'O2', 'VAC', 'NAV', 'TEMP', 'FLUX', 'CREW', 'LOCK'];
  for (let i = 0; i < 12; i++) {
    const y = 62 + i * 13;
    ctx.fillStyle = i % 5 === 4 ? '#e0a13c' : accent;
    ctx.globalAlpha = 0.55 + Math.random() * 0.4;
    ctx.fillText(
      `${words[i % words.length]} ${(Math.random() * 999).toFixed(0).padStart(3, '0')}  ${
        Math.random() < 0.8 ? 'OK ' : 'WRN'
      } ${'|'.repeat(Math.floor(Math.random() * 6))}`,
      y % 2 ? 16 : 20,
      y
    );
  }
  ctx.globalAlpha = 1;

  // scanline wash
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = 0; y < s; y += 3) ctx.fillRect(0, y, s, 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Yellow/black hazard stripes for airlocks, cargo doors, edges. */
export function makeHazardTexture() {
  const s = 256;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1a1a18';
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = '#c9a227';
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.rotate(-Math.PI / 4);
  for (let i = -s; i < s; i += 48) ctx.fillRect(i, -s, 24, s * 2);
  ctx.restore();

  // wear: punch holes of underlying dark and grime
  for (let i = 0; i < 260; i++) {
    ctx.globalAlpha = 0.1 + Math.random() * 0.35;
    ctx.fillStyle = Math.random() < 0.6 ? '#12120f' : '#6a6250';
    const r = 2 + Math.random() * 14;
    ctx.beginPath();
    ctx.ellipse(Math.random() * s, Math.random() * s, r, r * 0.6, Math.random() * 3, 0, 7);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
