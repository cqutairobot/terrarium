import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/core/rng';
import {
  breed,
  compatibility,
  crossover,
  G,
  GENE_DEFS,
  geneticDistance,
  genomeFromTemplate,
  mutateGenes,
  N_GENES,
  type Genome,
} from '../src/sim/genome';
import { alleleCount, emptyAlleles, expressRare, inheritRare, N_RARE } from '../src/sim/rareTraits';

const NO_MUTATION = { rate: 0, sigmaScale: 1, macroChance: 0 };

function randomGenome(rng: Rng): Genome {
  return genomeFromTemplate({}, rng, 0.3);
}

describe('inheritance', () => {
  it('children inherit each gene from within their parents’ range', () => {
    const rng = new Rng('cross');
    for (let t = 0; t < 200; t++) {
      const a = randomGenome(rng);
      const b = randomGenome(rng);
      const child = crossover(a, b, rng);
      for (let i = 0; i < N_GENES; i++) {
        if (GENE_DEFS[i].circular) continue;
        expect(child[i]).toBeGreaterThanOrEqual(Math.min(a.g[i], b.g[i]) - 1e-12);
        expect(child[i]).toBeLessThanOrEqual(Math.max(a.g[i], b.g[i]) + 1e-12);
      }
    }
  });

  it('keeps population variance instead of blending it away', () => {
    const rng = new Rng('variance');
    let pop = Array.from({ length: 200 }, () => randomGenome(rng));
    const variance = (gs: Genome[]) => {
      const m = gs.reduce((s, g) => s + g.g[G.size], 0) / gs.length;
      return gs.reduce((s, g) => s + (g.g[G.size] - m) ** 2, 0) / gs.length;
    };
    const v0 = variance(pop);
    for (let gen = 0; gen < 10; gen++) {
      pop = pop.map(() => {
        const a = pop[rng.int(pop.length)];
        const b = pop[rng.int(pop.length)];
        return breed(a, b, rng, NO_MUTATION, 0).genome;
      });
    }
    // pure blending would shrink variance by ~2^10; Mendelian-style picking keeps most of it
    expect(variance(pop)).toBeGreaterThan(v0 * 0.25);
  });
});

describe('mutation', () => {
  it('does nothing at rate zero', () => {
    const rng = new Rng('m0');
    const g = randomGenome(rng).g;
    const copy = g.slice();
    const notes = mutateGenes(g, rng, NO_MUTATION);
    expect(g).toEqual(copy);
    expect(notes).toHaveLength(0);
  });

  it('mutates about `rate` of genes and scales with the world multiplier', () => {
    const rng = new Rng('mrate');
    const count = (rate: number) => {
      let changed = 0;
      let total = 0;
      for (let t = 0; t < 400; t++) {
        const g = randomGenome(rng).g;
        const before = g.slice();
        mutateGenes(g, rng, { rate, sigmaScale: 1, macroChance: 0 });
        for (let i = 0; i < N_GENES; i++) {
          total++;
          if (g[i] !== before[i]) changed++;
        }
      }
      return changed / total;
    };
    const low = count(0.05);
    const high = count(0.2);
    expect(Math.abs(low - 0.05)).toBeLessThan(0.015);
    expect(Math.abs(high - 0.2)).toBeLessThan(0.03);
  });

  it('keeps genes in [0, 1] and wraps hue around the color wheel', () => {
    const rng = new Rng('bounds');
    for (let t = 0; t < 300; t++) {
      const g = randomGenome(rng).g;
      g[G.hue] = 0.995;
      mutateGenes(g, rng, { rate: 1, sigmaScale: 3, macroChance: 0.5 });
      for (const v of g) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('Mendelian rare traits', () => {
  const carrier = (locus: number) => {
    const a = emptyAlleles();
    a[locus * 2] = 1;
    return a;
  };

  it('a recessive trait shows in about a quarter of carrier × carrier offspring', () => {
    const rng = new Rng('mendel');
    const golden = 0;
    let shown = 0;
    const n = 8000;
    for (let i = 0; i < n; i++) {
      const child = inheritRare(carrier(golden), carrier(golden), rng, 0).alleles;
      if (expressRare(child).golden) shown++;
    }
    // reversion mutations nudge it a hair below 25%
    expect(Math.abs(shown / n - 0.25)).toBeLessThan(0.02);
  });

  it('a dominant trait shows in about half of carrier × non-carrier offspring', () => {
    const rng = new Rng('dominant');
    const twin = 2;
    let shown = 0;
    const n = 8000;
    for (let i = 0; i < n; i++) {
      const child = inheritRare(carrier(twin), emptyAlleles(), rng, 0).alleles;
      if (expressRare(child).twinTail) shown++;
    }
    expect(Math.abs(shown / n - 0.5)).toBeLessThan(0.02);
  });

  it('hidden carriers can bring a vanished trait back', () => {
    const rng = new Rng('return');
    const a = carrier(6);
    const b = carrier(6);
    expect(expressRare(a).rainbow).toBe(false);
    expect(expressRare(b).rainbow).toBe(false);
    let returned = false;
    for (let i = 0; i < 50 && !returned; i++) returned = expressRare(inheritRare(a, b, rng, 0).alleles).rainbow;
    expect(returned).toBe(true);
  });

  it('new rare alleles appear only through mutation and scale with the multiplier', () => {
    const rng = new Rng('rare-mut');
    let none = 0;
    let boosted = 0;
    for (let i = 0; i < 20000; i++) {
      if (inheritRare(emptyAlleles(), emptyAlleles(), rng, 0).newMutations.length) none++;
      if (inheritRare(emptyAlleles(), emptyAlleles(), rng, 50).newMutations.length) boosted++;
    }
    expect(none).toBe(0);
    expect(boosted).toBeGreaterThan(100);
    let carried = 0;
    for (let l = 0; l < N_RARE; l++) carried += alleleCount(carrier(l), l);
    expect(carried).toBe(N_RARE);
  });
});

describe('genetic distance and compatibility', () => {
  it('is symmetric, zero for twins, and drives reproductive isolation', () => {
    const rng = new Rng('dist');
    const a = randomGenome(rng);
    const b = randomGenome(rng);
    expect(geneticDistance(a, a)).toBe(0);
    expect(geneticDistance(a, b)).toBeCloseTo(geneticDistance(b, a), 12);
    expect(compatibility(a, a, 0.22)).toBe(1);
    const near = { g: a.g.map((v) => Math.min(1, v + 0.02)), rare: a.rare };
    const far = { g: a.g.map((v) => 1 - v), rare: a.rare };
    expect(compatibility(a, near, 0.22)).toBeGreaterThan(0.95);
    expect(compatibility(a, far, 0.22)).toBeLessThan(0.05);
  });
});
