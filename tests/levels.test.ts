import { describe, expect, it } from 'vitest';
import { describeCondition, evaluate, plantCoverage } from '../src/game/conditions';
import { newProfile } from '../src/game/profile';
import { CHAPTER_1 } from '../src/game/levels/chapter1';
import { PLANS, playLevel } from '../src/game/levels/bots';
import { dailyLevel, dailyUnlocked, levelById, levelUnlocked, nextLevel } from '../src/game/levels';
import { levelFeed, levelPair, levelRelease } from '../src/game/levels/actions';
import { LevelRun } from '../src/game/levels/run';
import { createLevelWorld } from '../src/game/levels/setup';
import type { LevelDef } from '../src/game/levels/types';
import { maxEnergyOf } from '../src/sim/behavior/perception';
import { alleleCount } from '../src/sim/rareTraits';
import { G } from '../src/sim/genome';
import { World } from '../src/sim/world';
import { addAdult, emptyWorld, herbGenome, predGenome, PRED_SPECIES, stepFor } from './helpers';

/** A small level for exercising the runner. */
function testLevel(over: Partial<LevelDef> = {}): LevelDef {
  return {
    id: 't-1',
    chapter: 1,
    index: 1,
    name: '测试',
    intro: '',
    outro: '',
    seed: 'level-test',
    setup: [{ k: 'founders', arch: 'schooler', count: 6, adult: true }],
    goals: [{ cond: { k: 'population', who: 'consumer', min: 6 } }],
    timeLimit: 60,
    tools: { food: 2, pair: 1, release: 1 },
    stars: [
      { k: 'time', under: 30 },
      { k: 'spare', tool: 'food', atLeast: 1 },
    ],
    reward: { lumen: 30 },
    ...over,
  };
}

/** Run a level's own clock for a while, a simulated second at a time. */
function runFor(run: LevelRun, w: World, seconds: number): void {
  for (let s = 0; s < seconds && run.status === 'playing'; s++) {
    stepFor(w, 1);
    run.update(w);
  }
}

