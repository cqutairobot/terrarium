import { bodyRadius, foodEfficiency, maxEnergyOf, producerEfficiency } from '../behavior/perception';
import { freshness } from '../entities/corpse';
import type { Creature } from '../entities/creature';
import { grazable, plantHeight } from '../entities/producer';
import type { World } from '../world';

const FOOD_REACH_PAD = 6;

/** Distance from the creature's mouth to its food target, or -1 if the target is gone. */
function targetGap(world: World, c: Creature): number {
  const reach = c.ph.reach * c.growth + FOOD_REACH_PAD;
  switch (c.targetKind) {
    case 'producer': {
      const p = world.producerMap.get(c.targetId);
      if (!p || grazable(p) < 0.5) return -1;
      if (p.kind === 'plant') {
        const top = p.y - plantHeight(p);
        const dx = Math.abs(c.x - p.x);
        const dy = c.y < top ? top - c.y : c.y > p.y ? c.y - p.y : 0;
        return Math.max(0, Math.hypot(dx, dy) - reach - 6);
      }
      const py = p.kind === 'algae' ? p.y : p.y - (p.kind === 'moss' ? 4 : 6);
      return Math.max(0, Math.hypot(c.x - p.x, c.y - py) - reach - 8);
    }
    case 'food': {
      const f = world.foodMap.get(c.targetId);
      if (!f) return -1;
      return Math.max(0, Math.hypot(c.x - f.x, c.y - f.y) - reach - 3);
    }
    case 'corpse': {
      const k = world.corpseMap.get(c.targetId);
      if (!k) return -1;
      return Math.max(0, Math.hypot(c.x - k.x, c.y - k.y) - reach - k.radius);
    }
    default:
      return -1;
  }
}

/** A shrimp picks over the floor as it goes: whatever has settled there is food. */
function scavenge(world: World, c: Creature, dt: number): void {
  if (c.state === 'flee' || world.groundAt(c.x) - c.y > 34) return;
  const room = maxEnergyOf(c) - c.energy;
  if (room <= 0.5) return;
  const env = world.env;
  const i = env.cellIndex(c.x, c.y);
  const eff = 0.6;
  const got = Math.min(env.detritus[i], c.ph.biteRate * c.growth * dt * 0.35, room / eff);
  if (got <= 1e-6) return;
  env.detritus[i] -= got;
  c.energy += got * eff;
  env.addNutrient(c.x, c.y, got * (1 - eff));
  if (c.firstMealT < 0) c.firstMealT = world.time;
}

/** A bell strains the water as it drifts: a little of what is dissolved there feeds it. */
function filterFeed(world: World, c: Creature, dt: number): void {
  const room = maxEnergyOf(c) - c.energy;
  if (room <= 0.5) return;
  const env = world.env;
  const i = env.cellIndex(c.x, c.y);
  const eff = 0.5;
  const got = Math.min(env.nutrient[i] * 0.5, c.ph.biteRate * c.growth * dt * 0.08, room / eff);
  if (got <= 1e-6) return;
  env.nutrient[i] -= got;
  c.energy += got * eff;
  env.addNutrient(c.x, c.y, got * (1 - eff));
}

/** Switch foragers into eating when they reach food, and let eaters take bites. */
export function updateFeeding(world: World, c: Creature, dt: number): void {
  if (c.ph.morph === 'shrimp') scavenge(world, c, dt);
  else if (c.ph.morph === 'jelly') filterFeed(world, c, dt);
  if (c.state !== 'forage' && c.state !== 'eat') return;
  if (c.targetKind === 'point' || c.targetKind === 'none') return;
  const gap = targetGap(world, c);
  if (gap < 0) {
    c.thinkTimer = 0;
    if (c.state === 'eat') c.state = 'forage';
    return;
  }
  if (gap > 2) {
    if (c.state === 'eat') {
      c.state = 'forage';
      c.stateTime = 0;
    }
    return;
  }
  if (c.state !== 'eat') {
    c.state = 'eat';
    c.stateTime = 0;
  }
  bite(world, c, dt);
}

function bite(world: World, c: Creature, dt: number): void {
  const maxE = maxEnergyOf(c);
  const room = maxE - c.energy;
  if (room <= 0.5) {
    c.thinkTimer = 0;
    return;
  }
  let want = c.ph.biteRate * c.growth * dt;
  let eff = 0;
  let hue = 0.33;
  let size = 1;
  let got = 0;
  if (c.targetKind === 'producer') {
    const p = world.producerMap.get(c.targetId);
    if (!p) return;
    eff = producerEfficiency(c, p.kind);
    want = Math.min(want, room / Math.max(0.05, eff));
    got = Math.min(want, grazable(p));
    p.biomass -= got;
    p.grazed = 0;
    if (p.stardust > 0) c.stardust = Math.min(1, c.stardust + got * p.stardust * 0.02);
    if (p.kind === 'fungus') c.glowT = Math.max(c.glowT, 6);
    hue = p.kind === 'fungus' ? 0.5 : 0.3 + p.hue;
    if (grazable(p) < 0.5) c.thinkTimer = 0;
  } else if (c.targetKind === 'food') {
    const f = world.foodMap.get(c.targetId);
    if (!f) return;
    eff = foodEfficiency(c, f.kind);
    want = Math.min(want * 1.5, room / Math.max(0.05, eff));
    got = Math.min(want, f.energy);
    f.energy -= got;
    if (f.kind === 'spore') c.glowT = Math.max(c.glowT, 60);
    hue = f.kind === 'spore' ? 0.5 : f.kind === 'rich' ? 0.09 : 0.14;
    size = 1.2;
    if (f.energy <= 0.01) c.thinkTimer = 0;
  } else if (c.targetKind === 'corpse') {
    const k = world.corpseMap.get(c.targetId);
    if (!k) return;
    eff = c.ph.carnEff * Math.max(0.1, freshness(k));
    want = Math.min(want * 1.3, room / Math.max(0.05, eff));
    got = Math.min(want, k.biomass);
    k.biomass -= got;
    hue = k.hue;
    if (k.biomass <= 0.05) c.thinkTimer = 0;
  }
  if (got <= 0) return;
  c.energy += got * eff;
  // what is not digested goes straight back to the water as nutrients
  world.env.addNutrient(c.x, c.y, got * (1 - eff));
  if (c.firstMealT < 0) c.firstMealT = world.time;
  c.munch = 0.35;
  if (world.rng.next() < dt * 2.2) {
    const r = bodyRadius(c);
    world.emit('eat', c.x + Math.cos(c.heading) * r, c.y + Math.sin(c.heading) * r, hue, size, c.id);
  }
}
