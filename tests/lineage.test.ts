import { describe, expect, it } from 'vitest';
import type { Creature } from '../src/sim/entities/creature';
import { MAX_TAGS } from '../src/sim/history/lineage';
import { narrateStory } from '../src/sim/history/stories';
import { restoreWorld, snapshotWorld } from '../src/sim/serialize';
import { killCreature } from '../src/sim/systems/life';
import { layEggs } from '../src/sim/systems/reproduction';
import type { World } from '../src/sim/world';
import { addAdult, emptyWorld, herbGenome, stepFor } from './helpers';

function grownUp(c: Creature): Creature {
  c.age = c.ph.maturityAge * 1.2;
  c.stage = 'adult';
  c.growth = 1;
  c.structure = c.ph.adultStructure;
  c.energy = c.ph.maxEnergy * 0.95;
  c.health = c.ph.maxHealth;
  c.reproCooldown = 0;
  return c;
}

/** Lay a clutch, let it hatch, and raise the young straight to adulthood. */
function breed(w: World, a: Creature, b: Creature): Creature[] {
  a.energy = a.ph.maxEnergy;
  b.energy = b.ph.maxEnergy;
  a.reproCooldown = 0;
  b.reproCooldown = 0;
  const before = new Set(w.creatures.map((c) => c.id));
  expect(layEggs(w, a, b)).toBeGreaterThan(0);
  const eggs = w.creatures.filter((c) => !before.has(c.id) && c.parentA === a.id);
  stepFor(w, 12);
  return eggs.map((e) => w.creatureMap.get(e.id)).filter((c): c is Creature => !!c && c.stage !== 'egg').map(grownUp);
}

function quiet(w: World): void {
  w.env.settings.mutation = 0;
  w.env.mutationSet = 0;
  w.env.settings.naturalWeather = false;
}