describe('challenge tanks', () => {
  it('an empty tank still has its dissolved nutrients, so newcomers arrive well fed', () => {
    const w = new World({ seed: 'empty', aspect: 16 / 9, lifeless: true });
    expect(w.creatures.length).toBe(0);
    const dissolved = w.env.nutrient.reduce((a, v) => a + v, 0);
    expect(dissolved).toBeGreaterThan(w.matterTarget() * 0.3);
    const def = testLevel({ setup: [{ k: 'founders', arch: 'browser', count: 5, adult: true, energy: 0.6 }] });
    const lw = createLevelWorld(def);
    for (const c of lw.creatures) {
      expect(c.stage).toBe('adult');
      expect(c.energy / maxEnergyOf(c)).toBeGreaterThan(0.5);
    }
  });

  it('sets up founders with chosen genes, odd ones out and hidden alleles, and thins the meadow', () => {
    const def = testLevel({
      setup: [
        { k: 'thin', kind: 'plant', keep: 4 },
        { k: 'thin', kind: 'algae', keep: 2 },
        {
          k: 'founders',
          arch: 'schooler',
          count: 10,
          adult: true,
          genes: { hue: 0.37 },
          some: { count: 3, genes: { hue: 0.505 } },
          alleles: [{ key: 'golden', homo: 1, hetero: 2 }],
        },
      ],
    });
    const w = createLevelWorld(def);
    const before = w.totalMatter() + w.ledger.heat - w.ledger.inflow - w.ledger.feed - w.ledger.moved;
    expect(w.producers.filter((p) => p.kind === 'plant').length).toBe(4);
    expect(w.producers.filter((p) => p.kind === 'algae').length).toBe(2);
    const fish = [...w.creatures].sort((a, b) => a.id - b.id);
    expect(fish.length).toBe(10);
    expect(fish.filter((c) => Math.abs(c.genome.g[G.hue] - 0.505) < 1e-9).length).toBe(3);
    expect(fish.filter((c) => Math.abs(c.genome.g[G.hue] - 0.37) < 1e-9).length).toBe(7);
    expect(fish.filter((c) => c.ph.rare.golden).length).toBe(1);
    expect(fish.filter((c) => alleleCount(c.genome.rare, 0) === 1).length).toBe(2);
    // one species, as one group of founders
    expect(new Set(fish.map((c) => c.speciesId)).size).toBe(1);
    // the matter ledger stays whole through the setup and after
    stepFor(w, 20);
    const after = w.totalMatter() + w.ledger.heat - w.ledger.inflow - w.ledger.feed - w.ledger.moved;
    expect(Math.abs(after - before)).toBeLessThan(1e-6 * Math.max(1, before));
  });

  it('wins at once when instant goals are met, grading the stars', () => {
    const w = createLevelWorld(testLevel());
    const run = new LevelRun(testLevel(), w);
    runFor(run, w, 5);
    expect(run.status).toBe('won');
    expect(run.endT).toBeLessThan(30);
    // met fast, and no food used: all three stars
    expect(run.starHits).toEqual([true, true, true]);
    expect(run.stars).toBe(3);
  });

  it('judges end-of-time goals only when time runs out, and loses on a failure', () => {
    const def = testLevel({ goals: [{ cond: { k: 'population', who: 'consumer', min: 3 }, atEnd: true }], timeLimit: 20 });
    const w = createLevelWorld(def);
    const run = new LevelRun(def, w);
    runFor(run, w, 10);
    expect(run.status).toBe('playing');
    runFor(run, w, 15);
    expect(run.status).toBe('won');
    expect(run.endT).toBeGreaterThanOrEqual(20);

    const lose = testLevel({
      goals: [{ cond: { k: 'population', who: 'consumer', min: 50 } }],
      fails: [{ cond: { k: 'population', who: 'consumer', max: 20 }, say: '太少了', after: 3 }],
    });
    const w2 = createLevelWorld(lose);
    const run2 = new LevelRun(lose, w2);
    runFor(run2, w2, 2);
    expect(run2.status).toBe('playing');
    runFor(run2, w2, 3);
    expect(run2.status).toBe('lost');
    expect(run2.reason).toBe('太少了');

    const late = testLevel({ goals: [{ cond: { k: 'population', who: 'consumer', min: 500 } }], timeLimit: 8 });
    const w3 = createLevelWorld(late);
    const run3 = new LevelRun(late, w3);
    runFor(run3, w3, 12);
    expect(run3.status).toBe('lost');
    expect(run3.reason).toBe('时间到了');
  });

  it('counts every tool use against the budget', () => {
    const def = testLevel({ goals: [{ cond: { k: 'population', who: 'consumer', min: 500 } }] });
    const w = createLevelWorld(def);
    const run = new LevelRun(def, w);
    expect(levelFeed(run, w, 'pellet', 400, 300)).toBe(true);
    expect(levelFeed(run, w, 'pellet', 400, 300)).toBe(true);
    expect(levelFeed(run, w, 'pellet', 400, 300)).toBe(false);
    expect(run.left('food')).toBe(0);
    // not given at all
    expect(levelFeed(run, w, 'rich', 400, 300)).toBe(false);
    expect(run.left('disaster:storm')).toBe(0);
    const [a, b, c] = w.creatures;
    expect(levelPair(run, w, a, a)).not.toBeNull();
    expect(levelPair(run, w, a, b)).toBeNull();
    expect(a.bondId).toBe(b.id);
    expect(levelPair(run, w, b, c)).toBe('这一关的配对次数用完了');
    expect(levelRelease(run, w, c.id)).toBe(true);
    expect(w.creatureMap.has(c.id)).toBe(false);
    expect(levelRelease(run, w, a.id)).toBe(false);
  });

  it('announces a disaster ahead of time, then brings it where the life crowds', () => {
    const def = testLevel({
      goals: [{ cond: { k: 'population', who: 'consumer', min: 500 } }],
      events: [
        { k: 'disaster', at: 6, kind: 'coldwave', warn: 4, say: '寒潮要来了' },
        { k: 'founders', at: 3, step: { k: 'founders', arch: 'lurker', count: 1, adult: true }, say: '来了个大家伙' },
      ],
    });
    const w = createLevelWorld(def);
    const run = new LevelRun(def, w);
    runFor(run, w, 1);
    expect(run.warnings.length).toBe(0);
    runFor(run, w, 3);
    expect(run.warnings.map((x) => x.kind)).toEqual(['coldwave']);
    expect(run.messages).toContain('寒潮要来了');
    expect(w.creatures.filter((c) => c.ph.trophic === 'carnivore').length).toBe(1);
    expect(run.messages).toContain('来了个大家伙');
    runFor(run, w, 4);
    expect(run.warnings.length).toBe(0);
    expect(w.env.events.some((e) => e.kind === 'coldwave')).toBe(true);
  });

  it('judges shares, extinction and upper bounds', () => {
    const w = emptyWorld('share');
    const blue = { from: 0.47, to: 0.545, word: '湖蓝色' };
    for (let i = 0; i < 4; i++) {
      const g = herbGenome('s' + i);
      g.g[G.hue] = i === 0 ? 0.5 : 0.35;
      addAdult(w, g, 300 + i * 50, 400);
    }
    addAdult(w, predGenome(), 900, 400, PRED_SPECIES);
    w.rebuildGrids();
    const share = evaluate(w, { k: 'share', spec: { hue: blue }, min: 0.5 });
    expect(share.value).toBeCloseTo(0.25, 6);
    expect(share.met).toBe(false);
    expect(share.progress).toBeCloseTo(0.5, 6);
    expect(evaluate(w, { k: 'matching', spec: { hue: blue }, max: 1 }).met).toBe(true);
    expect(evaluate(w, { k: 'extinct', who: 'predator' }).met).toBe(false);
    expect(evaluate(w, { k: 'extinct', who: 'consumer' }).met).toBe(false);
    for (const c of w.creatures.filter((c) => c.ph.trophic === 'carnivore')) c.dying = 1;
    expect(evaluate(w, { k: 'extinct', who: 'predator' }).met).toBe(true);
    expect(describeCondition({ k: 'share', spec: { hue: blue }, min: 0.5 })).toBe('让湖蓝色的生命占全部小生命的 50% 以上');
    expect(plantCoverage(w)).toBe(0);
  });
});

