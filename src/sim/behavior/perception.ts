import { hueDist, lerp } from '../core/math';
import { freshness } from '../entities/corpse';
import type { Creature, TargetKind } from '../entities/creature';
import type { FoodKind } from '../entities/food';
import { grazable, plantHeight, type Producer, type ProducerKind } from '../entities/producer';
import { compatibility } from '../genome';
import type { World } from '../world';

/** Everything a creature noticed during one think. Reused to avoid allocation. */
export interface Perception {
  sense: number;
  threat: Creature | null;
  threatLevel: number;
  prey: Creature | null;
  preyScore: number;
  mate: Creature | null;
  mateScore: number;
  foodKind: TargetKind;
  foodId: number;
  foodX: number;
  foodY: number;
  foodScore: number;
  kin: number;
  kinX: number;
  kinY: number;
  kinVx: number;
  kinVy: number;
  /** Kin seen fleeing (many eyes): count and where their fear came from. */
  alarm: number;
  alarmX: number;
  alarmY: number;
  crowd: number;
  social: Creature | null;
  parent: Creature | null;
  restX: number;
  restY: number;
  restFound: boolean;
  /** Grazable food in sight divided by kin in sight (local plenty). */
  foodPerHead: number;
}

export const perception: Perception = {
  sense: 0,
  threat: null,
  threatLevel: 0,
  prey: null,
  preyScore: 0,
  mate: null,
  mateScore: 0,
  foodKind: 'none',
  foodId: 0,
  foodX: 0,
  foodY: 0,
  foodScore: 0,
  kin: 0,
  kinX: 0,
  kinY: 0,
  kinVx: 0,
  kinVy: 0,
  alarm: 0,
  alarmX: 0,
  alarmY: 0,
  crowd: 0,
  social: null,
  parent: null,
  restX: 0,
  restY: 0,
  restFound: false,
  foodPerHead: 0,
};

const buf: number[] = [];

export function bodyRadius(c: Creature): number {
  return c.ph.radius * c.growth;
}

export function maxEnergyOf(c: Creature): number {
  return c.ph.maxEnergy * c.growth * c.growth;
}

/** Digestive efficiency of a creature for a kind of food. */
export function producerEfficiency(c: Creature, kind: ProducerKind): number {
  const h = c.ph.herbEff;
  return kind === 'algae' ? h : kind === 'plant' ? h * 0.95 : h * 0.9;
}

export function foodEfficiency(c: Creature, kind: FoodKind): number {
  const h = c.ph.herbEff;
  const m = c.ph.carnEff;
  if (kind === 'pellet') return Math.min(0.95, h * 1.05 + 0.15 * m);
  if (kind === 'rich') return Math.min(0.95, 0.6 * h + 0.6 * m + 0.05);
  return Math.min(0.9, 0.5 * (h + m) + 0.1);
}

export function canBreed(c: Creature): boolean {
  if (c.dying > 0 || c.stage === 'egg' || c.stage === 'juvenile') return false;
  if (c.reproCooldown > 0 || c.health < c.ph.maxHealth * 0.5) return false;
  return c.energy >= maxEnergyOf(c) * c.ph.reproThreshold;
}

/** Ambient hue behind a creature (used for camouflage). */
export function backgroundHue(world: World, x: number, y: number): number {
  const floor = world.groundAt(x);
  if (floor - y < 70) return 0.27;
  for (const p of world.plants) {
    if (Math.abs(p.x - x) < 45) {
      const top = p.y - plantHeight(p);
      if (y > top) return 0.33 + p.hue;
    }
  }
  return lerp(0.48, 0.57, y / world.height);
}

/** Is a point inside the leafy cover of some plant? */
export function inCover(world: World, x: number, y: number): boolean {
  for (const p of world.plants) {
    if (p.biomass < 20 || Math.abs(p.x - x) > 22) continue;
    if (y > p.y - plantHeight(p)) return true;
  }
  return false;
}

/** How far away a predator can notice this creature, as a factor of its sense radius. */
export function visibilityFactor(world: World, prey: Creature): number {
  const night = 1 - world.env.daylight;
  const camo = 1 - hueDist(prey.ph.hue, backgroundHue(world, prey.x, prey.y)) * 2;
  let v = prey.ph.visibility * (1 - 0.4 * camo);
  if (prey.state === 'rest') v *= 0.75;
  if (inCover(world, prey.x, prey.y)) v *= 0.5;
  if (prey.ph.rare.fluorescent) v *= 1 + 0.35 * night;
  if (prey.glowT > 0) v *= 1.25;
  return Math.max(0.2, Math.min(1.6, v));
}

