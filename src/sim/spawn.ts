import { clamp } from './core/math';
import type { Rng } from './core/rng';
import type { Creature } from './entities/creature';
import type { Corpse } from './entities/corpse';
import { FOOD_SPECS, type Food, type FoodKind } from './entities/food';
import type { Producer, ProducerKind, Seed } from './entities/producer';
import { express, type Genome } from './genome';
import { creatureName } from './names';

export interface CreatureInit {
  id: number;
  genome: Genome;
  x: number;
  y: number;
  time: number;
  rng: Rng;
  speciesId: number;
  familyId: number;
  parentA?: number;
  parentB?: number;
  generation?: number;
  /** Start as an egg with this much stored energy. */
  eggEnergy?: number;
  /** Start as a grown individual of this age (founders, respawns). */
  age?: number;
  energyFraction?: number;
  name?: string;
  hatchTime?: number;
}

/** Juvenile growth factor (0.45 at hatching → 1 at maturity). */
export function growthAt(age: number, maturityAge: number): number {
  return 0.45 + 0.55 * Math.pow(clamp(age / maturityAge, 0, 1), 0.7);
}

export function createCreature(init: CreatureInit): Creature {
  const ph = express(init.genome);
  const rng = init.rng;
  const isEgg = init.eggEnergy !== undefined;
  const age = isEgg ? 0 : (init.age ?? 0);
  const growth = isEgg ? 0.45 : growthAt(age, ph.maturityAge);
  const massF = growth * growth;
  // an egg's whole substance is its energy pool; the body is built at hatching
  const structure = isEgg ? 0 : ph.adultStructure * massF;
  const energy = isEgg ? (init.eggEnergy ?? 0) : ph.maxEnergy * massF * (init.energyFraction ?? 0.7);
  const heading = rng.next() * Math.PI * 2;
  const c: Creature = {
    id: init.id,
    name: init.name ?? creatureName(rng),
    customName: null,
    speciesId: init.speciesId,
    familyId: init.familyId,
    parentA: init.parentA ?? 0,
    parentB: init.parentB ?? 0,
    generation: init.generation ?? 0,
    genome: init.genome,
    ph,
    x: init.x,
    y: init.y,
    vx: 0,
    vy: 0,
    heading,
    px: init.x,
    py: init.y,
    ph0: heading,
    swim: rng.next() * Math.PI * 2,
    age,
    energy,
    structure,
    health: ph.maxHealth * (isEgg ? 0.6 : 1),
    fatigue: rng.next() * 0.3,
    stress: 0,
    stamina: 1,
    growth,
    stage: isEgg ? 'egg' : age >= ph.elderAge ? 'elder' : age >= ph.maturityAge ? 'adult' : 'juvenile',
    eggTimer: isEgg ? (init.hatchTime ?? 8) : 0,
    state: isEgg ? 'egg' : 'wander',
    stateTime: 0,
    thinkTimer: rng.next() * 0.5,
    targetKind: 'none',
    targetId: 0,
    tx: init.x,
    ty: init.y,
    memFoodX: 0,
    memFoodY: 0,
    memFoodT: -1,
    fearX: 0,
    fearY: 0,
    fearT: -1,
    wanderAngle: heading,
    kinN: 0,
    kinX: 0,
    kinY: 0,
    kinVx: 0,
    kinVy: 0,
    threatId: 0,
    lastSocial: -999,
    lookX: Math.cos(heading),
    lookY: Math.sin(heading),
    reproCooldown: isEgg ? 0 : ph.reproCooldown * rng.next(),
    partnerId: 0,
    bondId: 0,
    danceT: 0,
    courtLead: false,
    attackCooldown: 0,
    lastAttacker: 0,
    lastHurt: 'injury',
    glowT: 0,
    stardust: 0,
    munch: 0,
    dying: 0,
    deathCause: null,
    bornT: init.time - age,
    bornX: init.x,
    bornY: init.y,
    firstMealT: -1,
    firstReproT: -1,
    children: 0,
    kids: [],
    disasters: [],
    escapes: 0,
    kills: 0,
    mutations: [],
    tags: [],
  };
  return c;
}

export function createProducer(
  id: number,
  kind: ProducerKind,
  x: number,
  y: number,
  rng: Rng,
  maxBiomass: number,
  fill: number,
  hue: number,
): Producer {
  const lifespan =
    kind === 'plant' ? rng.range(2400, 5400) : kind === 'algae' ? rng.range(500, 1100) : rng.range(600, 1500);
  return {
    id,
    kind,
    x,
    y,
    vx: 0,
    vy: 0,
    biomass: maxBiomass * fill,
    maxBiomass,
    age: rng.next() * lifespan * 0.3,
    lifespan,
    hue,
    variant: rng.next(),
    seedTimer: rng.range(20, 120),
    stardust: 0,
    grazed: 99,
  };
}

export function createSeed(id: number, x: number, y: number, hue: number, energy: number, rng: Rng): Seed {
  return { id, x, y, vx: rng.range(-6, 6), vy: rng.range(-4, 2), hue, age: 0, energy };
}

export function createFood(id: number, kind: FoodKind, x: number, y: number, rng: Rng): Food {
  const spec = FOOD_SPECS[kind];
  return {
    id,
    kind,
    x,
    y,
    vx: rng.range(-8, 8),
    vy: rng.range(-3, 6),
    energy: spec.energy * rng.range(0.85, 1.15),
    age: 0,
    landed: 0,
  };
}

export function createCorpse(id: number, c: Creature): Corpse {
  const biomass = Math.max(0, c.structure + c.energy);
  return {
    id,
    x: c.x,
    y: c.y,
    vy: 0,
    biomass,
    initial: biomass,
    radius: c.ph.radius * c.growth,
    hue: c.ph.hue,
    age: 0,
    sourceId: c.id,
  };
}
