import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/core/rng';
import { express, G, genomeFromTemplate, N_GENES, type GeneKey, type Genome } from '../src/sim/genome';
import { emptyAlleles } from '../src/sim/rareTraits';

function genomeWith(overrides: Partial<Record<GeneKey, number>>): Genome {
  const g = new Array(N_GENES).fill(0.5);
  for (const [k, v] of Object.entries(overrides)) g[G[k as GeneKey]] = v as number;
  return { g, rare: emptyAlleles() };
}

describe('phenotype mapping', () => {
  it('bigger bodies carry more energy and cost more to run', () => {
    const small = express(genomeWith({ size: 0.2 }));
    const big = express(genomeWith({ size: 0.8 }));
    expect(big.radius).toBeGreaterThan(small.radius);
    expect(big.maxEnergy).toBeGreaterThan(small.maxEnergy);
    expect(big.basalFactor).toBeGreaterThan(small.basalFactor);
    // Kleiber: cost grows slower than mass
    expect(big.basalFactor / small.basalFactor).toBeLessThan(big.mass / small.mass);
    expect(big.maturityAge).toBeGreaterThan(small.maturityAge);
  });

  it('speed and perception have running costs', () => {
    const slow = express(genomeWith({ speed: 0.1 }));
    const fast = express(genomeWith({ speed: 0.9 }));
    expect(fast.maxSpeed).toBeGreaterThan(slow.maxSpeed);
    const myopic = express(genomeWith({ perception: 0.1 }));
    const keen = express(genomeWith({ perception: 0.9 }));
    expect(keen.senseRadius).toBeGreaterThan(myopic.senseRadius);
    expect(keen.senseCost).toBeGreaterThan(myopic.senseCost);
  });

  it('armor protects but slows', () => {
    const soft = express(genomeWith({ armor: 0.1 }));
    const hard = express(genomeWith({ armor: 0.9 }));
    expect(hard.defense).toBeGreaterThan(soft.defense);
    expect(hard.maxSpeed).toBeLessThan(soft.maxSpeed);
  });

  it('fast metabolism means a shorter life', () => {
    const calm = express(genomeWith({ metabolism: 0.1 }));
    const hot = express(genomeWith({ metabolism: 0.9 }));
    expect(hot.lifespan).toBeLessThan(calm.lifespan);
    expect(hot.reproCooldown).toBeLessThan(calm.reproCooldown);
  });

  it('diet trades plant digestion for meat digestion', () => {
    const herb = express(genomeWith({ diet: 0.05 }));
    const omni = express(genomeWith({ diet: 0.5 }));
    const carn = express(genomeWith({ diet: 0.95 }));
    expect(herb.herbEff).toBeGreaterThan(0.7);
    expect(carn.carnEff).toBeGreaterThan(0.7);
    expect(herb.trophic).toBe('herbivore');
    expect(omni.trophic).toBe('omnivore');
    expect(carn.trophic).toBe('carnivore');
    // the generalist is worse at both than the specialists
    expect(omni.herbEff).toBeLessThan(herb.herbEff * 0.5);
    expect(omni.carnEff).toBeLessThan(carn.carnEff * 0.5);
  });

  it('r/K strategy: fertile genomes invest less per offspring', () => {
    const k = express(genomeWith({ fertility: 0.1 }));
    const r = express(genomeWith({ fertility: 0.9 }));
    expect(r.investFraction).toBeLessThan(k.investFraction);
    expect(r.reproThreshold).toBeLessThan(k.reproThreshold);
    expect(r.twinChance).toBeGreaterThan(k.twinChance);
  });

  it('every decoded value is finite for random genomes', () => {
    const rng = new Rng('finite');
    for (let i = 0; i < 200; i++) {
      const g = genomeFromTemplate({}, rng, 0.35);
      const ph = express(g);
      for (const [k, v] of Object.entries(ph)) {
        if (typeof v === 'number') expect(Number.isFinite(v), k).toBe(true);
      }
    }
  });
});
