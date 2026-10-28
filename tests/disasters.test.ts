import { describe, expect, it } from 'vitest';
import { updateProducers } from '../src/sim/systems/producers';
import { thermalStress } from '../src/sim/systems/metabolism';
import { World } from '../src/sim/world';
import { addAdult, addPlant, emptyWorld, herbGenome, stepFor } from './helpers';

describe('disasters have real effects', () => {
  it('a cold wave chills the water, slows plants and metabolism', () => {
    const w = emptyWorld('cold');
    const p = addPlant(w, 400, 0.3);
    const c = addAdult(w, herbGenome('c'), 500, 500);
    w.env.nutrient.fill(30);
    stepFor(w, 5);
    const t0 = w.env.temperature;
    const q0 = w.env.q10();
    const stress0 = thermalStress(c, w.env.temperature);
    w.disaster('coldwave');
    stepFor(w, 60);
    expect(w.env.temperature).toBeLessThan(t0 - 0.2);
    expect(w.env.q10()).toBeLessThan(q0 * 0.85);
    expect(thermalStress(c, w.env.temperature)).toBeGreaterThan(stress0);
    // plant growth under the cold compared with a twin world at normal temperature
    const grow = (world: World) => {
      const b0 = world.producers[0].biomass;
      world.env.lightAvg = 1;
      for (let i = 0; i < 20; i++) updateProducers(world, 0.5);
      return world.producers[0].biomass - b0;
    };
    const warm = emptyWorld('cold');
    addPlant(warm, 400, 0.3);
    warm.env.nutrient.fill(30);
    stepFor(warm, 65);
    p.biomass = 40;
    warm.producers[0].biomass = 40;
    expect(grow(w)).toBeLessThan(grow(warm) * 0.8);
  });

  it('a storm stirs the water into turbulence', () => {
    const w = emptyWorld('storm');
    w.disaster('storm');
    stepFor(w, 40);
    expect(w.env.turbulence).toBeGreaterThan(0.5);
    expect(w.env.lightWeather).toBeLessThan(0.75);
  });

  it('a meteor strikes where it falls, leaving star-stuff and nutrients', () => {
    const w = emptyWorld('meteor');
    const victim = addAdult(w, herbGenome('v'), 600, 600);
    const far = addAdult(w, herbGenome('f'), 1500, 300);
    const feed0 = w.ledger.feed;
    w.disaster('meteor', 600, 600);
    stepFor(w, 3);
    expect(victim.dying > 0 || victim.health < victim.ph.maxHealth * 0.5).toBe(true);
    expect(far.dying).toBe(0);
    expect(w.ledger.feed).toBeGreaterThan(feed0);
    expect(Math.max(...w.env.stardust)).toBeGreaterThan(0.5);
  });

  it('every disaster ends with a summary computed from what happened', () => {
    const w = new World({ seed: 'summary', aspect: 16 / 9 });
    stepFor(w, 30);
    w.disaster('bloom');
    stepFor(w, 200);
    const end = w.history.log.toArray().find((e) => e.k === 'disasterEnd');
    expect(end).toBeTruthy();
    expect(typeof end!.p.plantPct).toBe('number');
    expect(end!.p.kind).toBe('bloom');
    // a bloom should not shrink the meadow
    expect(Number(end!.p.plantPct)).toBeGreaterThan(-10);
  });

  it('feeding adds real food that grazers can find, and the ledger notices', () => {
    const w = emptyWorld('feed');
    const before = w.totalMatter();
    const n = w.feed('pellet', 500, 300, 6);
    expect(n).toBe(6);
    expect(w.foods).toHaveLength(6);
    expect(w.totalMatter() - before).toBeCloseTo(w.ledger.feed, 9);
  });
});
