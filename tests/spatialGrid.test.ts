import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/core/rng';
import { SpatialGrid } from '../src/sim/core/spatialGrid';

describe('SpatialGrid', () => {
  it('returns exactly the points a brute-force search finds', () => {
    const rng = new Rng('grid');
    const W = 1800;
    const H = 1000;
    const pts = Array.from({ length: 400 }, () => ({ x: rng.range(0, W), y: rng.range(0, H) }));
    const grid = new SpatialGrid(W, H, 80);
    grid.build(pts);
    const out: number[] = [];
    for (let q = 0; q < 200; q++) {
      const x = rng.range(-50, W + 50);
      const y = rng.range(-50, H + 50);
      const r = rng.range(5, 260);
      out.length = 0;
      grid.query(pts, x, y, r, out);
      const brute = pts
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => (p.x - x) ** 2 + (p.y - y) ** 2 <= r * r)
        .map(({ i }) => i)
        .sort((a, b) => a - b);
      expect([...out].sort((a, b) => a - b)).toEqual(brute);
    }
  });

  it('handles rebuilding with a different number of items', () => {
    const grid = new SpatialGrid(500, 500, 50);
    grid.build([{ x: 10, y: 10 }]);
    expect(grid.count).toBe(1);
    const many = Array.from({ length: 300 }, (_, i) => ({ x: (i * 7) % 500, y: (i * 13) % 500 }));
    grid.build(many);
    expect(grid.count).toBe(300);
    const out: number[] = [];
    grid.query(many, 250, 250, 1000, out);
    expect(out.length).toBe(300);
  });
});
