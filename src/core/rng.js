/**
 * core/rng.js
 * Deterministic RNG. Every procedural system takes a seed so a run can be
 * replayed and so texture output is stable across reloads.
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
/** Frame-rate independent damping. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function rangeFactory(seed) {
  const rnd = mulberry32(seed);
  return {
    next: rnd,
    f: (min = 0, max = 1) => min + rnd() * (max - min),
    i: (min, max) => Math.floor(min + rnd() * (max - min + 1)),
    chance: (p) => rnd() < p,
    pick: (arr) => arr[Math.floor(rnd() * arr.length)],
    sign: () => (rnd() < 0.5 ? -1 : 1),
  };
}