export function perceive(world: World, c: Creature): Perception {
  const p = perception;
  const env = world.env;
  const night = 1 - env.daylight;
  const ph = c.ph;
  const r = bodyRadius(c);
  const sense = ph.senseRadius * lerp(1, ph.nightVision, night) * (1 - 0.25 * env.turbulence);
  p.sense = sense;
  p.threat = null;
  p.threatLevel = 0;
  p.prey = null;
  p.preyScore = 0;
  p.mate = null;
  p.mateScore = 0;
  p.foodKind = 'none';
  p.foodId = 0;
  p.foodScore = 0;
  p.kin = 0;
  p.kinX = 0;
  p.kinY = 0;
  p.kinVx = 0;
  p.kinVy = 0;
  p.alarm = 0;
  p.crowd = 0;
  p.social = null;
  p.parent = null;
  p.restFound = false;
  p.foodPerHead = 0;

  const carnivorous = ph.diet > 0.55;
  const hungry = c.energy < maxEnergyOf(c) * 0.3;
  const breeding = canBreed(c);
  let socialBest = 1e9;

  buf.length = 0;
  world.cgrid.query(world.creatures, c.x, c.y, sense, buf);
  for (const idx of buf) {
    const o = world.creatures[idx];
    if (o === c || o.dying > 0 || o.stage === 'egg') continue;
    const dx = o.x - c.x;
    const dy = o.y - c.y;
    const d = Math.sqrt(dx * dx + dy * dy) + 1e-6;
    const oR = bodyRadius(o);
    if (d < r * 3 + oR) p.crowd++;

    // predators that could swallow me; a slow, stalking hunter is noticed late
    if (o.ph.diet > 0.55 && o.speciesId !== c.speciesId && r <= oR * 0.8) {
      const sprinting = Math.hypot(o.vx, o.vy) > o.ph.maxSpeed * 0.6;
      const camo = 1 - hueDist(o.ph.hue, backgroundHue(world, o.x, o.y)) * 2;
      const detect = sense * (sprinting ? 1 : 0.55) * (1 - 0.25 * camo);
      if (d < detect) {
        const near = 1 - d / detect;
        const level = Math.sqrt(near) * (o.state === 'hunt' ? (sprinting ? 1.6 : 0.9) : 0.18) * o.ph.diet;
        if (level > p.threatLevel) {
          p.threatLevel = level;
          p.threat = o;
        }
      }
    }
    // prey I could swallow — worth the chase only if the meal is big enough (optimal foraging)
    if (carnivorous && o.ph.diet < 0.6 && o.speciesId !== c.speciesId && oR <= r * 0.8 && (oR >= r * 0.35 || hungry)) {
      const detect = sense * visibilityFactor(world, o);
      if (d < detect) {
        const weak = 1 - o.health / o.ph.maxHealth;
        const size = oR / (r * 0.8);
        const score = (1 - d / detect) * 0.8 + 0.5 * weak + 0.8 * size * size + (o.stage === 'elder' ? 0.15 : 0);
        if (score > p.preyScore) {
          p.preyScore = score;
          p.prey = o;
        }
      }
    }
    if (o.speciesId === c.speciesId) {
      // a fresh alarm about danger close to me (alarms do not chain endlessly)
      if (o.state === 'flee' && d < sense * 0.8 && o.fearT >= 0 && world.time - o.fearT < 1.5) {
        if (Math.hypot(o.fearX - c.x, o.fearY - c.y) < sense * 1.1) {
          p.alarm++;
          p.alarmX = o.fearX;
          p.alarmY = o.fearY;
        }
      }
      if (d < sense * 0.65) {
        p.kin++;
        p.kinX += o.x;
        p.kinY += o.y;
        p.kinVx += o.vx;
        p.kinVy += o.vy;
      }
      if (o.id === c.parentA || o.id === c.parentB) {
        if (!p.parent || o.id === c.parentA) p.parent = o;
      }
      if (
        c.stage !== 'juvenile' &&
        o.stage !== 'juvenile' &&
        d < 90 &&
        (o.state === 'wander' || o.state === 'explore') &&
        world.time - o.lastSocial > 25 &&
        d < socialBest
      ) {
        socialBest = d;
        p.social = o;
      }
    }
    if (breeding && canBreed(o) && (o.state === 'seekMate' || o.state === 'wander' || o.state === 'explore' || o.state === 'rest')) {
      const compat = compatibility(c.genome, o.genome, world.cfg.compatDistance);
      if (compat > 0.15) {
        const likeness = 1 - hueDist(c.ph.hue, o.ph.hue) * 2;
        const score = (compat * o.ph.attractiveness * (0.6 + 0.4 * likeness)) / (1 + d / 120);
        if (score > p.mateScore) {
          p.mateScore = score;
          p.mate = o;
        }
      }
    }
  }
  if (p.kin > 0) {
    p.kinX /= p.kin;
    p.kinY /= p.kin;
    p.kinVx /= p.kin;
    p.kinVy /= p.kin;
  }

  scanFood(world, c, sense, p);
  p.foodPerHead = foodSeen / (1 + p.kin);
  return p;
}

