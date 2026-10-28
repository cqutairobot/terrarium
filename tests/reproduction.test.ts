import { describe, expect, it } from 'vitest';
import { canBreed, maxEnergyOf } from '../src/sim/behavior/perception';
import { G } from '../src/sim/genome';
import { layEggs, tryCourt } from '../src/sim/systems/reproduction';
import { addAdult, addPlant, emptyWorld, herbGenome, HERB_SPECIES, stepFor } from './helpers';

describe('reproduction', () => {
  it('two ready, compatible adults lay eggs that carry both parents', () => {
    const w = emptyWorld('repro');
    const a = addAdult(w, herbGenome('a'), 500, 400);
    const b = addAdult(w, herbGenome('b'), 520, 400);
    expect(canBreed(a)).toBe(true);
    expect(canBreed(b)).toBe(true);
    const ea = a.energy;
    const eb = b.energy;
    const laid = layEggs(w, a, b);
    expect(laid).toBeGreaterThanOrEqual(1);
    const eggs = w.creatures.filter((c) => c.stage === 'egg');
    expect(eggs).toHaveLength(laid);
    for (const egg of eggs) {
      expect(egg.parentA).toBe(a.id);
      expect(egg.parentB).toBe(b.id);
      expect(egg.generation).toBe(Math.max(a.generation, b.generation) + 1);
      expect(egg.speciesId).toBe(HERB_SPECIES);
    }
    // both parents paid for the eggs, and the eggs hold exactly what they paid
    const paid = ea - a.energy + (eb - b.energy);
    const stored = eggs.reduce((s, e) => s + e.energy, 0);
    expect(paid).toBeCloseTo(stored, 9);
    expect(a.reproCooldown).toBeGreaterThan(0);
    expect(b.reproCooldown).toBeGreaterThan(0);
    expect(canBreed(a)).toBe(false);
    expect(a.children).toBe(laid);
  });

  it('eggs hatch into juveniles and are announced as births', () => {
    const w = emptyWorld('hatch');
    const a = addAdult(w, herbGenome('a'), 500, 400);
    const b = addAdult(w, herbGenome('b'), 520, 400);
    layEggs(w, a, b);
    const egg = w.creatures.find((c) => c.stage === 'egg')!;
    let born = false;
    for (let i = 0; i < 30 * 12 && !born; i++) {
      w.step(1 / 30);
      born = w.lastEvents.some((e) => e.t === 'birth' && e.id === egg.id);
    }
    expect(born).toBe(true);
    expect(egg.stage).toBe('juvenile');
    expect(egg.structure).toBeGreaterThan(0);
    expect(egg.energy).toBeLessThanOrEqual(maxEnergyOf(egg) + 1e-9);
  });

  it('parents too poor to provision an egg lay nothing', () => {
    const w = emptyWorld('poor');
    const a = addAdult(w, herbGenome('a'), 500, 400, HERB_SPECIES, 0.16);
    const b = addAdult(w, herbGenome('b'), 520, 400, HERB_SPECIES, 0.16);
    expect(layEggs(w, a, b)).toBe(0);
    expect(w.creatures.filter((c) => c.stage === 'egg')).toHaveLength(0);
  });

  it('genetically distant partners cannot court', () => {
    const w = emptyWorld('isolation');
    const ga = herbGenome('a');
    const gb = herbGenome('b');
    gb.g = gb.g.map((v, i) => (i === G.hue ? (v + 0.5) % 1 : 1 - v));
    const a = addAdult(w, ga, 500, 400);
    const b = addAdult(w, gb, 510, 400);
    a.state = 'seekMate';
    a.targetKind = 'creature';
    a.targetId = b.id;
    for (let i = 0; i < 40; i++) tryCourt(w, a);
    expect(a.state).not.toBe('court');
    expect(b.state).not.toBe('court');
  });

  it('a courting pair in a living world eventually produces offspring', () => {
    const w = emptyWorld('courtship');
    // breeding needs a neighbourhood that can feed the young
    for (let i = 0; i < 6; i++) addPlant(w, 360 + i * 25, 0.95);
    for (let i = 0; i < 6; i++) addAdult(w, herbGenome('k' + i), 400 + i * 15, w.groundAt(400) - 120 + (i % 2) * 10);
    stepFor(w, 60);
    expect(w.creatures.some((c) => c.parentA !== 0)).toBe(true);
  });
});
