import { fbm1D } from './core/math';
import type { Rng } from './core/rng';

export interface Rock {
  x: number;
  y: number;
  r: number;
  shade: number;
}

export interface MossMound {
  x: number;
  r: number;
  hue: number;
}

export interface Terrain {
  /** Integer noise seed (lets the renderer extend the floor beyond the world). */
  noiseSeed: number;
  width: number;
  height: number;
  step: number;
  /** Floor surface y, sampled every `step` units from x = 0. */
  heights: number[];
  rocks: Rock[];
  moss: MossMound[];
  /** X positions of bubble vents. */
  vents: number[];
}

/** Floor surface height for any x (works outside the world too). */
export function floorFormula(x: number, height: number, noiseSeed: number): number {
  const broad = fbm1D(x / 420, noiseSeed, 3);
  const fine = fbm1D(x / 95, noiseSeed + 7, 2);
  return height - (78 + 34 * broad + 10 * fine);
}

export function generateTerrain(rng: Rng, width: number, height: number): Terrain {
  const noiseSeed = rng.int(1_000_000);
  const step = 8;
  const heights: number[] = [];
  for (let x = 0; x <= width + step; x += step) heights.push(floorFormula(x, height, noiseSeed));
  const t: Terrain = { noiseSeed, width, height, step, heights, rocks: [], moss: [], vents: [] };

  const rockCount = 5 + rng.int(5);
  for (let i = 0; i < rockCount; i++) {
    const x = rng.range(40, width - 40);
    const r = rng.range(14, 46);
    t.rocks.push({ x, y: groundY(t, x) + r * 0.35, r, shade: rng.next() });
  }
  const mossCount = 14 + rng.int(10);
  for (let i = 0; i < mossCount; i++) {
    t.moss.push({ x: rng.range(0, width), r: rng.range(12, 36), hue: rng.range(0.27, 0.42) });
  }
  const vents = 2 + rng.int(2);
  for (let i = 0; i < vents; i++) t.vents.push(rng.range(width * 0.1, width * 0.9));
  return t;
}

/** Floor y at x (interpolated samples inside the world, formula outside). */
export function groundY(t: Terrain, x: number): number {
  if (x < 0 || x > t.width) return floorFormula(x, t.height, t.noiseSeed);
  const f = x / t.step;
  const i = Math.floor(f);
  const a = t.heights[i];
  const b = t.heights[Math.min(i + 1, t.heights.length - 1)];
  return a + (b - a) * (f - i);
}
