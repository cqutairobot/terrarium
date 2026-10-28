import { CONSUMER_ARCHETYPES, PREDATOR_ARCHETYPES, type Archetype } from './archetypes';
import { DEFAULT_CONFIG, DEFAULT_SETTINGS, type EcoConfig, type EnvSettings } from './config';
import { clamp, wrap01 } from './core/math';
import { Rng } from './core/rng';
import { SpatialGrid } from './core/spatialGrid';
import type { Corpse } from './entities/corpse';
import type { Creature } from './entities/creature';
import type { Food } from './entities/food';
import { plantHeight, type Producer, type Seed } from './entities/producer';
import { Environment } from './environment';
import { G, genomeFromTemplate, type Genome } from './genome';
import { familyName, speciesName, worldName } from './names';
import { N_RARE, RARE_DEFS } from './rareTraits';
import type { FamilyRecord, SpeciesRecord } from './registry';
import { createCreature, createProducer } from './spawn';
import { generateTerrain, groundY, type Terrain } from './terrain';
import { updateCreatures } from './systems/creatures';
import { updateItems } from './systems/items';
import { updateProducers } from './systems/producers';

export const WORLD_HEIGHT = 1000;
/** Fixed simulation step (seconds of simulated time). */
export const SIM_DT = 1 / 30;
/** Producers and the nutrient grid advance on a slower clock. */
export const SLOW_DT = 0.5;

export type FxType =
  | 'birth'
  | 'hatch'
  | 'death'
  | 'rareBirth'
  | 'eat'
  | 'court'
  | 'social'
  | 'bite'
  | 'impact'
  | 'feed'
  | 'spore';

/** Transient events for the renderer and audio (not saved). */
export interface FxEvent {
  type: FxType;
  x: number;
  y: number;
  hue: number;
  size: number;
  id: number;
}

export interface Ledger {
  /** Matter lost as heat (metabolism, growth inefficiency). */
  heat: number;
  /** Matter added from (positive) or buried into (negative) the sediment. */
  inflow: number;
  /** Matter added by the observer as food. */
  feed: number;
}

export interface WorldCounters {
  births: number;
  deaths: number;
  generationsMax: number;
}

export interface WorldOptions {
  seed: string;
  /** Screen aspect at creation; fixes the world width for its whole life. */
  aspect?: number;
  name?: string;
  config?: Partial<EcoConfig>;
  settings?: Partial<EnvSettings>;
  /** Wall clock at creation (ms); defaults to Date.now(). */
  createdAt?: number;
}

export function worldWidthForAspect(aspect: number): number {
  return Math.round(WORLD_HEIGHT * clamp(aspect, 1.25, 2.6));
}

export class World {
  readonly seed: string;
  name: string;
  readonly width: number;
  readonly height: number;
  cfg: EcoConfig;
  rng: Rng;
  terrain: Terrain;
  env: Environment;
  createdAt: number;

  time = 0;
  tick = 0;
  /** Real seconds this world has been running (any speed). */
  realTime = 0;
  nextId = 1;

  creatures: Creature[] = [];
  producers: Producer[] = [];
  foods: Food[] = [];
  corpses: Corpse[] = [];
  seeds: Seed[] = [];

  creatureMap = new Map<number, Creature>();
  producerMap = new Map<number, Producer>();
  foodMap = new Map<number, Food>();
  corpseMap = new Map<number, Corpse>();

  species = new Map<number, SpeciesRecord>();
  families = new Map<number, FamilyRecord>();

  ledger: Ledger = { heat: 0, inflow: 0, feed: 0 };
  counters: WorldCounters = { births: 0, deaths: 0, generationsMax: 0 };

  /** Producers that live at a point (algae + fungi); plants are scanned linearly. */
  pointProducers: Producer[] = [];
  plants: Producer[] = [];
  cgrid: SpatialGrid;
  pgrid: SpatialGrid;
  fgrid: SpatialGrid;

  fx: FxEvent[] = [];
  private slowAcc = 0;

