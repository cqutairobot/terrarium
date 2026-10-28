import { describe, expect, it } from 'vitest';
import { G } from '../src/sim/genome';
import { addAdult, addPlant, emptyWorld, herbGenome, predGenome, PRED_SPECIES, stepFor } from './helpers';

describe('behavior', () => {
  it('a hungry grazer finds a plant, swims to it and eats', () => {
    const w = emptyWorld('graze');
    w.env.lightAvg = 1;
    const plant = addPlant(w, 700, 0.9);
    const c = addAdult(w, herbGenome('g'), 620, plant.y - 120, 1, 0.25);
    const e0 = c.energy;
    let ate = false;
    for (let i = 0; i < 30 * 30 && !ate; i++) {
      w.step(1 / 30);
      if (c.state === 'eat') ate = true;
    }
    expect(ate).toBe(true);
    stepFor(w, 6);
    expect(c.energy).toBeGreaterThan(e0);
    expect(c.firstMealT).toBeGreaterThan(0);
  });

  it('prey flees from a hunting predator', () => {
    const w = emptyWorld('flee');
    const prey = addAdult(w, herbGenome('prey'), 700, 450, 1, 0.7);
    const pred = addAdult(w, predGenome('hunter'), 560, 450, PRED_SPECIES, 0.2);
    let fled = false;
    for (let i = 0; i < 30 * 12 && !fled; i++) {
      w.step(1 / 30);
      if (prey.state === 'flee') fled = true;
    }
    expect(fled).toBe(true);
    expect(pred.state === 'hunt' || pred.state === 'eat').toBe(true);
  });

  it('a hungry predator stalks and closes in on visible prey', () => {
    const w = emptyWorld('hunt');
    // a brightly colored prey in open water, within the hunter's sight
    const g = herbGenome('prey2');
    g.g[G.hue] = 0.02;
    const prey = addAdult(w, g, 710, 450, 1, 0.7);
    const pred = addAdult(w, predGenome('hunter2'), 600, 450, PRED_SPECIES, 0.2);
    const d0 = Math.hypot(prey.x - pred.x, prey.y - pred.y);
    let hunted = false;
    let closest = d0;
    for (let i = 0; i < 30 * 10; i++) {
      w.step(1 / 30);
      if (pred.state === 'hunt') hunted = true;
      if (prey.dying > 0) break;
      closest = Math.min(closest, Math.hypot(prey.x - pred.x, prey.y - pred.y));
    }
    expect(hunted).toBe(true);
    expect(closest).toBeLessThan(d0 * 0.8);
  });

  it('creatures never leave the water', () => {
    const w = emptyWorld('bounds');
    for (let i = 0; i < 20; i++) addAdult(w, herbGenome('b' + i), 100 + i * 70, 200 + (i % 5) * 120);
    stepFor(w, 120);
    for (const c of w.creatures) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(w.width);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThanOrEqual(w.groundAt(c.x) + 1);
    }
  });
});
