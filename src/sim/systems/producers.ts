import { clamp } from '../core/math';
import { plantHeight, type Producer } from '../entities/producer';
import { lampLight } from '../decor';
import { createProducer, createSeed } from '../spawn';
import type { World } from '../world';

/** Moss: slow cushions on the floor that creep sideways. */
export const MOSS_GROWTH = 0.08;
export const MOSS_MAX_BIOMASS = 18;
const MOSS_SPREAD = 0.02;
const MAX_MOSS = 120;
/** Anemones: slow, long-lived, inedible; a living shelter that glows at night. */
export const ANEMONE_GROWTH = 0.04;
export const ANEMONE_MAX_BIOMASS = 40;
const ANEMONE_BUD = 0.0006;
const MAX_ANEMONES = 14;

/** Plants and algae like it mild; growth falls off in the cold and in heat. */
export function producerTemperatureFactor(t: number): number {
  const q = Math.pow(2, (t - 0.5) * 1.2);
  const coldStop = clamp((t - 0.05) / 0.2, 0, 1);
  const heatStop = clamp((1.02 - t) / 0.2, 0, 1);
  return q * coldStop * heatStop;
}

function monod(n: number, k: number): number {
  return n > 0 ? n / (n + k) : 0;
}

/**
 * Producers turn light + dissolved nutrients into biomass (taking the
 * nutrients out of the water), spread by seeds and splitting, and return
 * their bodies to the detritus pool when they age out.
 */