  constructor(opts: WorldOptions, restore = false) {
    this.seed = opts.seed;
    this.cfg = { ...DEFAULT_CONFIG, ...(opts.config ?? {}) };
    this.rng = new Rng(opts.seed);
    this.width = worldWidthForAspect(opts.aspect ?? 16 / 9);
    this.height = WORLD_HEIGHT;
    this.createdAt = opts.createdAt ?? Date.now();
    const gen = this.rng.fork('terrain');
    this.terrain = generateTerrain(gen, this.width, this.height);
    this.name = opts.name ?? worldName(this.rng.fork('name'));
    const settings = { ...DEFAULT_SETTINGS, ...(opts.settings ?? {}) };
    this.env = new Environment(this.width, this.height, this.terrain, this.cfg, settings, this.rng.fork('env'));
    this.cgrid = new SpatialGrid(this.width, this.height, 80);
    this.pgrid = new SpatialGrid(this.width, this.height, 80);
    this.fgrid = new SpatialGrid(this.width, this.height, 80);
    if (!restore) this.populate();
  }

  newId(): number {
    return this.nextId++;
  }

  groundAt(x: number): number {
    return groundY(this.terrain, x);
  }

  emit(type: FxType, x: number, y: number, hue: number, size: number, id = 0): void {
    if (this.fx.length < 400) this.fx.push({ type, x, y, hue, size, id });
  }

  /** Drain transient effects (renderer/audio call this once per frame). */
  drainFx(): FxEvent[] {
    const out = this.fx;
    this.fx = [];
    return out;
  }

  addCreature(c: Creature): void {
    this.creatures.push(c);
    this.creatureMap.set(c.id, c);
  }

  addProducer(p: Producer): void {
    this.producers.push(p);
    this.producerMap.set(p.id, p);
  }

  addFood(f: Food): void {
    this.foods.push(f);
    this.foodMap.set(f.id, f);
  }

  addCorpse(c: Corpse): void {
    this.corpses.push(c);
    this.corpseMap.set(c.id, c);
  }

  counts(): { consumers: number; predators: number; eggs: number; plants: number; algae: number; fungi: number } {
    let consumers = 0;
    let predators = 0;
    let eggs = 0;
    for (const c of this.creatures) {
      if (c.dying > 0) continue;
      if (c.stage === 'egg') eggs++;
      else if (c.ph.trophic === 'carnivore') predators++;
      else consumers++;
    }
    let plants = 0;
    let algae = 0;
    let fungi = 0;
    for (const p of this.producers) {
      if (p.kind === 'plant') plants++;
      else if (p.kind === 'algae') algae++;
      else fungi++;
    }
    return { consumers, predators, eggs, plants, algae, fungi };
  }

  /** Every unit of matter in the tank (for the conservation ledger). */
  totalMatter(): number {
    let s = this.env.totalNutrient() + this.env.totalDetritus();
    for (const p of this.producers) s += p.biomass;
    for (const c of this.creatures) s += c.energy + c.structure;
    for (const f of this.foods) s += f.energy;
    for (const c of this.corpses) s += c.biomass;
    return s;
  }

  livingBiomass(): number {
    let s = 0;
    for (const p of this.producers) s += p.biomass;
    for (const c of this.creatures) s += c.energy + c.structure;
    for (const f of this.foods) s += f.energy;
    for (const c of this.corpses) s += c.biomass;
    return s;
  }

  /** Matter the tank relaxes toward, set by nutrient richness. */
  matterTarget(): number {
    return this.cfg.nutrientTarget * this.env.waterCells * this.env.nutrientSet * this.env.nutrientBoost;
  }

  step(dt: number): void {
    this.time += dt;
    this.tick++;
    this.env.update(dt);
    this.rebuildGrids();
    updateCreatures(this, dt);
    updateItems(this, dt);
    this.slowAcc += dt;
    while (this.slowAcc >= SLOW_DT) {
      this.slowAcc -= SLOW_DT;
      updateProducers(this, SLOW_DT);
      const deficit = this.matterTarget() - this.totalMatter();
      const inflow = deficit * Math.min(1, this.cfg.nutrientRelax * SLOW_DT);
      this.ledger.inflow += inflow;
      this.env.updateGrid(SLOW_DT, inflow);
    }
    this.compact();
  }

