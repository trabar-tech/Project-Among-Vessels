/**
 * render/environment.js
 * Procedural IBL for the ship interior.
 *
 * Why this exists: the first build had metalness ~0.88 on the bulkheads and no
 * environment map, so those surfaces had nothing to reflect and rendered almost
 * black no matter how many point lights were added. A cheap prefiltered
 * equirectangular gradient fixes the diffuse/specular response everywhere at
 * once, which is why the default exposure can stay low.
 *
 * The gradient is painted on a Canvas2D and prefiltered with PMREMGenerator;
 * no HDR file, no network request.
 */
import * as THREE from 'three';

export function createShipEnvironment(renderer) {
  const w = 1024;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // Vertical: cold dark overhead, a muggy horizon, warm-grey deck bounce below.
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0.0, '#05080a');
  grad.addColorStop(0.34, '#0e1619');
  grad.addColorStop(0.5, '#1d2628');
  grad.addColorStop(0.58, '#1a1714');
  grad.addColorStop(0.8, '#0b0a09');
  grad.addColorStop(1.0, '#050505');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Warm sodium-lamp pools overhead: gives the metals somewhere bright to catch.
  const pools = [
    { x: 0.12, y: 0.2, r: 0.13, color: 'rgba(255, 208, 150, 0.75)' },
    { x: 0.38, y: 0.16, r: 0.1, color: 'rgba(255, 224, 176, 0.6)' },
    { x: 0.63, y: 0.22, r: 0.14, color: 'rgba(255, 196, 132, 0.7)' },
    { x: 0.88, y: 0.18, r: 0.1, color: 'rgba(240, 236, 220, 0.55)' },
    // one cold work light, off to the side, for a bit of colour contrast
    { x: 0.5, y: 0.44, r: 0.09, color: 'rgba(120, 190, 210, 0.35)' },
  ];
  for (const p of pools) {
    const g = ctx.createRadialGradient(p.x * w, p.y * h, 0, p.x * w, p.y * h, p.r * w);
    g.addColorStop(0, p.color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // Faint horizontal structure so reflections smear along the corridor axis.
  ctx.globalAlpha = 0.06;
  for (let y = 0; y < h; y += 26) {
    ctx.fillStyle = y % 52 === 0 ? '#3d443f' : '#101314';
    ctx.fillRect(0, y, w, 5);
  }
  ctx.globalAlpha = 1;

  const equirect = new THREE.CanvasTexture(canvas);
  equirect.mapping = THREE.EquirectangularReflectionMapping;
  equirect.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const target = pmrem.fromEquirectangular(equirect);
  pmrem.dispose();
  equirect.dispose();

  target.texture.name = 'ship_environment';
  return target.texture;
}
