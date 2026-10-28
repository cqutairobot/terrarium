import { describe, expect, it } from 'vitest';
import {
  describeCondition,
  describeSpec,
  evaluate,
  inHueBand,
  matchesSpec,
  newTracker,
  plantCoverage,
  specCloseness,
  type CreatureSpec,
} from '../src/game/conditions';
import { express, G } from '../src/sim/genome';
import { COLOR_BANDS } from '../src/sim/names';
import { addAdult, addPlant, emptyWorld, herbGenome, HERB_SPECIES, PRED_SPECIES, predGenome, stepFor } from './helpers';

const band = (word: string) => COLOR_BANDS.find((b) => b.word === word)!;

describe('goal conditions', () => {
  it('describes and recognizes the creature a request asks for', () => {
    const w = emptyWorld('spec');
    const g = herbGenome('blue');
    g.g[G.hue] = 0.6;
    g.g[G.tentacles] = 1;
    const c = addAdult(w, g, 500, 400);
    const spec: CreatureSpec = { hue: band('蓝色'), ranges: { tentacles: [3, null] }, adult: true };
    expect(c.ph.tentacleCount).toBeGreaterThanOrEqual(3);
    expect(matchesSpec(c, spec)).toBe(true);
    expect(describeSpec(spec)).toBe('蓝色、至少 3 根触须的成年生命');
    const red: CreatureSpec = { ...spec, hue: band('绯红') };
    expect(matchesSpec(c, red)).toBe(false);
    expect(specCloseness(c, red)).toBeCloseTo(2 / 3, 6);
    // the red band wraps around the color wheel
    expect(inHueBand(0.98, band('绯红'))).toBe(true);
    expect(inHueBand(0.01, band('绯红'))).toBe(true);
    expect(inHueBand(0.5, band('绯红'))).toBe(false);
  });

  it('counts kinds of life and species from the living, not the eggs or the departing', () => {
    const w = emptyWorld('counts');
    for (let i = 0; i < 3; i++) addAdult(w, herbGenome('h' + i), 300 + i * 60, 400);
    addAdult(w, predGenome('p'), 900, 300, PRED_SPECIES);
    stepFor(w, 1);
    expect(evaluate(w, { k: 'population', who: 'consumer', min: 3 }).met).toBe(true);
    expect(evaluate(w, { k: 'population', who: 'predator', min: 2 })).toMatchObject({ met: false, progress: 0.5, value: 1 });
    expect(evaluate(w, { k: 'species', min: 2 }).met).toBe(true);
    const capped = evaluate(w, { k: 'population', who: 'consumer', max: 2 });
    expect(capped.met).toBe(false);
    expect(capped.progress).toBeCloseTo(2 / 3, 6);
    expect(w.species.get(HERB_SPECIES)).toBeTruthy();
  });

  it('holds a condition for a while before it counts', () => {
    const w = emptyWorld('hold');
    addAdult(w, herbGenome('a'), 300, 400);
    const tracker = newTracker();
    const goal = { k: 'hold', seconds: 30, cond: { k: 'population', who: 'consumer', min: 1 } } as const;
    expect(evaluate(w, goal, tracker).met).toBe(false);
    stepFor(w, 20);
    const mid = evaluate(w, goal, tracker);
    expect(mid.met).toBe(false);
    expect(mid.progress).toBeGreaterThan(0.75);
    stepFor(w, 11);
    expect(evaluate(w, goal, tracker).met).toBe(true);
    // when it stops being true, the clock starts over
    for (const c of w.creatures) c.dying = 1;
    expect(evaluate(w, goal, tracker).met).toBe(false);
    expect(tracker.since).toEqual({});
    expect(describeCondition(goal)).toBe('让小生命达到 1 只，并保持 30秒');
  });

  it('measures the meadow and the mean of a quality', () => {
    const w = emptyWorld('meadow');
    for (let i = 0; i < 16; i++) addPlant(w, 40 + i * 110, 0.9);
    const cover = plantCoverage(w);
    expect(cover).toBeGreaterThan(0.2);
    expect(evaluate(w, { k: 'plants', min: 0.1 }).met).toBe(true);
    const big = herbGenome('big');
    big.g[G.size] = 0.9;
    addAdult(w, big, 500, 400);
    const r = express(big).radius;
    expect(evaluate(w, { k: 'mean', measure: 'size', min: r - 0.1 }).met).toBe(true);
    expect(evaluate(w, { k: 'all', of: [{ k: 'plants', min: 0.1 }, { k: 'generation', min: 3 }] })).toMatchObject({ met: false, value: 1 });
  });
});