  rebuildGrids(): void {
    this.cgrid.build(this.creatures);
    this.pointProducers.length = 0;
    this.plants.length = 0;
    for (const p of this.producers) {
      if (p.kind === 'plant') this.plants.push(p);
      else this.pointProducers.push(p);
    }
    this.pgrid.build(this.pointProducers);
    this.fgrid.build(this.foods);
  }

  private compact(): void {
    const dyingTime = this.cfg.dyingTime;
    let w = 0;
    for (const c of this.creatures) {
      if (c.dying >= dyingTime) {
        this.creatureMap.delete(c.id);
        continue;
      }
      this.creatures[w++] = c;
    }
    this.creatures.length = w;
    w = 0;
    for (const p of this.producers) {
      if (p.biomass <= 0.05) {
        this.producerMap.delete(p.id);
        continue;
      }
      this.producers[w++] = p;
    }
    this.producers.length = w;
    w = 0;
    for (const f of this.foods) {
      if (f.energy <= 0.01) {
        this.foodMap.delete(f.id);
        continue;
      }
      this.foods[w++] = f;
    }
    this.foods.length = w;
    w = 0;
    for (const c of this.corpses) {
      if (c.biomass <= 0.05) {
        this.corpseMap.delete(c.id);
        continue;
      }
      this.corpses[w++] = c;
    }
    this.corpses.length = w;
  }

  // ---------------------------------------------------------------- creation

  private populate(): void {
    const rng = this.rng.fork('genesis');
    this.populateProducers(rng);
    const consumerA = rng.int(CONSUMER_ARCHETYPES.length);
    let consumerB = rng.int(CONSUMER_ARCHETYPES.length - 1);
    if (consumerB >= consumerA) consumerB++;
    const predator = rng.int(PREDATOR_ARCHETYPES.length);
    const hueShift = rng.range(-0.08, 0.08);
    this.foundSpecies(CONSUMER_ARCHETYPES[consumerA], rng, hueShift, false);
    this.foundSpecies(CONSUMER_ARCHETYPES[consumerB], rng, hueShift, false);
    this.foundSpecies(PREDATOR_ARCHETYPES[predator], rng, hueShift * 0.5, true);
    // dissolved nutrients make up the rest of the target matter, richer toward the floor
    const free = Math.max(0, this.matterTarget() - this.livingBiomass());
    const env = this.env;
    let weightSum = 0;
    const weights = new Float64Array(env.nutrient.length);
    for (let cy = 0; cy < env.rows; cy++) {
      for (let cx = 0; cx < env.cols; cx++) {
        const i = cy * env.cols + cx;
        if (!env.water[i]) continue;
        const wgt = 0.4 + Math.pow(cy / env.rows, 2) * 2.2;
        weights[i] = wgt;
        weightSum += wgt;
      }
    }
    for (let i = 0; i < weights.length; i++) env.nutrient[i] = (free * weights[i]) / weightSum;
    this.rebuildGrids();
  }

  private populateProducers(rng: Rng): void {
    const cfg = this.cfg;
    const patches = 8 + rng.int(4);
    for (let p = 0; p < patches; p++) {
      const cx = rng.range(60, this.width - 60);
      const n = 5 + rng.int(4);
      const hue = rng.range(-0.04, 0.05);
      for (let i = 0; i < n; i++) {
        const x = clamp(cx + rng.normal() * 55, 10, this.width - 10);
        this.addProducer(
          createProducer(this.newId(), 'plant', x, this.groundAt(x) + 3, rng, cfg.plantMaxBiomass * rng.range(0.75, 1.2), rng.range(0.35, 0.9), hue + rng.range(-0.02, 0.02)),
        );
      }
    }
    for (let i = 0; i < 34; i++) {
      const x = rng.range(20, this.width - 20);
      const y = rng.range(40, 360);
      const a = createProducer(this.newId(), 'algae', x, y, rng, cfg.algaeMaxBiomass * rng.range(0.8, 1.2), rng.range(0.3, 0.8), rng.range(-0.05, 0.05));
      this.addProducer(a);
    }
    for (let i = 0; i < 9; i++) {
      const rock = this.terrain.rocks[i % Math.max(1, this.terrain.rocks.length)];
      const x = clamp((rock ? rock.x : rng.range(0, this.width)) + rng.normal() * 40, 6, this.width - 6);
      const f = createProducer(this.newId(), 'fungus', x, this.groundAt(x) + 1, rng, cfg.fungusMaxBiomass * rng.range(0.8, 1.2), rng.range(0.3, 0.7), rng.range(0, 1));
      this.addProducer(f);
    }
  }

