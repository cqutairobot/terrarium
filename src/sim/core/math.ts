export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Wrap a value into [0, 1). */
export function wrap01(v: number): number {
  return v - Math.floor(v);
}

/** Shortest distance on the unit circle (for hue genes), in [0, 0.5]. */
export function hueDist(a: number, b: number): number {
  const d = Math.abs(wrap01(a) - wrap01(b));
  return d > 0.5 ? 1 - d : d;
}

/** Interpolate hues along the shortest arc. */
export function lerpHue(a: number, b: number, t: number): number {
  let d = wrap01(b) - wrap01(a);
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return wrap01(a + d * t);
}

/** Angle difference wrapped into (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDiff(a, b) * t;
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function round(v: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}

/** Deterministic 1D value noise in [-1, 1], smooth, defined for all x. */
export function valueNoise1D(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = lattice(i, seed);
  const b = lattice(i + 1, seed);
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

function lattice(i: number, seed: number): number {
  let h = Math.imul(i ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** Fractal 1D noise in roughly [-1, 1]. */
export function fbm1D(x: number, seed: number, octaves = 4): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise1D(x * freq, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}
