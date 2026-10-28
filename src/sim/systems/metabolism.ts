import { maxEnergyOf } from '../behavior/perception';
import type { Creature } from '../entities/creature';
import { growthAt } from '../spawn';
import type { World } from '../world';

/** Temperature stress 0..~1 for a creature: small bodies chill, big bodies overheat. */
export function thermalStress(c: Creature, temperature: number): number {
  const d = temperature - c.ph.thermalPref;
  const rel = Math.max(0.5, (c.ph.radius * c.growth) / 6);
  const k = d < 0 ? 1 / Math.sqrt(rel) : Math.sqrt(rel);
  return d * d * 6 * k;
}

/**
 * Energy accounting for one creature step. Spent energy is mostly excreted
 * back into the water as nutrients; the rest leaves the tank as heat.
 */
export function updateMetabolism(world: World, c: Creature, dt: number): void {
  const cfg = world.cfg;
  const env = world.env;
  const ph = c.ph;
  c.age += dt;
  c.stateTime += dt;
  if (c.munch > 0) c.munch -= dt;
  if (c.glowT > 0) c.glowT -= dt;
  if (c.stardust > 0) c.stardust = Math.max(0, c.stardust - dt / 300);
  if (c.reproCooldown > 0) c.reproCooldown -= dt;
  if (c.attackCooldown > 0) c.attackCooldown -= dt;

  // growth: the body follows an age schedule as long as there is energy to build it
  if (c.growth < 1) {
    const targetS = ph.adultStructure * Math.pow(growthAt(c.age, ph.maturityAge), 2);
    // growth pauses in lean times (stunting beats starving)
    if (c.structure < targetS && c.energy > maxEnergyOf(c) * 0.4) {
      const build = Math.min(targetS - c.structure, ph.adultStructure * 0.02 * dt);
      const cost = build / cfg.growthEfficiency;
      if (cost < c.energy) {
        c.energy -= cost;
        c.structure += build;
        world.ledger.heat += cost - build;
      }
    }
    c.growth = Math.min(1, Math.max(0.3, Math.sqrt(c.structure / ph.adultStructure)));
  }
  if (c.stage === 'juvenile' && c.age >= ph.maturityAge && c.growth > 0.88) c.stage = 'adult';
  if (c.stage === 'adult' && c.age >= ph.elderAge) c.stage = 'elder';

  const g = Math.pow(c.growth, 1.5);
  const speed = Math.hypot(c.vx, c.vy);
  const stress = thermalStress(c, env.temperature);
  const crowd = c.stress;
  let basal = cfg.basalCoeff * ph.basalFactor * g * env.q10() * (1 + Math.min(2, stress)) * (1 + 0.3 * crowd);
  if (c.state === 'rest') {
    // sleeping through one's quiet hours is cheapest
    const offHours = (1 - env.daylight) * (1 - ph.nocturnality) + env.daylight * ph.nocturnality;
    basal *= 0.5 - 0.15 * offHours;
  }
  const move = cfg.moveCoeff * ph.moveCoeff * g * (speed / cfg.refSpeed) ** 2 * (1 + env.turbulence * 0.8);
  const spend = Math.min(c.energy, (basal + move + ph.upkeep + ph.senseCost) * dt);
  c.energy -= spend;
  const excreted = spend * cfg.excretion;
  env.addNutrient(c.x, c.y, excreted);
  world.ledger.heat += spend - excreted;

  // fatigue builds with exertion and melts away with rest
  const exertion = speed / Math.max(1, ph.maxSpeed);
  if (c.state === 'rest') c.fatigue = Math.max(0, c.fatigue - dt * 0.03);
  else c.fatigue = Math.min(1, c.fatigue + dt * (0.0012 + 0.006 * exertion * exertion));
  // stamina only burns while sprinting
  if (exertion > 0.85) c.stamina = Math.max(0, c.stamina - dt * 0.16);
  else c.stamina = Math.min(1, c.stamina + dt * (c.state === 'rest' ? 0.08 : 0.04));
  c.stress = Math.max(0, c.stress - dt * 0.05);
}