let foodSeen = 0;

function scanFood(world: World, c: Creature, sense: number, p: Perception): void {
  foodSeen = 0;
  const room = maxEnergyOf(c) - c.energy;
  const curiosity = c.ph.curiosity;
  // algae and fungi
  if (c.ph.herbEff > 0.08) {
    buf.length = 0;
    world.pgrid.query(world.pointProducers, c.x, c.y, sense, buf);
    for (const idx of buf) {
      const pr = world.pointProducers[idx];
      if (pr.biomass < 1) continue;
      foodSeen += pr.biomass;
      const fy = pr.kind === 'fungus' ? pr.y - 6 : pr.y;
      const d = Math.hypot(pr.x - c.x, fy - c.y);
      // a nearly grazed-out colony is not worth a long swim
      if (pr.biomass < 3 && d > 40) continue;
      const value = Math.min(pr.biomass, room) * producerEfficiency(c, pr.kind);
      const score = value / (d + 40);
      if (score > p.foodScore) setFood(p, 'producer', pr.id, pr.x, fy, score);
    }
    // plants (tall: scan by x)
    for (const pl of world.plants) {
      const edible = grazable(pl);
      if (edible < 4) continue;
      const dx = pl.x - c.x;
      if (dx > sense || dx < -sense) continue;
      foodSeen += edible;
      const top = pl.y - plantHeight(pl);
      const ty = Math.min(Math.max(c.y, top + 8), pl.y - 8);
      const d = Math.hypot(dx, ty - c.y);
      if (d > sense) continue;
      const value = Math.min(edible, room) * producerEfficiency(c, 'plant');
      const score = value / (d + 40);
      if (score > p.foodScore) setFood(p, 'producer', pl.id, pl.x, ty, score);
    }
  }
  // food dropped by the observer
  buf.length = 0;
  world.fgrid.query(world.foods, c.x, c.y, sense, buf);
  for (const idx of buf) {
    const f = world.foods[idx];
    const d = Math.hypot(f.x - c.x, f.y - c.y);
    const eff = foodEfficiency(c, f.kind);
    if (eff < 0.1) continue;
    const novelty = 1 + curiosity * (f.kind === 'spore' ? 0.9 : 0.4);
    const score = (Math.min(f.energy, room) * eff * novelty) / (d + 40);
    if (score > p.foodScore) setFood(p, 'food', f.id, f.x, f.y, score);
  }
  // remains (carnivores and scavengers)
  if (c.ph.carnEff > 0.15) {
    for (const k of world.corpses) {
      const fresh = freshness(k);
      if (fresh < 0.15) continue;
      const d = Math.hypot(k.x - c.x, k.y - c.y);
      if (d > sense) continue;
      const score = (Math.min(k.biomass, room) * c.ph.carnEff * fresh) / (d + 40);
      if (score > p.foodScore) setFood(p, 'corpse', k.id, k.x, k.y, score);
    }
  }
}

function setFood(p: Perception, kind: TargetKind, id: number, x: number, y: number, score: number): void {
  p.foodKind = kind;
  p.foodId = id;
  p.foodX = x;
  p.foodY = y;
  p.foodScore = score;
}

/** Nearest plant to hide among while resting. */
export function findRestSpot(world: World, c: Creature, maxDist: number): Producer | null {
  let best: Producer | null = null;
  let bd = maxDist;
  for (const pl of world.plants) {
    if (pl.biomass < 15) continue;
    const d = Math.abs(pl.x - c.x) + Math.abs(pl.y - plantHeight(pl) * 0.5 - c.y) * 0.5;
    if (d < bd) {
      bd = d;
      best = pl;
    }
  }
  return best;
}
