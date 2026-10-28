import { clamp } from './core/math';
import type { Creature } from './entities/creature';
import { express, geneticDistance, trophicOf, G } from './genome';
import { pushStory, type LifeStory } from './history/stories';
import { familyName } from './names';
import type { SavedCreature } from './serialize';
import { foundSpecies } from './systems/ecology';
import type { World } from './world';

/** A creature on its way from one tank to another, as plain data. */
export interface Traveller {
  creature: SavedCreature;
  /** Its life story, if it was watched or kept in the archive. */
  story: LifeStory | null;
  /** Name of the tank it left. */
  from: string;
  /** Simulated time of the tank it left, to re-base its milestones. */
  fromTime: number;
  /** Matter it carries (energy + body). */
  matter: number;
}

/**
 * A creature leaves this tank for another one. Moving away is not dying:
 * no corpse, no death in the records, but its matter leaves the ledger and
 * its story goes with it.
 */
export function emigrate(world: World, id: number, to: string): Traveller | null {
  const c = world.creatureMap.get(id);
  if (!c || c.dying > 0) return null;
  const matter = c.energy + c.structure;
  const i = world.creatures.indexOf(c);
  if (i >= 0) world.creatures.splice(i, 1);
  world.creatureMap.delete(id);
  if (c.stage !== 'egg') {
    const sp = world.species.get(c.speciesId);
    if (sp) {
      sp.population = Math.max(0, sp.population - 1);
      if (sp.population === 0 && !world.creatures.some((o) => o.speciesId === sp.id && o.dying === 0)) sp.extinctAt = world.time;
    }
    const fam = world.families.get(c.familyId);
    if (fam) {
      fam.living = Math.max(0, fam.living - 1);
      if (fam.living === 0) fam.extinctAt = world.time;
    }
  }
  world.ledger.moved -= matter;
  // nobody keeps waiting for it
  for (const o of world.creatures) {
    if (o.partnerId === id) o.partnerId = 0;
    if (o.targetId === id && o.targetKind === 'creature') {
      o.targetKind = 'none';
      o.targetId = 0;
      o.thinkTimer = 0;
    }
  }
  const h = world.history;
  h.lineage.markDeath(id, world.time);
  h.lineage.pinned.delete(id);
  const story = h.stories.get(id) ?? null;
  if (story) {
    h.stories.delete(id);
    pushStory(story, { t: world.time, w: world.clock(), k: 'moved', p: { from: world.name, to } });
  }
  h.add('movedOut', 1, { name: c.customName || c.name, to });
  const { ph: _ph, ...saved } = c;
  return { creature: structuredClone(saved), story: story ? structuredClone(story) : null, from: world.name, fromTime: world.time, matter };
}

/**
 * A traveller arrives: it gets a new id here, joins the nearest species of
 * its kind (or founds a new one), starts its own family line, and is poured
 * in gently from above.
 */
export function immigrate(world: World, t: Traveller): Creature {
  const rng = world.rng;
  const id = world.newId();
  const shift = world.time - t.fromTime;
  const c = structuredClone(t.creature) as Creature;
  c.ph = express(c.genome);
  c.id = id;
  // ties to the old tank do not travel
  c.parentA = 0;
  c.parentB = 0;
  c.kids = [];
  c.tags = [];
  c.disasters = [];
  c.partnerId = 0;
  c.threatId = 0;
  c.lastAttacker = 0;
  c.targetKind = 'none';
  c.targetId = 0;
  c.courtLead = false;
  c.danceT = 0;
  c.memFoodT = -1e9;
  c.fearT = -1e9;
  c.kinN = 0;
  if (c.stage !== 'egg') {
    c.state = 'wander';
    c.stateTime = 0;
  }
  c.thinkTimer = 0;
  // its milestones keep their distance in time from now
  c.bornT += shift;
  if (c.firstMealT >= 0) c.firstMealT += shift;
  if (c.firstReproT >= 0) c.firstReproT += shift;
  // poured in from above, somewhere near the middle
  c.x = rng.range(world.width * 0.3, world.width * 0.7);
  c.y = clamp(rng.range(110, 220), 60, world.groundAt(c.x) - 60);
  c.vx = 0;
  c.vy = 12;
  c.px = c.x;
  c.py = c.y;

  // the nearest species of the same diet, if it is close enough to be kin
  const trophic = trophicOf(c.genome.g[G.diet]);
  let best = 0;
  let bd = Infinity;
  for (const sp of world.species.values()) {
    if (sp.extinctAt !== null || sp.population <= 0 || sp.trophic !== trophic || sp.centroid.length !== c.genome.g.length) continue;
    const d = geneticDistance({ g: sp.centroid, rare: [] }, c.genome);
    if (d < bd) {
      bd = d;
      best = sp.id;
    }
  }
  c.speciesId = best && bd < world.cfg.speciationDistance ? best : foundSpecies(world, c.genome);
  c.familyId = id;
  world.families.set(id, {
    id,
    name: familyName(rng),
    founderId: id,
    founderName: c.customName || c.name,
    founderGen: c.generation,
    foundedAt: world.time,
    speciesId: c.speciesId,
    hue: c.genome.g[G.hue],
    living: 0,
    maxGen: c.generation,
    totalMembers: 0,
    extinctAt: null,
    milestones: [],
  });
  if (c.stage !== 'egg') {
    const sp = world.species.get(c.speciesId)!;
    sp.population++;
    if (sp.population > sp.peak) sp.peak = sp.population;
    sp.extinctAt = null;
    const fam = world.families.get(id)!;
    fam.living = 1;
    fam.totalMembers = 1;
  }
  world.addCreature(c);
  world.ledger.moved += t.matter;

  const h = world.history;
  h.lineage.ensure(c);
  const story = t.story;
  if (story) {
    story.id = id;
    story.bornT += shift;
    story.watchedT += shift;
    for (const e of story.events) e.t += shift;
    const last = story.events[story.events.length - 1];
    if (last && last.k === 'moved') last.p.to = world.name;
    h.stories.set(id, story);
    if (story.watched) {
      c.tags = [id];
      const node = h.lineage.ensure(c);
      if (!node.tags.includes(id)) node.tags.push(id);
    }
    h.lineage.pinned.add(id);
  }
  h.add('movedIn', 1, { name: c.customName || c.name, id, from: t.from });
  return c;
}
