/**
 * render/surfacegen.js
 *
 * Procedural PBR surface generation. Pure JavaScript: no THREE, no DOM, no
 * canvas. Each surface produces three byte buffers:
 *
 *   albedo : RGBA8, sRGB                (base colour)
 *   orm    : RGBA8, linear              (R=1, G=roughness, B=metalness)
 *   normal : RGBA8, linear              (tangent-space, Sobel from height)
 *
 * The ORM packing exploits the fact that three.js samples .g for roughnessMap
 * and .b for metalnessMap, so one texture drives both.
 *
 * Everything is tileable: value noise wraps on an 8x8 lattice and every pattern
 * is an integer subdivision of the UV square.
 */
import { mulberry32, clamp01, smoothstep } from '../core/rng.js';

/* ------------------------------------------------------------------ noise -- */

function createValueNoise(seed, period = 8) {
  const rnd = mulberry32(seed);
  const lat = new Float32Array(period * period);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();

  const at = (ix, iy) => {
    const x = ((ix % period) + period) % period;
    const y = ((iy % period) + period) % period;
    return lat[y * period + x];
  };

  return function noise(u, v) {
    const x = u * period;
    const y = v * period;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smoothstep(x - x0);
    const fy = smoothstep(y - y0);
    const a = at(x0, y0);
    const b = at(x0 + 1, y0);
    const c = at(x0, y0 + 1);
    const d = at(x0 + 1, y0 + 1);
    const top = a + (b - a) * fx;
    const bot = c + (d - c) * fx;
    return top + (bot - top) * fy;
  };
}

