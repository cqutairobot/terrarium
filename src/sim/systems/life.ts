import { bodyRadius, maxEnergyOf } from '../behavior/perception';
import type { Vec } from '../environment';
import type { Creature, DeathCause } from '../entities/creature';
import { createCorpse } from '../spawn';
import type { World } from '../world';
import { temperatureAt } from '../decor';
import { thermalStress } from './metabolism';

const flow: Vec = { x: 0, y: 0 };

/** Effective maximum health; the young are more fragile. */
export function healthMax(c: Creature): number {
  return c.ph.maxHealth * Math.max(0.4, c.growth * c.growth);
}

/**
 * A creature dies: its matter becomes a soft husk (corpse) that carnivores
 * can eat and that otherwise decays into detritus, while the body fades
 * into light over a few seconds.
 */
export function killCreature(world: World, c: Creature, cause: DeathCause, killer = 0): void {
  if (c.dying > 0) return;
  const matter = c.structure + c.energy;
  if (matter > 0 && matter <= 0.05) world.env.addDetritus(c.x, c.y, matter);
  if (matter > 0.05) {
    if (world.corpses.length >= world.cfg.maxCorpses) {
      // the oldest husk settles into the sediment to make room
      let oldest = world.corpses[0];
      for (const k of world.corpses) if (k.age > oldest.age) oldest = k;
      world.env.addDetritus(oldest.x, oldest.y, oldest.biomass);
      oldest.biomass = 0;
      world.corpseMap.delete(oldest.id);
      world.corpses.splice(world.corpses.indexOf(oldest), 1);
    }
    world.addCorpse(createCorpse(world.newId(), c));
  }
  c.structure = 0;
  c.energy = 0;
  c.dying = 1e-6;
  c.deathCause = cause;
  c.state = 'dying';
  c.stateTime = 0;
  c.danceT = 0;
  c.partnerId = 0;
  c.targetKind = 'none';
  world.recordDeath(c, cause, killer);
  world.emit('death', c.x, c.y, c.ph.rare.golden ? 0.13 : c.ph.hue, bodyRadius(c), c.id);
}

/** Damage from hunger, temperature and old age; healing when well fed. */
export function updateHealth(world: World, c: Creature, dt: number): void {
  const ph = c.ph;
  const maxH = healthMax(c);
  const maxE = maxEnergyOf(c);
  let damage = 0;
  let worst = 0;
  let cause: DeathCause = c.lastHurt;
  if (c.energy <= maxE * 0.01) {
    const d = 0.03 * maxH;
    damage += d;
    if (d > worst) {
      worst = d;
      cause = 'starvation';
    }
  }
  const t = world.decor.length ? temperatureAt(world, c.x, c.y) : world.env.temperature;
  const stress = thermalStress(c, t);
  if (stress > 0.7) {
    const d = (stress - 0.7) * 0.03 * maxH;
    damage += d;
    if (d > worst) {
      worst = d;
      cause = t < ph.thermalPref ? 'cold' : 'heat';
    }
  }
  if (c.age > ph.lifespan) {
    const d = (0.015 + 0.1 * (c.age / ph.lifespan - 1)) * maxH;
    damage += d;
    if (d > worst) {
      worst = d;
      cause = 'age';
    }
  }
  if (damage > 0) {
    c.health -= damage * dt;
    c.lastHurt = cause;
  } else if (c.health < maxH && c.energy > maxE * 0.3) {
    const heal = Math.min(maxH - c.health, (world.cfg.healthRegen / 100) * maxH * dt * (c.stage === 'elder' ? 0.4 : 1));
    const cost = heal * 0.3;
    if (cost < c.energy) {
      c.health += heal;
      c.energy -= cost;
      world.ledger.heat += cost;
    }
  }
  if (c.health > maxH) c.health = maxH;
  if (c.health <= 0) killCreature(world, c, c.lastHurt, c.lastHurt === 'predation' ? c.lastAttacker : 0);
}

/** The body sinks gently while it fades. */
export function updateDying(world: World, c: Creature, dt: number): void {
  c.dying += dt;
  world.env.flowAt(c.x, c.y, flow);
  c.vx = c.vx * Math.exp(-2 * dt) + flow.x * 0.3 * dt;
  c.vy += (6 - c.vy) * Math.min(1, dt);
  c.x += c.vx * dt;
  c.y = Math.min(world.groundAt(c.x) - 2, c.y + c.vy * dt);
}

/** Eggs drift and settle, then hatch into juveniles. */
export function updateEgg(world: World, c: Creature, dt: number): void {
  c.eggTimer -= dt;
  world.env.flowAt(c.x, c.y, flow);
  const floor = world.groundAt(c.x) - 6;
  c.vx += (flow.x * 0.35 - c.vx) * Math.min(1, dt);
  c.vy += ((c.y < floor ? 3 : 0) - c.vy) * Math.min(1, dt);
  c.x = Math.min(world.width - 6, Math.max(6, c.x + c.vx * dt));
  c.y = Math.min(floor, c.y + c.vy * dt);
  if (c.eggTimer <= 0) hatch(world, c);
}

function hatch(world: World, c: Creature): void {
  const ph = c.ph;
  const pool = c.energy;
  const hatchS = ph.adultStructure * 0.2025;
  c.structure = Math.min(pool, hatchS);
  let energy = pool - c.structure;
  const cap = ph.maxEnergy * 0.2025;
  if (energy > cap) {
    world.env.addNutrient(c.x, c.y, energy - cap);
    energy = cap;
  }
  c.energy = energy;
  c.growth = Math.max(0.3, Math.sqrt(c.structure / ph.adultStructure));
  c.health = healthMax(c);
  c.stage = 'juvenile';
  c.state = 'wander';
  c.stateTime = 0;
  c.thinkTimer = 0;
  c.age = 0;
  c.bornT = world.time;
  c.bornX = c.x;
  c.bornY = c.y;
  world.recordBirth(c);
  const rare = ph.rare.mask !== 0;
  world.emit(rare ? 'rareBirth' : 'hatch', c.x, c.y, ph.hue, bodyRadius(c) + 2, c.id);
}
