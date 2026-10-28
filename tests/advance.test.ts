import { describe, expect, it } from 'vitest';
import { awayFacts, summarizeAway } from '../src/game/away';
import { advanceWorld } from '../src/sim/advance';
import { restoreWorld, snapshotWorld } from '../src/sim/serialize';
import { World } from '../src/sim/world';
import { stepFor } from './helpers';

describe('catching up on time away', () => {
  it('runs a world forward exactly as the live loop would', async () => {
    const w = new World({ seed: 'catch-up', aspect: 16 / 9 });
    w.clock = () => 0;
    stepFor(w, 10);
    const twin = restoreWorld(snapshotWorld(w));
    twin.clock = () => 0;
    stepFor(w, 90);
    const simulated = await advanceWorld(twin, { seconds: 90, wallStart: 0, wallEnd: 0 });
    expect(simulated).toBeCloseTo(90, 6);
    expect(twin.time).toBeCloseTo(w.time, 9);
    expect(twin.rng.getState()).toEqual(w.rng.getState());
    expect(twin.creatures.map((c) => [c.id, c.x, c.energy])).toEqual(w.creatures.map((c) => [c.id, c.x, c.energy]));
  });

  it('stamps what happened inside the absence, and can stop early', async () => {
    const w = new World({ seed: 'stamps', aspect: 16 / 9 });
    stepFor(w, 5);
    const before = awayFacts(w);
    const start = 1_000_000;
    const end = start + 3_600_000;
    let progress = 0;
    const simulated = await advanceWorld(
      w,
      { seconds: 600, wallStart: start, wallEnd: end },
      { onProgress: (s) => (progress = s), shouldStop: () => progress >= 200, sliceSeconds: 50 },
    );
    expect(simulated).toBeCloseTo(200, 6);
    const later = w.history.log.toArray().filter((e) => e.t > before.time);
    expect(later.length).toBeGreaterThan(0);
    for (const e of later) {
      expect(e.w).toBeGreaterThanOrEqual(start);
      expect(e.w).toBeLessThanOrEqual(end);
    }
    // the world's clock is the real one again afterwards
    expect(Math.abs(w.clock() - Date.now())).toBeLessThan(5000);
    const s = summarizeAway(before, w, 3_600_000, simulated, true);
    expect(s.births).toBe(w.counters.births - before.births);
    expect(s.events.every((e) => e.t > before.time)).toBe(true);
    expect(s.partial).toBe(true);
  });
});
