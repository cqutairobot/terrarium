import { describe, expect, it } from 'vitest';
import { bond, forecastBrood, pairProblem, unbond } from '../src/game/breeding';
import { canBuy, priceOf, rewardFor, SHOP } from '../src/game/economy';
import { newProfile } from '../src/game/profile';
import type { StoryEvent } from '../src/sim/history/narrator';
import { introduceFounders, scatterSeeds } from '../src/sim/systems/ecology';
import type { World } from '../src/sim/world';
import { addAdult, emptyWorld, herbGenome, predGenome, PRED_SPECIES, stepFor } from './helpers';

const balance = (w: World) => w.totalMatter() + w.ledger.heat - w.ledger.inflow - w.ledger.feed - w.ledger.moved;

describe('pairing and breeding forecasts', () => {
  it('forecasts Mendelian odds and trait ranges from real crossings', () => {
    const w = emptyWorld('forecast');
    w.env.mutationSet = 0;
    const ga = herbGenome('fa');
    const gb = herbGenome('fb');
    // both carry one golden allele: a quarter of the young should be golden
    ga.rare[0] = 1;
    gb.rare[1] = 1;
    const a = addAdult(w, ga, 400, 400);
    const b = addAdult(w, gb, 420, 400);
    const f = forecastBrood(w, a, b, 800);
    const golden = f.rare.find((r) => r.key === 'golden');
    expect(golden).toBeTruthy();
    expect(golden!.chance).toBeGreaterThan(0.19);
    expect(golden!.chance).toBeLessThan(0.31);
    expect(f.compat).toBeGreaterThan(0.9);
    expect(f.surprise).toBe(0);
    const size = f.traits.find((t) => t.measure === 'size')!;
    expect(size.low).toBeLessThanOrEqual(size.mid);
    expect(size.mid).toBeLessThanOrEqual(size.high);
    expect(size.high).toBeLessThanOrEqual(Math.max(size.a, size.b) * 1.05);
    // forecasting leaves the world's own randomness untouched
    const before = w.rng.getState();
    forecastBrood(w, a, b, 50);
    expect(w.rng.getState()).toEqual(before);
  });

  it('a matched pair courts only each other', () => {
    const w = emptyWorld('bonded');
    w.env.mutationSet = 0;
    const a = addAdult(w, herbGenome('ba'), 300, 450, undefined, 1);
    const b = addAdult(w, herbGenome('bb'), 1300, 450, undefined, 1);
    const tempter = addAdult(w, herbGenome('bc'), 330, 450, undefined, 1);
    expect(pairProblem(a, b)).toBeNull();
    bond(w, a, b);
    expect([a.bondId, b.bondId]).toEqual([b.id, a.id]);
    let eggs: { parentA: number; parentB: number } | null = null;
    for (let i = 0; i < 30 * 120 && !eggs; i++) {
      for (const c of [a, b, tempter]) c.energy = c.ph.maxEnergy;
      w.step(1 / 30);
      for (const e of w.lastEvents) if (e.t === 'eggs' && !eggs) eggs = e;
    }
    expect(eggs).toBeTruthy();
    expect(new Set([eggs!.parentA, eggs!.parentB])).toEqual(new Set([a.id, b.id]));
    expect(tempter.children).toBe(0);
    unbond(w, a);
    expect([a.bondId, b.bondId]).toEqual([0, 0]);
  });

  it('will not match a hunter with its prey', () => {
    const w = emptyWorld('mismatch');
    const prey = addAdult(w, herbGenome('p'), 300, 400);
    const hunter = addAdult(w, predGenome('h'), 600, 400, PRED_SPECIES);
    expect(pairProblem(prey, hunter)).toBeTruthy();
    expect(pairProblem(prey, prey)).toBeTruthy();
  });
});

describe('lumen and the shop', () => {
  it('pays for real discoveries, more for the first ever', () => {
    const p = newProfile(0);
    const e = { id: 1, t: 10, w: 0, k: 'rareFirst', i: 3, p: { key: 'golden', trait: '金色身体' } } as StoryEvent;
    const first = rewardFor(e, p)!;
    expect(first.amount).toBe(50);
    p.flags[first.flag!] = 1;
    expect(rewardFor(e, p)!.amount).toBe(15);
    expect(rewardFor({ ...e, k: 'disasterStart' } as StoryEvent, p)).toBeNull();
  });

  it('prices repeatable items up and refuses what is not affordable', () => {
    const p = newProfile(0);
    const slot = SHOP.find((i) => i.id === 'tank-slot')!;
    expect(canBuy(p, slot)).toEqual({ ok: false, why: '灵光不够' });
    p.lumen = 10_000;
    expect(canBuy(p, slot).ok).toBe(true);
    const first = priceOf(p, slot);
    p.unlocks.push('tank-slot');
    expect(priceOf(p, slot)).toBe(first * 2);
    const lens = SHOP.find((i) => i.id === 'lens')!;
    p.unlocks.push('lens');
    expect(canBuy(p, lens)).toEqual({ ok: false, why: '已拥有' });
  });

  it('bought life and seeds are made of the tank’s own matter', () => {
    const w = emptyWorld('shop-life');
    w.env.nutrient.fill(40);
    stepFor(w, 1);
    const before = balance(w);
    const born = introduceFounders(w, 'drifter', 6);
    expect(born).toHaveLength(6);
    expect(new Set(born.map((c) => c.speciesId)).size).toBe(1);
    expect(w.species.get(born[0].speciesId)?.population).toBe(6);
    expect(scatterSeeds(w, 6)).toBe(6);
    expect(balance(w)).toBeCloseTo(before, 6);
    stepFor(w, 20);
    expect(balance(w)).toBeCloseTo(before, 4);
  });
});