function fbmFactory(noise) {
  return function fbm(u, v, octaves = 3) {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let freq = 1;
    for (let i = 0; i < octaves; i++) {
      sum += noise(u * freq, v * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
}

/** Deterministic 2D hash in [0,1). */
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* --------------------------------------------------------------- aux masks -- */

/** Rasterises random short strokes into a wrapped mask (scratches, cracks). */
function makeStrokeMask(size, seed, count, maxLen, strength = 1) {
  const mask = new Float32Array(size * size);
  const rnd = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    let x = rnd() * size;
    let y = rnd() * size;
    const ang = rnd() * Math.PI * 2;
    const len = maxLen * (0.25 + rnd());
    const steps = Math.max(2, Math.ceil(len));
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    for (let s = 0; s < steps; s++) {
      const px = ((Math.round(x) % size) + size) % size;
      const py = ((Math.round(y) % size) + size) % size;
      const idx = py * size + px;
      const fade = (1 - s / steps) * strength;
      if (mask[idx] < fade) mask[idx] = fade;
      x += dx;
      y += dy;
    }
  }
  return mask;
}

/* ------------------------------------------------------------ surface specs -- */

const P = { r: 0, g: 0, b: 0, h: 0, rough: 0, metal: 0 };

export const SURFACE_SPECS = {
  /** Painted structural bulkheads: 1 m plates, rivets, streaks, rust. */
  hull: {
    size: 512,
    meters: 4,
    normalStrength: 2.4,
    ctx(seed) {
      return { scratch: makeStrokeMask(512, seed + 1, 90, 90, 0.9) };
    },
    px(u, v, c, o) {
      const panels = 4;
      const px = u * panels;
      const py = v * panels;
      const ix = Math.floor(px);
      const iy = Math.floor(py);
      const lx = px - ix;
      const ly = py - iy;
      const edge = Math.min(lx, 1 - lx, ly, 1 - ly);
      const seam = edge < 0.012 ? 1 : 0;
      const bevel = Math.min(1, edge / 0.09);

      // rivet ring inside each plate corner
      const rx = Math.min(lx, 1 - lx) - 0.05;
      const ry = Math.min(ly, 1 - ly) - 0.05;
      const rv = Math.sqrt(rx * rx + ry * ry);
      const rivet = rv < 0.018 ? 1 - rv / 0.018 : 0;

      const pv = hash2(ix, iy);
      const grime = c.fbm(u * 2.2 + pv * 4, v * 7.5 + pv * 3, 3);
      const rustN = c.fbm(u * 6.1 + 11.3, v * 6.1 + 4.1, 3);
      const rust = clamp01((rustN - 0.57) * 3.4) * (0.45 + 0.55 * (1 - bevel));
      const dirt = clamp01(grime * 1.35 - 0.28);
      const scratch =
        c.scratch[((v * c.surfaceSize) | 0) * c.surfaceSize + ((u * c.surfaceSize) | 0)] || 0;

      let r = 0.238 * (0.93 + pv * 0.14);
      let g = 0.252 * (0.93 + pv * 0.12);
      let b = 0.236 * (0.93 + pv * 0.12);

      // shadowed seams, dirty panels
      const dark = 1 - dirt * 0.38 - seam * 0.42;
      r *= dark;
      g *= dark;
      b *= dark;

      // rust wash
      r = r * (1 - rust * 0.55) + 0.34 * rust * 0.55;
      g = g * (1 - rust * 0.75) + 0.165 * rust * 0.75;
      b = b * (1 - rust * 0.85) + 0.09 * rust * 0.85;

      // bare metal where scratched / on rivets
      r += scratch * 0.16 + rivet * 0.1;
      g += scratch * 0.17 + rivet * 0.1;
      b += scratch * 0.18 + rivet * 0.1;

      o.r = r * 255;
      o.g = g * 255;
      o.b = b * 255;
      o.h = 0.58 + bevel * 0.2 + rivet * 0.2 - seam * 0.5 - dirt * 0.05 - scratch * 0.025;
      o.rough = clamp01(0.5 + dirt * 0.3 + rust * 0.2 - scratch * 0.2 - rivet * 0.12);
      o.metal = clamp01(0.88 - dirt * 0.55 - rust * 0.55 + scratch * 0.08);
    },
  },

  /** Walking deck: diamond tread plate, worn tops, grimy recesses. */
  deck: {
    size: 512,
    meters: 4,
    normalStrength: 3.0,
    ctx(seed) {
      return { scratch: makeStrokeMask(512, seed + 2, 120, 140, 0.8) };
    },
    px(u, v, c, o) {
      // lozenge tread pattern, 0.5 m pitch
      const pu = u * 8;
      const pv = v * 8;
      const cx = Math.floor(pu);
      const cy = Math.floor(pv);
      let fx = pu - cx - 0.5;
      let fy = pv - cy - 0.5;
      const flip = (cx + cy) & 1;
      const tilt = flip ? fx - fy : fx + fy;
      const across = flip ? fx + fy : fx - fy;
      const loz = 1 - (Math.abs(tilt) * 1.05 + Math.abs(across) * 1.85);
      const raised = clamp01(loz * 5);

      // 1 m plate seams
      const sx = Math.min((u * 4) % 1, 1 - ((u * 4) % 1));
      const sy = Math.min((v * 4) % 1, 1 - ((v * 4) % 1));
      const seam = Math.min(sx, sy) < 0.008 ? 1 : 0;

      const wear = c.fbm(u * 5.0 + 2.3, v * 5.0 + 8.7, 3);
      const grime = clamp01(c.fbm(u * 3.1 + 7.7, v * 3.1 + 1.9, 3) * 1.3 - 0.32);
      const scratch =
        c.scratch[((v * c.surfaceSize) | 0) * c.surfaceSize + ((u * c.surfaceSize) | 0)] || 0;

      let base = 0.156 + raised * 0.052 + wear * 0.035;
      let r = base * 1.0;
      let g = base * 1.03;
      let b = base * 1.06;

      const dirt = 1 - grime * 0.5 - seam * 0.5;
      r *= dirt;
      g *= dirt;
      b *= dirt;

      r += scratch * 0.2;
      g += scratch * 0.2;
      b += scratch * 0.21;

      o.r = r * 255;
      o.g = g * 255;
      o.b = b * 255;
      o.h = 0.35 + raised * 0.45 - seam * 0.3 - grime * 0.04;
      o.rough = clamp01(0.62 + grime * 0.24 - raised * 0.28 - scratch * 0.14);
      o.metal = clamp01(0.78 - grime * 0.45);
    },
  },

  /** Cargo decking: open grating over a black void. */
  grate: {
    size: 256,
    meters: 2,
    normalStrength: 3.2,
    ctx(seed) {
      return { scratch: makeStrokeMask(256, seed + 3, 50, 60, 1) };
    },
    px(u, v, c, o) {
      const pitch = 8; // 0.25 m pitch
      const bu = (u * pitch) % 1;
      const bar = bu < 0.52 ? 1 : 0;
      // cross braces every 1 m
      const bv = (v * 2) % 1;
      const brace = bv < 0.12 ? 1 : 0;
      const solid = Math.max(bar, brace);

      const rust = clamp01((c.fbm(u * 9 + 3.3, v * 9 + 6.1, 3) - 0.5) * 2.6);
      const grime = clamp01(c.fbm(u * 4 + 1.1, v * 4 + 2.2, 3) * 1.2 - 0.25);
      const edgeShade = bar ? 1 - Math.abs(bu / 0.52 - 0.5) * 0.5 : 0.25;

      let r = (0.20 * edgeShade + 0.02) * (1 - rust * 0.4) + 0.26 * rust * 0.4;
      let g = (0.205 * edgeShade + 0.02) * (1 - rust * 0.6) + 0.13 * rust * 0.6;
      let b = (0.20 * edgeShade + 0.02) * (1 - rust * 0.75) + 0.07 * rust * 0.75;
      if (!solid) {
        r = 0.012;
        g = 0.014;
        b = 0.016;
      }
      const d = 1 - grime * 0.3 * solid;
      o.r = r * d * 255;
      o.g = g * d * 255;
      o.b = b * d * 255;
      o.h = solid ? 0.7 + edgeShade * 0.25 : 0.05;
      o.rough = solid ? clamp01(0.55 + grime * 0.3) : 0.95;
      o.metal = solid ? 0.7 : 0.1;
    },
  },

  /** Medbay: clinical tiles, yellowed grout, hairline cracks. */
  tile: {
    size: 256,
    meters: 2,
    normalStrength: 1.5,
    ctx(seed) {
      return { cracks: makeStrokeMask(256, seed + 4, 26, 46, 0.7) };
    },
    px(u, v, c, o) {
      const T = 4;
      const px = u * T;
      const py = v * T;
      const lx = px - Math.floor(px);
      const ly = py - Math.floor(py);
      const edge = Math.min(lx, 1 - lx, ly, 1 - ly);
      const grout = edge < 0.028 ? 1 : 0;
      const tileId = hash2(Math.floor(px), Math.floor(py));

      const stain = clamp01(c.fbm(u * 3.4 + 5.5, v * 3.4 + 9.1, 3) * 1.5 - 0.62);
      const crack =
        c.cracks[((v * c.surfaceSize) | 0) * c.surfaceSize + ((u * c.surfaceSize) | 0)] || 0;

      let base = 0.70 + tileId * 0.055;
      let r = base * (1 - stain * 0.12) + 0.03 * stain;
      let g = base * (1 - stain * 0.16) + 0.02 * stain;
      let b = base * 0.97 * (1 - stain * 0.30);

      if (grout) {
        r = 0.34 - stain * 0.1;
        g = 0.34 - stain * 0.1;
        b = 0.31 - stain * 0.1;
      }
      r -= crack * 0.28;
      g -= crack * 0.28;
      b -= crack * 0.28;

      o.r = clamp01(r) * 255;
      o.g = clamp01(g) * 255;
      o.b = clamp01(b) * 255;
      o.h = grout ? 0.2 : 0.72 - stain * 0.03 - crack * 0.2;
      o.rough = grout ? 0.9 : clamp01(0.22 + stain * 0.3 + crack * 0.3);
      o.metal = 0.05;
    },
  },

  /** Ceiling: suspended dark panels with vent slots. */
  ceiling: {
    size: 256,
    meters: 2,
    normalStrength: 1.8,
    ctx(seed) {
      return { stains: makeStrokeMask(256, seed + 5, 18, 70, 0.5) };
    },
    px(u, v, c, o) {
      const P2 = 2;
      const px = u * P2;
      const py = v * P2;
      const lx = px - Math.floor(px);
      const ly = py - Math.floor(py);
      const edge = Math.min(lx, 1 - lx, ly, 1 - ly);
      const seam = edge < 0.02 ? 1 : 0;

      // vent slots in the left half of each panel
      const slotPhase = (lx * 22) % 1;
      const inVent = lx > 0.12 && lx < 0.42 && ly > 0.18 && ly < 0.82;
      const slot = inVent && slotPhase < 0.45 ? 1 : 0;

      const pv = hash2(Math.floor(px), Math.floor(py));
      const stain =
        c.stains[((v * c.surfaceSize) | 0) * c.surfaceSize + ((u * c.surfaceSize) | 0)] || 0;

      let base = 0.115 + pv * 0.03;
      let r = base * (1 - stain * 0.35);
      let g = base * 1.02 * (1 - stain * 0.35);
      let b = base * 1.06 * (1 - stain * 0.35);
      if (slot) {
        r *= 0.22;
        g *= 0.22;
        b *= 0.24;
      }
      if (seam) {
        r *= 0.6;
        g *= 0.6;
        b *= 0.6;
      }

      o.r = r * 255;
      o.g = g * 255;
      o.b = b * 255;
      o.h = 0.6 - seam * 0.35 - slot * 0.5;
      o.rough = clamp01(0.78 + stain * 0.15);
      o.metal = 0.3;
    },
  },

  /** Reactor housing: scorched heavy plate with rust bloom. */
  reactor: {
    size: 256,
    meters: 2,
    normalStrength: 2.6,
    ctx(seed) {
      return { scratch: makeStrokeMask(256, seed + 6, 40, 80, 1) };
    },
    px(u, v, c, o) {
      const panels = 2;
      const lx = (u * panels) % 1;
      const ly = (v * panels) % 1;
      const edge = Math.min(lx, 1 - lx, ly, 1 - ly);
      const seam = edge < 0.018 ? 1 : 0;
      const boltRow = Math.abs(edge - 0.05) < 0.012 ? 1 : 0;

      const rust = clamp01((c.fbm(u * 5.5 + 2.0, v * 5.5 + 3.0, 3) - 0.42) * 2.2);
      const soot = clamp01(c.fbm(u * 1.7 + 8.8, v * 1.7 + 2.4, 2) * 1.4 - 0.45);
      const scratch =
        c.scratch[((v * c.surfaceSize) | 0) * c.surfaceSize + ((u * c.surfaceSize) | 0)] || 0;

      let r = 0.105 + soot * 0.02;
      let g = 0.112 + soot * 0.02;
      let b = 0.112 + soot * 0.02;
      const dirt = 1 - seam * 0.45;
      r = (r * dirt) * (1 - rust * 0.6) + 0.30 * rust * 0.6;
      g = (g * dirt) * (1 - rust * 0.72) + 0.14 * rust * 0.72;
      b = (b * dirt) * (1 - rust * 0.8) + 0.07 * rust * 0.8;
      r += scratch * 0.18 + boltRow * 0.05;
      g += scratch * 0.18 + boltRow * 0.05;
      b += scratch * 0.19 + boltRow * 0.05;

      o.r = r * 255;
      o.g = g * 255;
      o.b = b * 255;
      o.h = 0.6 - seam * 0.45 + boltRow * 0.12 - rust * 0.05;
      o.rough = clamp01(0.55 + rust * 0.25 + soot * 0.2 - scratch * 0.15);
      o.metal = clamp01(0.8 - rust * 0.45);
    },
  },
};

/* --------------------------------------------------------------- generator -- */

/**
 * @param {keyof typeof SURFACE_SPECS} name
 * @param {{seed?:number, size?:number}} [opts]
 * @returns {{name:string, size:number, meters:number, albedo:Uint8ClampedArray,
 *            orm:Uint8ClampedArray, normal:Uint8ClampedArray, ms:number}}
 */
export function generateSurfaceData(name, opts = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const spec = SURFACE_SPECS[name];
  if (!spec) throw new Error(`[surfacegen] unknown surface "${name}"`);

  const size = opts.size ?? spec.size;
  const seed = (opts.seed ?? 0x5eed1) + name.length * 977;

  const noiseA = createValueNoise(seed, 8);
  const noiseB = createValueNoise(seed ^ 0x9e37, 8);
  const ctx = {
    fbm: fbmFactory(noiseA),
    fbm2: fbmFactory(noiseB),
    surfaceSize: size,
    ...(spec.ctx ? spec.ctx(seed) : {}),
  };

  const count = size * size;
  const albedo = new Uint8ClampedArray(count * 4);
  const orm = new Uint8ClampedArray(count * 4);
  const normal = new Uint8ClampedArray(count * 4);
  const height = new Float32Array(count);

  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = y * inv;
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const u = x * inv;
      spec.px(u, v, ctx, P);
      const i = (row + x) * 4;
      albedo[i] = P.r;
      albedo[i + 1] = P.g;
      albedo[i + 2] = P.b;
      albedo[i + 3] = 255;

      orm[i] = 255;
      orm[i + 1] = clamp01(P.rough) * 255;
      orm[i + 2] = clamp01(P.metal) * 255;
      orm[i + 3] = 255;

      height[row + x] = P.h;
    }
  }

  // Tangent-space normals from the height field (Sobel), wrapping at edges.
  const strength = spec.normalStrength ?? 2;
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size;
    const y0 = y * size;
    const yp = ((y + 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const dx =
        height[y0 + xp] * 2 + height[ym + xp] + height[yp + xp] -
        (height[y0 + xm] * 2 + height[ym + xm] + height[yp + xm]);
      const dy =
        height[yp + x] * 2 + height[yp + xm] + height[yp + xp] -
        (height[ym + x] * 2 + height[ym + xm] + height[ym + xp]);

      // image rows run top-down, so dH/dV = -dy
      let nx = -dx * strength * 0.125;
      let ny = dy * strength * 0.125;
      let nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;

      const i = (y0 + x) * 4;
      normal[i] = (nx * 0.5 + 0.5) * 255;
      normal[i + 1] = (ny * 0.5 + 0.5) * 255;
      normal[i + 2] = (nz * 0.5 + 0.5) * 255;
      normal[i + 3] = 255;
    }
  }

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { name, size, meters: spec.meters, albedo, orm, normal, ms: t1 - t0 };
}
