import { CONSUMER_ARCHETYPES, PREDATOR_ARCHETYPES } from '../archetypes';
import { clamp } from '../core/math';
import { cloneGenome, express, genomeFromTemplate, G, mutateGenes, type Genome } from '../genome';
import { familyName, speciesName } from '../names';
import { createCreature, createSeed } from '../spawn';
import type { World } from '../world';

export interface BankEntry {
  genome: Genome;
  species: number;
  generation: number;
}

export interface EcologyState {
  /** Sim time when the last consumer vanished (-1 while alive). */
  consumerGoneAt: number;
  predatorGoneAt: number;
  plantGoneAt: number;
  /** Recently departed adult genomes — the "spores in the sediment". */
  bankHerb: BankEntry[];
  bankCarn: BankEntry[];
  respawns: number;
}

export function emptyEcology(): EcologyState {
  return { consumerGoneAt: -1, predatorGoneAt: -1, plantGoneAt: -1, bankHerb: [], bankCarn: [], respawns: 0 };
}

const BANK_SIZE = 24;

export function bankGenome(world: World, genome: Genome, species: number, generation: number, carnivore: boolean): void {
  const bank = carnivore ? world.ecology.bankCarn : world.ecology.bankHerb;
  bank.push({ genome: cloneGenome(genome), species, generation });
  if (bank.length > BANK_SIZE) bank.splice(0, bank.length - BANK_SIZE);
}

/**
 * Safety nets that are themselves ecological processes: dormant spores
 * revive life after a total extinction, a rare stranger wanders in from the
 * deep long after predators are gone, and seeds sprout again from the
 * sediment. Each one is recorded as a real event.
 */
export function updateEcology(world: World): void {
  const st = world.ecology;
  const t = world.time;
  let consumers = 0;
  let predators = 0;
  for (const c of world.creatures) {
    if (c.dying > 0) continue;
    if (c.ph.trophic === 'carnivore') predators++;
    else consumers++;
  }
  if (consumers === 0) {
    if (st.consumerGoneAt < 0) {
      st.consumerGoneAt = t;
      world.events.push({ t: 'allGone', kind: 'consumer' });
    } else if (t - st.consumerGoneAt > 90) {
      reviveConsumers(world);
      st.consumerGoneAt = -1;
    }
  } else st.consumerGoneAt = -1;

  if (predators === 0) {
    if (st.predatorGoneAt < 0) {
      st.predatorGoneAt = t;
      world.events.push({ t: 'allGone', kind: 'predator' });
    } else if (t - st.predatorGoneAt > 1500 && consumers >= 60) {
      immigratePredators(world);
      st.predatorGoneAt = -1;
    }
  } else st.predatorGoneAt = -1;

  let plants = 0;
  for (const p of world.producers) if (p.kind === 'plant') plants++;
  if (plants === 0 && world.seeds.length === 0) {
    if (st.plantGoneAt < 0) st.plantGoneAt = t;
    else if (t - st.plantGoneAt > 120) {
      for (let i = 0; i < 4; i++) {
        const x = world.rng.range(40, world.width - 40);
        const got = world.env.takeNutrient(x, world.groundAt(x) - 10, 4);
        if (got > 0.5) world.seeds.push(createSeed(world.newId(), x, world.groundAt(x) - 30, world.rng.range(-0.03, 0.03), got, world.rng));
      }
      world.events.push({ t: 'respawn', kind: 'plant', count: 4, fromBank: false });
      st.plantGoneAt = -1;
    }
  } else st.plantGoneAt = -1;
}

function reviveConsumers(world: World): void {
  const st = world.ecology;
  const rng = world.rng;
  const count = 14;
  const fromBank = st.bankHerb.length > 0;
  const fresh = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    let genome: Genome;
    let species: number;
    let generation = 0;
    if (fromBank) {
      const e = st.bankHerb[rng.int(st.bankHerb.length)];
      genome = cloneGenome(e.genome);
      mutateGenes(genome.g, rng, { rate: 0.2, sigmaScale: 1.5, macroChance: 0 });
      species = e.species;
      generation = e.generation + 1;
      const rec = world.species.get(species);
      if (rec && rec.extinctAt !== null) rec.extinctAt = null;
    } else {
      const arch = CONSUMER_ARCHETYPES[rng.int(CONSUMER_ARCHETYPES.length)];
      genome = genomeFromTemplate(arch.template, rng, 0.05);
      species = ensureFreshSpecies(world, genome, `revive-${i < count / 2 ? 0 : 1}`, fresh);
    }
    spawnFounder(world, genome, species, generation, false);
  }
  st.respawns++;
  world.events.push({ t: 'respawn', kind: 'consumer', count, fromBank });
}

