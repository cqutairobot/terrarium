import { describe, expect, it } from 'vitest';
import { Series, type Sample } from '../src/sim/history/series';
import { narrate } from '../src/sim/history/narrator';
import { killCreature } from '../src/sim/systems/life';
import { layEggs } from '../src/sim/systems/reproduction';
import { MemoryStorage } from '../src/persist/storage';
import { restoreWorld, snapshotWorld } from '../src/sim/serialize';
import { World } from '../src/sim/world';
import { addAdult, emptyWorld, herbGenome, HERB_SPECIES, stepFor } from './helpers';

function sample(t: number): Sample {
  return {
    t,
    w: t * 1000,
    cons: 100,
    pred: 5,
    eggs: 1,
    plants: 80,
    algae: 20,
    fungi: 10,
    plantMass: 5000,
    coverage: 0.5,
    births: 2,
    deaths: 1,
    lifespan: 400,
    size: 8,
    speed: 50,
    sense: 150,
    metab: 1,
    maxGen: Math.floor(t / 100),
    temp: 0.5,
    light: 1,
    nutrient: 30000,
    species: [[1, 100]],
  };
}

describe('history', () => {
  it('records the world’s birth and its first offspring exactly once', () => {
    const w = new World({ seed: 'firsts', aspect: 16 / 9 });
    stepFor(w, 120);
    const kinds = w.history.chronicle.map((e) => e.k);
    expect(kinds.filter((k) => k === 'worldBorn')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'firstBirth').length).toBeLessThanOrEqual(1);
    if (w.counters.births > 0 && w.creatures.some((c) => c.parentA)) expect(kinds).toContain('firstBirth');
    for (const e of w.history.chronicle) expect(narrate(e).length).toBeGreaterThan(4);
  });

  it('announces the last of a kind when a species dies out', () => {
    const w = emptyWorld('extinct');
    const a = addAdult(w, herbGenome('only'), 500, 400);
    w.species.get(HERB_SPECIES)!.population = 1;
    w.step(1 / 30);
    killCreature(w, a, 'age');
    w.history.process(0);
    const ev = w.history.chronicle.filter((e) => e.k === 'firstExtinction' || e.k === 'speciesExtinct');
    expect(ev).toHaveLength(1);
    expect(String(ev[0].p.species)).toBe('测试族');
  });

  it('opens a codex entry the first time a rare trait is born, and only then', () => {
    const w = emptyWorld('codex');
    const ga = herbGenome('ra');
    const gb = herbGenome('rb');
    // both parents homozygous for the recessive golden allele: every child is golden
    ga.rare[0] = ga.rare[1] = 1;
    gb.rare[0] = gb.rare[1] = 1;
    const a = addAdult(w, ga, 500, 400);
    const b = addAdult(w, gb, 520, 400);
    w.env.settings.mutation = 0;
    w.env.mutationSet = 0;
    layEggs(w, a, b);
    stepFor(w, 12);
    a.reproCooldown = 0;
    b.reproCooldown = 0;
    a.energy = a.ph.maxEnergy;
    b.energy = b.ph.maxEnergy;
    layEggs(w, a, b);
    stepFor(w, 12);
    const firsts = w.history.chronicle.filter((e) => e.k === 'rareFirst' && e.p.key === 'golden');
    expect(firsts).toHaveLength(1);
    const entry = w.history.codex.get('golden')!;
    expect(entry.total).toBeGreaterThanOrEqual(2);
    expect(entry.genome.rare[0]).toBe(1);
  });

  it('notices when a rare trait vanishes and when it returns', () => {
    const w = emptyWorld('vanish');
    const g = herbGenome('gold');
    g.rare[0] = g.rare[1] = 1;
    const a = addAdult(w, g, 500, 400);
    const b = addAdult(w, g, 520, 400);
    w.env.mutationSet = 0;
    w.env.settings.mutation = 0;
    layEggs(w, a, b);
    stepFor(w, 15);
    // all golden ones leave
    for (const c of w.creatures) if (c.ph.rare.golden) killCreature(w, c, 'age');
    stepFor(w, 10);
    expect(w.history.log.toArray().some((e) => e.k === 'rareVanished')).toBe(true);
    // hidden carriers remain? none here, so the allele is gone too
    expect(w.history.chronicle.some((e) => e.k === 'rareLost')).toBe(true);
    // much later two carriers meet and the trait returns
    w.time += 700;
    const c1 = herbGenome('c1');
    const c2 = herbGenome('c2');
    c1.rare[0] = c1.rare[1] = 1;
    c2.rare[0] = c2.rare[1] = 1;
    const p1 = addAdult(w, c1, 700, 400);
    const p2 = addAdult(w, c2, 720, 400);
    layEggs(w, p1, p2);
    stepFor(w, 12);
    expect(w.history.chronicle.some((e) => e.k === 'rareReturn')).toBe(true);
  });

  it('rolls fine samples up into coarser levels and respects capacities', () => {
    const s = new Series();
    for (let i = 0; i < 400; i++) s.add(sample(i * 10));
    expect(s.levels[0].samples.length).toBe(360);
    expect(s.levels[1].samples.length).toBe(Math.floor(400 / 12));
    const merged = s.levels[1].samples[0];
    expect(merged.births).toBe(24);
    expect(merged.cons).toBe(100);
    const lastHour = s.window(3600, 'sim', 3990, 3990 * 1000);
    expect(lastHour.length).toBeGreaterThan(300);
    const lastHourReal = s.window(3600, 'real', 3990, 3990 * 1000);
    expect(lastHourReal.length).toBe(lastHour.length);
  });

  it('is saved and restored with the world', async () => {
    const w = new World({ seed: 'persist', aspect: 16 / 9 });
    stepFor(w, 60);
    const store = new MemoryStorage();
    await store.put({
      id: 'autosave',
      name: '自动存档',
      kind: 'auto',
      savedAt: 1,
      worldName: w.name,
      seed: w.seed,
      simTime: w.time,
      population: w.creatures.length,
      generation: w.counters.generationsMax,
      snapshot: snapshotWorld(w),
    });
    expect((await store.list()).map((m) => m.id)).toEqual(['autosave']);
    const rec = await store.get('autosave');
    const r = restoreWorld(rec!.snapshot);
    expect(r.history.chronicle.length).toBe(w.history.chronicle.length);
    expect(r.history.series.levels[0].samples.length).toBe(w.history.series.levels[0].samples.length);
    expect(r.history.log.length).toBe(w.history.log.length);
    await store.remove('autosave');
    expect(await store.list()).toHaveLength(0);
  });
});
