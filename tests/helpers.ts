import { CONSUMER_ARCHETYPES, PREDATOR_ARCHETYPES } from '../src/sim/archetypes';
import { Rng } from '../src/sim/core/rng';
import type { Creature } from '../src/sim/entities/creature';
import { genomeFromTemplate, type Genome } from '../src/sim/genome';
import { createCreature, createProducer } from '../src/sim/spawn';
import { World } from '../src/sim/world';

/** A world with terrain and environment but no life in it. */
export function emptyWorld(seed = 'test'): World {
  const w = new World({ seed, aspect: 16 / 9 }, true);
  const id = w.newId();
  w.species.set(id, {
    id,
    name: '测试族',
    hue: 0.5,
    trophic: 'herbivore',
    foundedAt: 0,
    parentSpecies: 0,
    centroid: [],
    population: 0,
    peak: 0,
    totalBorn: 0,
    extinctAt: null,
    milestones: [],
  });
  const pid = w.newId();
  w.species.set(pid, { ...w.species.get(id)!, id: pid, name: '测试掠食者', trophic: 'carnivore' });
  return w;
}

export const HERB_SPECIES = 1;
export const PRED_SPECIES = 2;

export function herbGenome(seed = 'h'): Genome {
  return genomeFromTemplate(CONSUMER_ARCHETYPES[0].template, new Rng(seed), 0.01);
}

export function predGenome(seed = 'p'): Genome {
  return genomeFromTemplate(PREDATOR_ARCHETYPES[0].template, new Rng(seed), 0.01);
}

export function addAdult(w: World, genome: Genome, x: number, y: number, species = HERB_SPECIES, energyFraction = 0.9): Creature {
  const id = w.newId();
  const c = createCreature({ id, genome, x, y, time: w.time, rng: w.rng, speciesId: species, familyId: id, age: 0 });
  c.age = c.ph.maturityAge * 1.2;
  c.stage = 'adult';
  c.growth = 1;
  c.structure = c.ph.adultStructure;
  c.energy = c.ph.maxEnergy * energyFraction;
  c.health = c.ph.maxHealth;
  c.reproCooldown = 0;
  w.addCreature(c);
  return c;
}

export function addPlant(w: World, x: number, fill = 0.8) {
  const p = createProducer(w.newId(), 'plant', x, w.groundAt(x) + 3, w.rng, w.cfg.plantMaxBiomass, fill, 0);
  p.age = 0;
  w.addProducer(p);
  return p;
}

export function stepFor(w: World, seconds: number): void {
  const n = Math.round(seconds * 30);
  for (let i = 0; i < n; i++) w.step(1 / 30);
}