function immigratePredators(world: World): void {
  const st = world.ecology;
  const rng = world.rng;
  const fromBank = st.bankCarn.length > 0;
  const fresh = new Map<string, number>();
  for (let i = 0; i < 2; i++) {
    let genome: Genome;
    let species: number;
    let generation = 0;
    if (fromBank) {
      const e = st.bankCarn[rng.int(st.bankCarn.length)];
      genome = cloneGenome(e.genome);
      mutateGenes(genome.g, rng, { rate: 0.25, sigmaScale: 1.5, macroChance: 0 });
      species = e.species;
      generation = e.generation + 1;
      const rec = world.species.get(species);
      if (rec && rec.extinctAt !== null) rec.extinctAt = null;
    } else {
      const arch = PREDATOR_ARCHETYPES[rng.int(PREDATOR_ARCHETYPES.length)];
      genome = genomeFromTemplate(arch.template, rng, 0.05);
      species = ensureFreshSpecies(world, genome, 'immigrant', fresh);
    }
    spawnFounder(world, genome, species, generation, true);
  }
  st.respawns++;
  world.events.push({ t: 'respawn', kind: 'predator', count: 2, fromBank });
}

/** One new species per revival batch key (founders of a batch share it). */
function ensureFreshSpecies(world: World, genome: Genome, key: string, batch: Map<string, number>): number {
  const existing = batch.get(key);
  if (existing !== undefined) return existing;
  const id = world.newId();
  const g = genome.g;
  const taken = new Set([...world.species.values()].map((s) => s.name));
  const ph = express(genome);
  world.species.set(id, {
    id,
    name: speciesName(
      {
        hue: g[G.hue],
        finSize: g[G.finSize],
        tentacles: g[G.tentacles],
        tailLength: g[G.tailLength],
        eyeSize: g[G.eyeSize],
        armor: g[G.armor],
        perception: g[G.perception],
        size: g[G.size],
        diet: g[G.diet],
      },
      taken,
    ),
    hue: g[G.hue],
    trophic: ph.trophic,
    foundedAt: world.time,
    parentSpecies: 0,
    centroid: g.slice(),
    population: 0,
    peak: 0,
    totalBorn: 0,
    extinctAt: null,
    milestones: [],
  });
  batch.set(key, id);
  return id;
}

function spawnFounder(world: World, genome: Genome, species: number, generation: number, predator: boolean): void {
  const rng = world.rng;
  const id = world.newId();
  const x = rng.range(80, world.width - 80);
  const y = clamp(rng.range(predator ? 200 : 120, world.groundAt(x) - 80), 60, world.groundAt(x) - 40);
  const c = createCreature({ id, genome, x, y, time: world.time, rng, speciesId: species, familyId: id, generation, age: 0, energyFraction: 0.8 });
  // revived life starts young but able
  c.age = c.ph.maturityAge * rng.range(0.4, 0.9);
  c.growth = Math.min(1, 0.45 + 0.55 * Math.pow(Math.min(1, c.age / c.ph.maturityAge), 0.7));
  c.structure = c.ph.adultStructure * c.growth * c.growth;
  c.energy = c.ph.maxEnergy * c.growth * c.growth * 0.8;
  c.health = c.ph.maxHealth;
  // the revived matter comes out of the sediment, keeping the ledger whole
  const need = c.structure + c.energy;
  const local = world.env.takeNutrient(x, world.groundAt(x) - 10, need);
  const got = local + takeAnywhere(world, need - local);
  const scale = Math.min(1, got / Math.max(1e-6, need));
  c.structure *= scale;
  c.energy *= scale;
  c.bornT = world.time;
  world.addCreature(c);
  world.families.set(id, {
    id,
    name: familyName(rng),
    founderId: id,
    founderName: c.name,
    founderGen: generation,
    foundedAt: world.time,
    speciesId: species,
    hue: genome.g[G.hue],
    living: 0,
    maxGen: generation,
    totalMembers: 0,
    extinctAt: null,
    milestones: [],
  });
  world.recordBirth(c);
}

function takeAnywhere(world: World, amount: number): number {
  const env = world.env;
  let got = 0;
  for (let i = 0; i < env.nutrient.length && got < amount; i++) {
    const take = Math.min(env.nutrient[i] * 0.5, amount - got);
    env.nutrient[i] -= take;
    got += take;
  }
  return got;
}
