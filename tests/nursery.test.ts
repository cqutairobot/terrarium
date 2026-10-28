import { describe, expect, it } from 'vitest';
import { hatchGenome } from '../src/sim/migration';
import { World } from '../src/sim/world';
import { herbGenome, stepFor } from './helpers';

const balance = (w: World) => w.totalMatter() + w.ledger.heat - w.ledger.inflow - w.ledger.feed - w.ledger.moved;

describe('nursery and gene cards', () => {
  it('a nursery starts with water and plants only, and no wild life finds its way in', () => {
    const w = new World({ seed: 'nursery', aspect: 1.3, config: { wildLife: false, maxPredators: 0 }, lifeless: true });
    expect(w.creatures).toHaveLength(0);
    expect(w.producers.some((p) => p.kind === 'plant')).toBe(true);
    stepFor(w, 240);
    expect(w.creatures).toHaveLength(0);
    expect(w.history.chronicle.some((e) => e.k === 'revival' || e.k === 'allGone')).toBe(false);
  });

  it('revives genes as an egg made of the tank’s own matter', () => {
    const w = new World({ seed: 'revive', aspect: 1.3, config: { wildLife: false, maxPredators: 0 }, lifeless: true });
    stepFor(w, 1);
    const before = balance(w);
    const g = herbGenome('card');
    const egg = hatchGenome(w, g, 7)!;
    expect(egg).toBeTruthy();
    expect(egg.stage).toBe('egg');
    expect(egg.generation).toBe(7);
    expect(egg.genome).not.toBe(g);
    expect(egg.genome.g).toEqual(g.g);
    expect(balance(w)).toBeCloseTo(before, 6);
    stepFor(w, 15);
    const hatched = w.creatureMap.get(egg.id)!;
    expect(hatched.stage).toBe('juvenile');
    expect(w.species.get(hatched.speciesId)?.population).toBe(1);
    expect(w.families.get(hatched.familyId)?.living).toBe(1);
    expect(balance(w)).toBeCloseTo(before, 4);
  });
});