describe('chapter one', () => {
  it('every level is well formed and opens after the one before', () => {
    const p = newProfile(0);
    for (const def of CHAPTER_1) {
      expect(def.goals.length).toBeGreaterThan(0);
      expect(def.intro.length).toBeGreaterThan(10);
      expect(levelById(def.id)).toBe(def);
      // an instant goal and an end-of-time goal never mix in one level
      expect(new Set(def.goals.map((g) => !!g.atEnd)).size).toBe(1);
    }
    expect(levelUnlocked(p, CHAPTER_1[0])).toBe(true);
    expect(levelUnlocked(p, CHAPTER_1[1])).toBe(false);
    p.levels['1-1'] = { stars: 1 };
    expect(levelUnlocked(p, CHAPTER_1[1])).toBe(true);
    expect(nextLevel(CHAPTER_1[0])).toBe(CHAPTER_1[1]);
    expect(nextLevel(CHAPTER_1[CHAPTER_1.length - 1])).toBeUndefined();
  });

  it('a daily challenge is the same for everyone on a day, and opens after the basics', () => {
    const a = dailyLevel('2026-10-28');
    const b = dailyLevel('2026-10-28');
    expect(a).toEqual(b);
    expect(a.id).toBe('daily-2026-10-28');
    expect(a.seed).toBe('daily-2026-10-28');
    expect(levelById(a.id)?.name).toBe(a.name);
    const names = new Set(Array.from({ length: 20 }, (_, i) => dailyLevel(`2026-11-${String(i + 1).padStart(2, '0')}`).name));
    expect(names.size).toBeGreaterThan(2);
    const p = newProfile(0);
    expect(dailyUnlocked(p)).toBe(false);
    p.levels['1-3'] = { stars: 2 };
    expect(dailyUnlocked(p)).toBe(true);
  });

  // the quick levels are played in full: doing nothing loses, the intended idea wins
  for (const id of ['1-1', '1-2', '1-4']) {
    it(`level ${id}: idle loses, the plan wins`, () => {
      const def = CHAPTER_1.find((l) => l.id === id)!;
      expect(playLevel(def).run.status).toBe('lost');
      expect(playLevel(def, PLANS[id]).run.status).toBe('won');
    });
  }
});
