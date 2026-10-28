import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';

/** Smoke test of ecological balance; the long runs live in `npm run sim`. */
describe('ecological balance (smoke)', () => {
  for (const seed of ['balance-a', 'balance-b']) {
    it(`seed ${seed}: 10 simulated minutes without collapse or explosion`, () => {
      const w = new World({ seed, aspect: 16 / 9 });
      let minCons = Infinity;
      let maxAll = 0;
      for (let i = 0; i < 30 * 600; i++) {
        w.step(1 / 30);
        if (i % 300 === 0) {
          minCons = Math.min(minCons, w.consumerCount);
          maxAll = Math.max(maxAll, w.creatures.length);
          for (const c of w.creatures) {
            expect(Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.energy)).toBe(true);
          }
        }
      }
      expect(minCons).toBeGreaterThan(15);
      expect(maxAll).toBeLessThanOrEqual(w.cfg.maxCreatures);
      expect(w.counters.births).toBeGreaterThan(20);
      expect(w.counters.generationsMax).toBeGreaterThanOrEqual(2);
      const k = w.counts();
      expect(k.plants).toBeGreaterThan(20);
    });
  }
});
