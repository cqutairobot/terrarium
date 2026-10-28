import { clamp } from '../core/math';
import { plantHeight, type Producer } from '../entities/producer';
import { createProducer, createSeed } from '../spawn';
import type { World } from '../world';

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
  for (const p of world.producers) {
    if (p.kind === 'fungus') {
      env.fungus[env.cellIndex(p.x, p.y - 5)] += p.biomass;
      fungi++;
    } else if (p.kind === 'plant') plants++;
    else algae++;
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
      continue;
    }
    if (p.kind === 'plant') {
      const h = plantHeight(p);
      const light = env.lightAt(p.y - h * 0.75);
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
        if (
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
      const light = env.lightAt(p.y);
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
  if (algae < 4 && rng.chance(0.02 * dt)) {
    const x = rng.range(30, world.width - 30);
    const y = rng.range(40, 200);
    const got = env.takeNutrient(x, y, 2);
    if (got > 0.5) {
      const a = createProducer(world.newId(), 'algae', x, y, rng, cfg.algaeMaxBiomass, 0, rng.range(-0.05, 0.05));
      a.age = 0;
      a.biomass = got;
      world.addProducer(a);
    }
  }
}