export function updateProducers(world: World, dt: number): void {
  const cfg = world.cfg;
  const env = world.env;
  const rng = world.rng;
  const tempF = producerTemperatureFactor(env.temperature);
  const boost = env.growthBoost;
  const K = cfg.nutrientHalfSat;

  env.fungus.fill(0);
  let plants = 0;
  let algae = 0;
  let fungi = 0;
  let moss = 0;
  let anemones = 0;
  for (const p of world.producers) {
    if (p.kind === 'fungus') {
      env.fungus[env.cellIndex(p.x, p.y - 5)] += p.biomass;
      fungi++;
    } else if (p.kind === 'plant') plants++;
    else if (p.kind === 'algae') algae++;
    else if (p.kind === 'moss') moss++;
    else anemones++;
  }

  const newborn: Producer[] = [];
  for (const p of world.producers) {
    p.age += dt;
    p.grazed += dt;
    if (p.age > p.lifespan || (p.kind !== 'fungus' && env.temperature < 0.08)) {
      // senescence: the body slowly returns to the detritus pool
      const loss = Math.min(p.biomass, p.biomass * 0.02 * dt + 0.05 * dt);
      p.biomass -= loss;
      env.addDetritus(p.x, p.kind === 'plant' ? p.y - 8 : p.y, loss);
      // an old stem dies back, but the roots usually send up a fresh shoot
      if (p.kind === 'plant' && p.biomass <= 0.05 && env.temperature >= 0.08 && rng.chance(0.9)) {
        const got = env.takeNutrient(p.x, p.y - 10, 4);
        if (got > 0.5) {
          const shoot = createProducer(world.newId(), 'plant', p.x + rng.range(-6, 6), p.y, rng, p.maxBiomass, 0, p.hue + rng.normal() * 0.01);
          shoot.age = 0;
          shoot.biomass = got;
          shoot.variant = Math.min(1, Math.max(0, p.variant + rng.normal() * 0.04));
          newborn.push(shoot);
        } else if (got > 0) env.addNutrient(p.x, p.y - 10, got);
      }
      continue;
    }
    if (p.kind === 'plant') {
      const h = plantHeight(p);
      const light = env.storedLightAt(p.y - h * 0.75) + (world.decor.length ? lampLight(world, p.x, p.y - h * 0.75) : 0);
      const n = env.nutrientAt(p.x, p.y - 10);
      const logistic = Math.max(2.5, p.biomass) * (1 - p.biomass / p.maxBiomass);
      const growth = cfg.plantGrowth * boost * light * monod(n, K) * tempF * logistic;
      if (growth > 0) p.biomass += env.takeNutrient(p.x, p.y - 10, growth * dt);
      const sd = env.stardust[env.cellIndex(p.x, p.y - 10)];
      if (sd > 0.05) p.stardust = Math.min(1, p.stardust + 0.02 * dt * sd);
      else if (p.stardust > 0) p.stardust = Math.max(0, p.stardust - dt / 1200);
      p.seedTimer -= dt;
      if (p.seedTimer <= 0) {
        p.seedTimer = rng.range(40, 120);
        const rootFed = env.nutrientAt(p.x, p.y - 10) > 25;
        if ((p.biomass > p.maxBiomass * 0.3 || rootFed) && plants + newborn.length + world.seeds.length < cfg.maxPlants && rng.chance(0.45)) {
          // a runner: rhizomes send up a new shoot a little way along the floor,
          // fed by the sediment when the leaves are grazed short
          const nx = p.x + rng.sign() * rng.range(18, 55);
          if (nx > 8 && nx < world.width - 8 && !world.plants.some((o) => Math.abs(o.x - nx) < 12)) {
            const cost = 3;
            const fromSoil = env.takeNutrient(p.x, p.y - 10, cost);
            p.biomass -= cost - fromSoil;
            const shoot = createProducer(world.newId(), 'plant', nx, world.groundAt(nx) + 3, rng, p.maxBiomass * rng.range(0.9, 1.1), 0, p.hue + rng.normal() * 0.01);
            shoot.age = 0;
            shoot.biomass = cost;
            shoot.variant = Math.min(1, Math.max(0, p.variant + rng.normal() * 0.05));
            newborn.push(shoot);
          }
        } else if (
          p.biomass > p.maxBiomass * 0.6 &&
          world.seeds.length < cfg.maxSeeds &&
          plants + world.seeds.length < cfg.maxPlants &&
          rng.chance(cfg.plantSeedRate * 60)
        ) {
          const cost = 4;
          p.biomass -= cost;
          const top = p.y - h;
          world.seeds.push(createSeed(world.newId(), p.x + rng.range(-8, 8), top + rng.range(0, h * 0.3), p.hue + rng.normal() * 0.01, cost, rng));
        }
      }
    } else if (p.kind === 'algae') {
      const light = env.lightAt(p.y) + (world.decor.length ? lampLight(world, p.x, p.y) : 0);
      const n = env.nutrientAt(p.x, p.y);
      const growth = cfg.algaeGrowth * boost * light * monod(n, K * 0.6) * tempF * Math.max(1, p.biomass) * (1 - p.biomass / p.maxBiomass);
      if (growth > 0) p.biomass += env.takeNutrient(p.x, p.y, growth * dt);
      if (p.biomass > p.maxBiomass * 0.8 && algae + newborn.length < cfg.maxAlgae && rng.chance(cfg.algaeSplitRate * dt)) {
        const half = p.biomass / 2;
        p.biomass = half;
        const child = createProducer(world.newId(), 'algae', p.x + rng.range(-10, 10), p.y + rng.range(-8, 8), rng, p.maxBiomass, 0, p.hue + rng.normal() * 0.01);
        child.biomass = half;
        child.age = 0;
        child.vx = p.vx + rng.range(-3, 3);
        child.vy = p.vy + rng.range(-3, 3);
        newborn.push(child);
      }
    } else if (p.kind === 'moss' || p.kind === 'anemone') {
      // floor dwellers that ask little light; moss creeps along, an anemone buds now and then
      const isMoss = p.kind === 'moss';
      const light = 0.35 + 0.65 * env.storedLightAt(p.y - 6) + (world.decor.length ? lampLight(world, p.x, p.y - 6) : 0);
      const n = env.nutrientAt(p.x, p.y - 10);
      const rate = isMoss ? MOSS_GROWTH : ANEMONE_GROWTH;
      const growth = rate * boost * light * monod(n, K) * tempF * Math.max(1, p.biomass) * (1 - p.biomass / p.maxBiomass);
      if (growth > 0) p.biomass += env.takeNutrient(p.x, p.y - 10, growth * dt);
      const full = p.biomass > p.maxBiomass * (isMoss ? 0.7 : 0.85);
      const room = isMoss ? moss + newborn.length < MAX_MOSS : anemones + newborn.length < MAX_ANEMONES;
      if (full && room && rng.chance((isMoss ? MOSS_SPREAD : ANEMONE_BUD) * dt)) {
        const nx = p.x + rng.sign() * rng.range(isMoss ? 14 : 30, isMoss ? 30 : 70);
        if (nx > 8 && nx < world.width - 8 && !world.pointProducers.some((o) => o.kind === p.kind && Math.abs(o.x - nx) < (isMoss ? 10 : 24))) {
          const share = p.biomass * (isMoss ? 0.3 : 0.25);
          p.biomass -= share;
          const child = createProducer(world.newId(), p.kind, nx, world.groundAt(nx) + 1, rng, p.maxBiomass, 0, p.hue + rng.normal() * 0.01);
          child.biomass = share;
          child.age = 0;
          newborn.push(child);
        }
      }
    } else {
      // fungus lives on detritus first, dissolved nutrients second, and prefers the dark
      const i = env.cellIndex(p.x, p.y - 5);
      const d = env.detritus[i];
      const n = env.nutrient[i];
      const dark = 0.6 + 0.4 * (1 - env.daylight);
      const food = monod(d, K * 1.5) + 0.3 * monod(n, K);
      const growth = cfg.fungusGrowth * dark * food * tempF * Math.max(1, p.biomass) * (1 - p.biomass / p.maxBiomass);
      if (growth > 0) {
        const fromD = Math.min(d, growth * dt * 0.75);
        env.detritus[i] -= fromD;
        const fromN = Math.min(env.nutrient[i], growth * dt - fromD);
        env.nutrient[i] -= fromN;
        p.biomass += fromD + fromN;
      } else if (food < 0.05) {
        // starving fungus fades
        const loss = Math.min(p.biomass, 0.01 * dt * p.maxBiomass);
        p.biomass -= loss;
        env.detritus[i] += loss;
      }
    }
  }
  for (const c of newborn) world.addProducer(c);

  // glowing fungus sprouts where detritus piles up on the floor
  if (fungi < cfg.maxFungi && rng.chance(cfg.fungusSpawnRate * dt * 10)) {
    const cx = rng.int(env.cols);
    const i = env.bottomRow[cx] * env.cols + cx;
    if (env.detritus[i] > 12) {
      const x = clamp((cx + rng.next()) * env.cell, 6, world.width - 6);
      const f = createProducer(world.newId(), 'fungus', x, world.groundAt(x) + 1, rng, cfg.fungusMaxBiomass * rng.range(0.8, 1.2), 0, rng.next());
      f.age = 0;
      const seedMass = Math.min(3, env.detritus[i]);
      env.detritus[i] -= seedMass;
      f.biomass = seedMass;
      world.addProducer(f);
    }
  }

  // drifting algae spores keep the surface alive if algae ever vanish
  if (algae < 20 && rng.chance(0.06 * dt)) {
    const x = rng.range(30, world.width - 30);
    const y = rng.range(40, 200);
    const got = env.takeNutrient(x, y, 2);
    if (got > 0.5) {
      const a = createProducer(world.newId(), 'algae', x, y, rng, cfg.algaeMaxBiomass, 0, rng.range(-0.05, 0.05));
      a.age = 0;
      a.biomass = got;
      world.addProducer(a);
    } else if (got > 0) env.addNutrient(x, y, got);
  }
}
