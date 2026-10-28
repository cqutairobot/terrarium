import { describe, expect, it } from 'vitest';
import { hashSeed, Rng } from '../src/sim/core/rng';

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng('tiny-eden');
    const b = new Rng('tiny-eden');
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  it('differs between seeds', () => {
    const a = new Rng('a');
    const b = new Rng('b');
    let same = 0;
    for (let i = 0; i < 100; i++) if (a.next() === b.next()) same++;
    expect(same).toBeLessThan(3);
  });

  it('resumes exactly from a saved state', () => {
    const a = new Rng(42);
    for (let i = 0; i < 37; i++) a.next();
    const saved = a.getState();
    const expected = Array.from({ length: 50 }, () => a.next());
    const b = new Rng(saved);
    const resumed = Array.from({ length: 50 }, () => b.next());
    expect(resumed).toEqual(expected);
  });

  it('produces uniform-ish floats in [0, 1)', () => {
    const r = new Rng('uniform');
    const bins = new Array(10).fill(0);
    for (let i = 0; i < 20000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      bins[Math.floor(v * 10)]++;
    }
    for (const b of bins) expect(Math.abs(b - 2000)).toBeLessThan(200);
  });

  it('draws standard normals', () => {
    const r = new Rng('normal');
    let sum = 0;
    let sq = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const v = r.normal();
      sum += v;
      sq += v * v;
    }
    const mean = sum / n;
    const variance = sq / n - mean * mean;
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(Math.abs(variance - 1)).toBeLessThan(0.06);
  });

  it('hashes strings into four 32-bit words', () => {
    const h = hashSeed('eden');
    expect(h).toHaveLength(4);
    for (const w of h) expect(w).toBe(w >>> 0);
  });
});
