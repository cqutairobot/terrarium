import { describe, expect, it } from 'vitest';
import { emigrate, immigrate } from '../src/sim/migration';
import { layEggs } from '../src/sim/systems/reproduction';
import type { World } from '../src/sim/world';
import { addAdult, emptyWorld, herbGenome, HERB_SPECIES, stepFor } from './helpers';

/** Matter that must stay constant: what is in the tank, plus what left as heat or by moving, minus what came in. */
const balance = (w: World) => w.totalMatter() + w.ledger.heat - w.ledger.inflow - w.ledger.feed - w.ledger.moved;

describe('moving a creature between tanks', () => {
  it('carries it across with its matter accounted for on both sides', () => {
    const home = emptyWorld('home');
    const away = emptyWorld('away');
    home.name = '甲缸';
    away.name = '乙缸';
    const a = addAdult(home, herbGenome('traveller'), 500, 400);
    const b = addAdult(home, herbGenome('stays'), 540, 400);
    stepFor(home, 1);
    stepFor(away, 3);
    const homeBalance = balance(home);
    const awayBalance = balance(away);
    const t = emigrate(home, a.id, away.name)!;
    expect(t).toBeTruthy();
    expect(home.creatureMap.has(a.id)).toBe(false);
    expect(home.creatures).not.toContain(a);
    const c = immigrate(away, t);
    expect(away.creatureMap.get(c.id)).toBe(c);
    expect(c.name).toBe(a.name);
    expect(c.parentA).toBe(0);
    expect(away.families.get(c.familyId)?.founderId).toBe(c.id);
    expect(balance(home)).toBeCloseTo(homeBalance, 6);
    expect(balance(away)).toBeCloseTo(awayBalance, 6);
    // both tanks keep living without tripping over the missing creature
    b.targetKind = 'creature';
    b.targetId = a.id;
    stepFor(home, 10);
    stepFor(away, 10);
    expect(away.history.log.toArray().some((e) => e.k === 'movedIn')).toBe(true);
    expect(home.history.log.toArray().some((e) => e.k === 'movedOut')).toBe(true);
  });

  it('joins a close species in the new tank, or founds its own', () => {
    const home = emptyWorld('home2');
    const away = emptyWorld('away2');
    const kin = addAdult(away, herbGenome('kin'), 400, 400);
    away.species.get(HERB_SPECIES)!.centroid = kin.genome.g.slice();
    away.species.get(HERB_SPECIES)!.population = 1;
    const close = addAdult(home, herbGenome('kin'), 500, 400);
    const strange = addAdult(home, herbGenome('strange'), 520, 400);
    for (let i = 0; i < strange.genome.g.length; i++) strange.genome.g[i] = 1 - strange.genome.g[i];
    const c1 = immigrate(away, emigrate(home, close.id, away.name)!);
    const c2 = immigrate(away, emigrate(home, strange.id, away.name)!);
    expect(c1.speciesId).toBe(HERB_SPECIES);
    expect(c2.speciesId).not.toBe(HERB_SPECIES);
    expect(away.species.get(c2.speciesId)?.population).toBe(1);
  });

  it('takes a watched life’s story along, and keeps following it there', () => {
    const home = emptyWorld('home3');
    const away = emptyWorld('away3');
    home.name = '甲缸';
    away.name = '乙缸';
    const a = addAdult(home, herbGenome('sa'), 500, 400);
    const b = addAdult(home, herbGenome('sb'), 520, 400);
    stepFor(home, 1);
    home.history.rename(a, '小灯');
    layEggs(home, a, b);
    stepFor(home, 2);
    stepFor(away, 30);
    const t = emigrate(home, a.id, away.name)!;
    expect(home.history.stories.has(a.id)).toBe(false);
    const c = immigrate(away, t);
    const s = away.history.stories.get(c.id)!;
    expect(s.id).toBe(c.id);
    expect(s.custom).toBe('小灯');
    expect(s.events[s.events.length - 1]).toMatchObject({ k: 'moved', p: { from: '甲缸', to: '乙缸' } });
    // its milestones keep their distance from now in the new tank's time
    expect(away.time - c.firstReproT).toBeCloseTo(home.time - a.firstReproT, 3);
    expect(c.tags).toEqual([c.id]);
    expect(away.history.isWatched(c.id)).toBe(true);
  });
});