  private foundSpecies(arch: Archetype, rng: Rng, hueShift: number, predator: boolean): void {
    const base = { ...arch.template };
    base.hue = wrap01((base.hue ?? 0.5) + hueShift + rng.range(-0.05, 0.05));
    base.accentHue = wrap01((base.accentHue ?? 0.5) + rng.range(-0.06, 0.06));
    // the world nudges each founding stock a little differently
    for (const k of ['size', 'speed', 'perception', 'metabolism', 'sociability', 'nocturnality', 'thermalPref'] as const) {
      base[k] = clamp((base[k] ?? 0.5) + rng.normal() * 0.04, 0.02, 0.98);
    }
    const speciesId = this.newId();
    const taken = new Set([...this.species.values()].map((s) => s.name));
    const name = speciesName(
      {
        hue: base.hue,
        finSize: base.finSize ?? 0.5,
        tentacles: base.tentacles ?? 0.5,
        tailLength: base.tailLength ?? 0.5,
        eyeSize: base.eyeSize ?? 0.5,
        armor: base.armor ?? 0.5,
        perception: base.perception ?? 0.5,
        size: base.size ?? 0.5,
        diet: base.diet ?? 0.1,
      },
      taken,
    );
    const centroid: number[] = [];
    const members: Genome[] = [];
    for (let i = 0; i < arch.count; i++) members.push(genomeFromTemplate(base, rng, 0.035));
    // a few founders quietly carry recessive rare alleles
    for (const g of members) {
      for (let l = 0; l < N_RARE; l++) {
        if (RARE_DEFS[l].mode === 'recessive' && rng.chance(0.03)) g.rare[l * 2 + rng.int(2)] = 1 + rng.int(RARE_DEFS[l].variants);
      }
    }
    for (let i = 0; i < members[0].g.length; i++) {
      centroid.push(members.reduce((s, g) => s + g.g[i], 0) / members.length);
    }
    this.species.set(speciesId, {
      id: speciesId,
      name,
      hue: base.hue,
      trophic: predator ? 'carnivore' : 'herbivore',
      foundedAt: this.time,
      parentSpecies: 0,
      centroid,
      population: 0,
      peak: arch.count,
      totalBorn: arch.count,
      extinctAt: null,
      milestones: [],
    });
    for (const genome of members) {
      const id = this.newId();
      const x = rng.range(80, this.width - 80);
      const yTop = predator ? 220 : 80;
      const y = rng.range(yTop, this.groundAt(x) - 60);
      const familyId = id;
      const c = createCreature({
        id,
        genome,
        x,
        y,
        time: this.time,
        rng,
        speciesId,
        familyId,
        age: 0,
        energyFraction: 0.7,
      });
      // founders arrive at a range of ages so the first generation does not die all at once
      c.age = c.ph.maturityAge * rng.range(0.6, 1.6);
      c.bornT = this.time - c.age;
      c.growth = Math.min(1, 0.45 + 0.55 * Math.pow(Math.min(1, c.age / c.ph.maturityAge), 0.7));
      c.structure = c.ph.adultStructure * c.growth * c.growth;
      c.energy = c.ph.maxEnergy * c.growth * c.growth * rng.range(0.55, 0.85);
      c.stage = c.age >= c.ph.maturityAge ? 'adult' : 'juvenile';
      this.addCreature(c);
      this.families.set(familyId, {
        id: familyId,
        name: familyName(rng),
        founderId: id,
        founderName: c.name,
        founderGen: 0,
        foundedAt: this.time,
        speciesId,
        hue: genome.g[G.hue],
        living: 1,
        maxGen: 0,
        totalMembers: 1,
        extinctAt: null,
        milestones: [],
      });
    }
  }
}

/** Point on a plant that a grazer aims for, given where the grazer is. */
export function plantBitePoint(p: Producer, nearY: number): { x: number; y: number } {
  const h = plantHeight(p);
  const top = p.y - h;
  return { x: p.x, y: clamp(nearY, top + 8, p.y - 8) };
}
