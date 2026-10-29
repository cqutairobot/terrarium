import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, newlyEarned } from '../src/game/achievements';
import { ALL_RARE_KEYS, completion, MAX_SPECIES_KEPT, recordRare, recordTank } from '../src/game/collection';
import { CHAPTER_1 } from '../src/game/levels/chapter1';
import { newProfile, normalizeProfile, type Profile } from '../src/game/profile';
import { introduceFounders } from '../src/sim/systems/ecology';
import { World } from '../src/sim/world';

const earnedIds = (p: Profile, world: World | null = null) => newlyEarned({ profile: p, world }).map((a) => a.id);

describe('the collection across tanks', () => {
  it('starts empty, and an older profile keeps the wonders it had already seen', () => {
    const p = newProfile(0);
    expect(p.collection.species).toEqual([]);
    expect(p.stats).toEqual({});
    const old = normalizeProfile({ flags: { 'rare:golden': 1, 'rare:eyes2': 1, other: 1 } } as unknown as Partial<Profile>, 0);
    expect(Object.keys(old.collection.rare).sort()).toEqual(['eyes2', 'golden']);
    expect(old.stats).toEqual({});
  });

  it('records each wonder once, with who showed it first and where', () => {
    const p = newProfile(0);
    expect(recordRare(p, 'golden', '小苔', '浮生湖心', 5)).toBe(true);
    expect(recordRare(p, 'golden', '别的', '别处', 9)).toBe(false);
    expect(p.collection.rare.golden).toEqual({ name: '小苔', tank: '浮生湖心', at: 5 });
    // combinations are not separate entries
    expect(recordRare(p, 'golden+twinTail', '小苔', '浮生湖心', 5)).toBe(false);
    expect(completion(p).rare).toBeCloseTo(1 / ALL_RARE_KEYS.length, 6);
  });

  it('records the water, the body plans and the species of a tank', () => {
    const p = newProfile(0);
    const w = new World({ seed: 'collect', aspect: 16 / 9, biome: 'reef' });
    introduceFounders(w, 'jelly', 3, { adult: true });
    w.rebuildGrids();
    expect(recordTank(p, w, 7)).toBe(true);
    expect(p.collection.waters.reef).toBe(7);
    expect(Object.keys(p.collection.forms).sort()).toEqual(['fish', 'jelly', 'shrimp']);
    expect(p.collection.species.length).toBeGreaterThan(2);
    expect(p.collection.species.some((s) => s.morph === 'jelly' && s.tank === w.name)).toBe(true);
    // nothing new the second time
    expect(recordTank(p, w, 8)).toBe(false);
    // the list of species stays bounded
    p.collection.species = Array.from({ length: MAX_SPECIES_KEPT }, (_, i) => ({ name: `族${i}`, morph: 'fish', hue: 0, tank: '', at: 0 }));
    w.species.forEach((s) => (s.name = s.name + '新'));
    recordTank(p, w, 9);
    expect(p.collection.species.length).toBe(MAX_SPECIES_KEPT);
  });
});

describe('achievements', () => {
  it('have their own ids and are earned from real play, once', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    const p = newProfile(0);
    expect(earnedIds(p)).toEqual([]);
    p.stats.feeds = 1;
    p.stats.pairs = 2;
    expect(earnedIds(p).sort()).toEqual(['first-feed', 'matchmaker']);
    p.achievements['first-feed'] = 1;
    expect(earnedIds(p)).toEqual(['matchmaker']);
  });

  it('count the wonders, the body plans and the challenges', () => {
    const p = newProfile(0);
    for (const k of ['golden', 'translucent', 'eyes1', 'eyes2']) recordRare(p, k, '', '', 0);
    expect(earnedIds(p)).toContain('golden');
    expect(earnedIds(p)).toContain('three-wonders');
    expect(earnedIds(p)).not.toContain('all-wonders');
    for (const k of ['twinTail', 'multiTentacle', 'fluorescent', 'rainbow']) recordRare(p, k, '', '', 0);
    expect(earnedIds(p)).toContain('all-wonders');
    p.collection.forms = { jelly: 1, shrimp: 1, snail: 1 };
    expect(earnedIds(p)).toContain('all-forms');
    for (const l of CHAPTER_1) p.levels[l.id] = { stars: 1 };
    expect(earnedIds(p)).toContain('chapter-1');
    expect(earnedIds(p)).not.toContain('chapter-1-stars');
    for (const l of CHAPTER_1) p.levels[l.id] = { stars: 3 };
    expect(earnedIds(p)).toContain('chapter-1-stars');
  });

  it('look at a garden tank only, never at a challenge', () => {
    const p = newProfile(0);
    const w = new World({ seed: 'gen', aspect: 16 / 9 });
    w.counters.generationsMax = 25;
    expect(earnedIds(p, w)).toContain('gen-20');
    expect(earnedIds(p, null)).not.toContain('gen-20');
  });
});
