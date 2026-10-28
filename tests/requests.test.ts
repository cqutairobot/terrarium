import { describe, expect, it } from 'vitest';
import { MEASURES, specCloseness, type Measure } from '../src/game/conditions';
import { candidatesFor, closeRequest, drawRequest, ecologyStatus, localDate, newBoard, refreshBoard } from '../src/game/requests';
import type { Creature } from '../src/sim/entities/creature';
import { express, G } from '../src/sim/genome';
import { World } from '../src/sim/world';
import { stepFor } from './helpers';

const GENE: Partial<Record<Measure, number>> = { size: G.size, speed: G.speed, sense: G.perception, lifespan: G.longevity, tentacles: G.tentacles, tail: G.tailLength, eyes: G.eyeSize, warmth: G.thermalPref };

describe('requests', () => {
  it('keeps three requests and one daily on the board', () => {
    const w = new World({ seed: 'board', aspect: 16 / 9 });
    stepFor(w, 30);
    const b = newBoard();
    const now = new Date(2026, 9, 28, 9, 0).getTime();
    expect(refreshBoard(b, w, now)).toBe(true);
    expect(b.open.filter((r) => !r.daily)).toHaveLength(3);
    expect(b.open.filter((r) => r.daily)).toHaveLength(1);
    expect(b.dailyDate).toBe(localDate(now));
    expect(refreshBoard(b, w, now + 1000)).toBe(false);
    closeRequest(b, b.open[1].id, true);
    expect(refreshBoard(b, w, now + 2000)).toBe(true);
    expect(b.completed).toBe(1);
    // a new day brings a new daily request
    const yesterday = b.open.find((r) => r.daily)!.id;
    refreshBoard(b, w, now + 86_400_000);
    expect(b.open.filter((r) => r.daily)).toHaveLength(1);
    expect(b.open.find((r) => r.daily)!.id).not.toBe(yesterday);
  });

  it('only asks for what the tank’s genes can reach', () => {
    for (const seed of ['ask-a', 'ask-b', 'ask-c']) {
      const w = new World({ seed, aspect: 16 / 9 });
      stepFor(w, 60);
      const b = newBoard();
      for (let i = 0; i < 40; i++) {
        const r = drawRequest(w, b, 0);
        expect(r.reward).toBeGreaterThan(0);
        expect(r.goal.length).toBeGreaterThan(4);
        if (r.kind !== 'deliver' || !r.spec) {
          const st = ecologyStatus(w, b, r);
          expect(st.progress).toBeGreaterThanOrEqual(0);
          expect(st.progress).toBeLessThanOrEqual(1);
          continue;
        }
        for (const [m, [lo, hi]] of Object.entries(r.spec.ranges ?? {}) as [Measure, [number | null, number | null]][]) {
          // someone alive could reach the target if their gene for it were pushed to the limit
          const reachable = w.creatures.some((c) => {
            const gi = GENE[m];
            if (gi === undefined) return true;
            const g = { g: c.genome.g.slice(), rare: c.genome.rare };
            g.g[gi] = lo !== null ? 1 : 0;
            const v = MEASURES[m].get({ ph: express(g) } as Creature);
            return lo !== null ? v >= lo : v <= hi!;
          });
          expect(reachable).toBe(true);
        }
        if (r.difficulty === 1) {
          // an easy request is nearly within reach already
          const best = Math.max(...w.creatures.filter((c) => c.stage !== 'egg').map((c) => specCloseness(c, r.spec!)));
          expect(best).toBeGreaterThanOrEqual(0.5);
        }
        expect(candidatesFor(w, r).every((c) => c.stage === 'adult' || c.stage === 'elder' || !r.spec!.adult)).toBe(true);
      }
    }
  });
});
