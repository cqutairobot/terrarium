import { describe, expect, it } from 'vitest';
import { createCorpse } from '../src/sim/spawn';
import { updateProducers } from '../src/sim/systems/producers';
import { World } from '../src/sim/world';
import { addAdult, addPlant, emptyWorld, herbGenome, stepFor } from './helpers';

describe('matter cycle', () => {
  it('conserves matter exactly: everything is either in the tank, lost as heat, or exchanged with the sediment', () => {
    const w = new World({ seed: 'ledger', aspect: 16 / 9 });
    const start = w.totalMatter();
    stepFor(w, 600);
    const now = w.totalMatter();
    const balance = now + w.ledger.heat - w.ledger.inflow - w.ledger.feed;
    expect(Math.abs(balance - start) / start).toBeLessThan(1e-9);
    // and the cycle is actually turning
    expect(w.ledger.heat).toBeGreaterThan(100);
    expect(w.counters.births + w.counters.deaths).toBeGreaterThan(5);
  });

  it('plants do not grow in darkness but do grow in light', () => {
    const grow = (light: number) => {
      const w = emptyWorld('dark');
      const p = addPlant(w, 400, 0.3);
      w.env.nutrient.fill(30);
      w.env.light = light;
      w.env.lightAvg = light;
      const b0 = p.biomass;
      for (let i = 0; i < 40; i++) updateProducers(w, 0.5);
      return p.biomass - b0;
    };
    expect(grow(0)).toBeCloseTo(0, 9);
    expect(grow(1)).toBeGreaterThan(1);
  });

  it('plant growth takes nutrients out of the water', () => {
    const w = emptyWorld('uptake');
    addPlant(w, 400, 0.3);
    w.env.nutrient.fill(30);
    w.env.light = 1;
    w.env.lightAvg = 1;
    const n0 = w.env.totalNutrient();
    const b0 = w.livingBiomass();
    for (let i = 0; i < 40; i++) updateProducers(w, 0.5);
    const grown = w.livingBiomass() - b0;
    expect(grown).toBeGreaterThan(1);
    expect(n0 - w.env.totalNutrient()).toBeCloseTo(grown, 6);
  });

  it('remains decay into detritus, and detritus into nutrients', () => {
    const w = emptyWorld('decay');
    const c = addAdult(w, herbGenome('d'), 600, 500);
    const corpse = createCorpse(w.newId(), c);
    w.addCorpse(corpse);
    const mass = corpse.biomass;
    expect(mass).toBeGreaterThan(10);
    w.creatures.length = 0;
    w.creatureMap.clear();
    stepFor(w, 120);
    expect(corpse.biomass).toBeLessThan(mass);
    const detritusAndNutrient = w.env.totalDetritus() + w.env.totalNutrient();
    expect(detritusAndNutrient).toBeGreaterThan(0);
    stepFor(w, 400);
    expect(w.env.totalNutrient()).toBeGreaterThan(w.env.totalDetritus() * 0.5);
  });
});