describe('lineage and life stories', () => {
  it('follows a watched bloodline across generations and keeps the path back through pruning', () => {
    const w = emptyWorld('bloodline');
    quiet(w);
    const root = addAdult(w, herbGenome('root'), 500, 400);
    const other = addAdult(w, herbGenome('other'), 520, 400);
    const stranger = addAdult(w, herbGenome('stranger'), 1200, 300);
    w.step(1 / 30);
    w.history.watch(root);

    let line = root;
    let partner = other;
    const path: Creature[] = [root];
    for (let gen = 1; gen <= 4; gen++) {
      const kids = breed(w, line, partner);
      expect(kids.length).toBeGreaterThan(0);
      const kid = kids[0];
      expect(kid.tags).toContain(root.id);
      expect(kid.generation).toBe(gen);
      path.push(kid);
      line = kid;
      partner = addAdult(w, herbGenome('mate' + gen), kid.x + 20, kid.y);
    }
    const heir = path[path.length - 1];
    // everyone else leaves; a long time passes
    for (const c of [...w.creatures]) if (c !== heir) killCreature(w, c, 'age');
    stepFor(w, 6);
    expect(w.creatureMap.has(root.id)).toBe(false);
    w.time += 5000;
    w.history.lineage.prune(w);

    const trace = w.history.lineage.pathToRoot(heir.id, root.id).map((n) => n.id);
    expect(trace).toEqual(path.map((c) => c.id).reverse());
    // side branches and strangers are forgotten
    expect(w.history.lineage.nodes.has(stranger.id)).toBe(false);
    expect(w.history.lineage.nodes.has(other.id)).toBe(false);

    const story = w.history.stories.get(root.id)!;
    expect(story.diedT).toBeGreaterThanOrEqual(0);
    expect(story.descendants).toBeGreaterThanOrEqual(4);
    expect(story.maxDepth).toBe(4);
    expect(story.events.some((e) => e.k === 'descendants' && e.p.n === 3)).toBe(true);
    const tree = w.history.lineage.tree(root.id);
    expect(tree.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(path.map((c) => c.id)));
  });

  it('inherits bloodline tags from both parents, within a bounded set', () => {
    const w = emptyWorld('tags');
    quiet(w);
    const a = addAdult(w, herbGenome('a'), 500, 400);
    const b = addAdult(w, herbGenome('b'), 520, 400);
    w.step(1 / 30);
    w.history.watch(a);
    w.history.watch(b);
    const [kid] = breed(w, a, b);
    expect(kid.tags).toEqual(expect.arrayContaining([a.id, b.id]));
    // a creature carrying many watched lines meets another
    kid.tags = [101, 102, 103, 104, 105, 106, 107, a.id];
    const mate = addAdult(w, herbGenome('m'), kid.x + 10, kid.y);
    mate.tags = [201, 202];
    const [grandkid] = breed(w, kid, mate);
    expect(grandkid.tags.length).toBe(MAX_TAGS);
    expect(grandkid.tags).toContain(202);
  });

  it('writes a watched life into a story that survives saving and loading', () => {
    const w = emptyWorld('story');
    quiet(w);
    const a = addAdult(w, herbGenome('sa'), 500, 400);
    const b = addAdult(w, herbGenome('sb'), 520, 400);
    w.step(1 / 30);
    w.history.rename(a, '小灯');
    expect(w.history.isWatched(a.id)).toBe(true);
    const kids = breed(w, a, b);
    stepFor(w, 6);
    a.energy = a.ph.maxEnergy;
    killCreature(w, a, 'age');
    stepFor(w, 6);

    const s = w.history.stories.get(a.id)!;
    const kinds = s.events.map((e) => e.k);
    expect(kinds[0]).toBe('born');
    expect(kinds).toEqual(expect.arrayContaining(['watched', 'named', 'parent', 'death']));
    expect(s.custom).toBe('小灯');
    expect(s.cause).toBe('寿终');
    expect(narrateStory(s, s.events.find((e) => e.k === 'death')!)).toContain('年老');
    for (const e of s.events) expect(narrateStory(s, e).length).toBeGreaterThan(3);
    expect(w.history.chronicle.some((e) => e.k === 'watchDeath' && e.p.name === '小灯')).toBe(true);

    const r = restoreWorld(snapshotWorld(w));
    const rs = r.history.stories.get(a.id)!;
    expect(rs.events).toEqual(s.events);
    expect(r.history.lineage.nodes.size).toBe(w.history.lineage.nodes.size);
    expect(r.history.lineage.nodes.get(a.id)?.name).toBe('小灯');
    expect(r.creatureMap.get(kids[0].id)?.tags).toContain(a.id);
    // and the restored world keeps telling the same story
    stepFor(r, 5);
    stepFor(w, 5);
    expect(r.history.stories.get(a.id)!.living).toBe(w.history.stories.get(a.id)!.living);
  });

  it('remembers the disasters a watched creature lived through', () => {
    const w = emptyWorld('weathered');
    quiet(w);
    const a = addAdult(w, herbGenome('w'), 500, 400);
    w.step(1 / 30);
    w.history.watch(a);
    w.disaster('coldwave');
    for (let i = 0; i < 9; i++) {
      a.energy = a.ph.maxEnergy;
      a.health = a.ph.maxHealth;
      stepFor(w, 25);
    }
    const s = w.history.stories.get(a.id)!;
    expect(s.events.some((e) => e.k === 'disaster' && e.p.kind === '寒潮')).toBe(true);
    expect(w.history.chronicle.some((e) => e.k === 'watchDisaster')).toBe(true);
  });

  it('archives record holders automatically: the first child and the last of a kind', () => {
    const w = emptyWorld('records');
    quiet(w);
    const a = addAdult(w, herbGenome('ra'), 500, 400);
    const b = addAdult(w, herbGenome('rb'), 520, 400);
    w.step(1 / 30);
    const [first] = breed(w, a, b);
    expect(w.history.stories.get(first.id)?.auto).toBe('first');
    expect(w.history.isWatched(first.id)).toBe(false);
    // the species dwindles to one, who then leaves
    for (const c of [...w.creatures]) if (c !== first) killCreature(w, c, 'age');
    stepFor(w, 5);
    killCreature(w, first, 'starvation');
    stepFor(w, 1);
    const s = w.history.stories.get(first.id)!;
    expect(s.diedT).toBeGreaterThanOrEqual(0);
    expect(s.cause).toBe('饥饿');
    expect(s.events.filter((e) => e.k === 'record').length).toBe(2);
  });
});
