import { TAU } from '../core/math';
import type { BehaviorState, Creature } from '../entities/creature';
import { plantHeight } from '../entities/producer';
import type { World } from '../world';
import { findRestSpot, maxEnergyOf, perceive, type Perception } from './perception';

/**
 * Utility AI: every think, each possible intention gets a score shaped by
 * genes, body state and what the creature currently perceives. The best
 * score wins, with a small bonus for the current state to avoid dithering.
 */
const CANDIDATES: BehaviorState[] = ['flee', 'forage', 'rest', 'social', 'explore', 'wander', 'follow'];
const scores: Record<string, number> = {};

export function think(world: World, c: Creature): void {
  if (c.stage === 'egg' || c.dying > 0) return;
  // committed activities finish on their own timers
  if ((c.state === 'court' || c.state === 'social') && c.danceT > 0) return;

  const p = perceive(world, c);
  c.kinN = p.kin;
  c.kinX = p.kinX;
  c.kinY = p.kinY;
  c.kinVx = p.kinVx;
  c.kinVy = p.kinVy;
  // crowding is stressful (raises metabolism, see metabolism.ts)
  if (p.crowd > 4) c.stress = Math.min(1, c.stress + (p.crowd - 4) * 0.05);
  if (p.threat) {
    c.fearX = p.threat.x;
    c.fearY = p.threat.y;
    c.fearT = world.time;
  }

  const ph = c.ph;
  const env = world.env;
  const rng = world.rng;
  const maxE = maxEnergyOf(c);
  const hunger = Math.max(0, Math.min(1, 1 - c.energy / maxE));
  const night = 1 - env.daylight;
  const sleepy = night * (1 - ph.nocturnality) + env.daylight * ph.nocturnality * 0.8;
  const memFresh = c.memFoodT >= 0 && world.time - c.memFoodT < 70;
  const herbivorous = ph.herbEff > 0.2;

  scores.flee = p.threat ? p.threatLevel * (0.6 + 0.9 * ph.timidity) * 1.5 : 0;
  scores.forage = herbivorous || p.foodKind !== 'none'
    ? Math.pow(hunger, 1.3) * 1.25 * (p.foodKind !== 'none' ? 1.15 : memFresh ? 0.95 : 0.7)
    : 0;
  scores.rest = (c.fatigue * (0.5 + 0.8 * (1 - ph.activity)) + sleepy * 0.55) * (1 - hunger * 0.7);
  scores.social =
    p.social && world.time - c.lastSocial > 25 ? ph.sociability * 0.45 * (1 - hunger) : 0;
  const boredom = c.state === 'wander' ? Math.min(0.25, c.stateTime / 120) : 0;
  scores.explore = ph.curiosity * 0.4 * (1 - hunger) + boredom;
  scores.wander = 0.22 + 0.1 * ph.activity;
  scores.follow =
    c.stage === 'juvenile' && p.parent ? 0.7 * (1 - c.age / ph.maturityAge) * (1 - hunger * 0.5) : 0;

  let best: BehaviorState = 'wander';
  let bestScore = -1;
  for (const s of CANDIDATES) {
    let v = scores[s] + rng.next() * 0.06;
    if (s === c.state) v += 0.12;
    if (v > bestScore) {
      bestScore = v;
      best = s;
    }
  }
  // resting has a minimum duration unless danger appears
  if (c.state === 'rest' && c.stateTime < 4 && best !== 'flee' && hunger < 0.8) best = 'rest';
  applyChoice(world, c, best, p);
}

function setState(c: Creature, s: BehaviorState): void {
  if (c.state !== s) {
    c.state = s;
    c.stateTime = 0;
  }
}

function applyChoice(world: World, c: Creature, s: BehaviorState, p: Perception): void {
  const rng = world.rng;
  switch (s) {
    case 'flee': {
      setState(c, 'flee');
      c.targetKind = 'creature';
      c.targetId = p.threat ? p.threat.id : 0;
      c.threatId = c.targetId;
      c.thinkTimer = Math.min(c.thinkTimer, 0.2);
      return;
    }
    case 'forage': {
      if (p.foodKind !== 'none') {
        setState(c, c.state === 'eat' && c.targetId === p.foodId ? 'eat' : 'forage');
        c.targetKind = p.foodKind;
        c.targetId = p.foodId;
        c.tx = p.foodX;
        c.ty = p.foodY;
        c.memFoodX = p.foodX;
        c.memFoodY = p.foodY;
        c.memFoodT = world.time;
      } else if (c.memFoodT >= 0 && world.time - c.memFoodT < 70 && Math.hypot(c.memFoodX - c.x, c.memFoodY - c.y) > 30) {
        setState(c, 'forage');
        c.targetKind = 'point';
        c.targetId = 0;
        c.tx = c.memFoodX;
        c.ty = c.memFoodY;
      } else {
        // search: wander far, preferring the plant zone for grazers
        setState(c, 'forage');
        c.targetKind = 'point';
        c.targetId = 0;
        pickSearchPoint(world, c);
      }
      return;
    }
    case 'rest': {
      if (c.state !== 'rest') {
        const night = 1 - world.env.daylight;
        const hide = night > 0.5 && c.ph.nocturnality < 0.5 ? findRestSpot(world, c, 260) : null;
        if (hide) {
          const h = plantHeight(hide);
          c.tx = hide.x + rng.range(-14, 14);
          c.ty = Math.min(hide.y - 14, hide.y - h * rng.range(0.25, 0.6));
        } else {
          c.tx = c.x + rng.range(-20, 20);
          c.ty = c.y + rng.range(-10, 20);
        }
        c.targetKind = 'point';
        c.targetId = 0;
      }
      setState(c, 'rest');
      return;
    }
    case 'social': {
      const o = p.social;
      if (!o) break;
      setState(c, 'social');
      c.partnerId = o.id;
      c.targetKind = 'creature';
      c.targetId = o.id;
      c.danceT = 2.6;
      c.lastSocial = world.time;
      o.state = 'social';
      o.stateTime = 0;
      o.partnerId = c.id;
      o.targetKind = 'creature';
      o.targetId = c.id;
      o.danceT = 2.6;
      o.lastSocial = world.time;
      return;
    }
    case 'follow': {
      if (!p.parent) break;
      setState(c, 'follow');
      c.targetKind = 'creature';
      c.targetId = p.parent.id;
      return;
    }
    case 'explore': {
      if (c.state !== 'explore' || Math.hypot(c.tx - c.x, c.ty - c.y) < 40) {
        const a = rng.next() * TAU;
        const d = rng.range(220, 560);
        c.tx = Math.min(world.width - 40, Math.max(40, c.x + Math.cos(a) * d));
        c.ty = Math.min(world.groundAt(c.tx) - 50, Math.max(50, c.y + Math.sin(a) * d * 0.5));
      }
      setState(c, 'explore');
      c.targetKind = 'point';
      c.targetId = 0;
      return;
    }
    default:
      break;
  }
  setState(c, 'wander');
  c.targetKind = 'none';
  c.targetId = 0;
}

function pickSearchPoint(world: World, c: Creature): void {
  const rng = world.rng;
  if (world.plants.length > 0 && c.ph.herbEff > 0.3 && rng.chance(0.6)) {
    const pl = world.plants[rng.int(world.plants.length)];
    c.tx = pl.x + rng.range(-30, 30);
    c.ty = pl.y - plantHeight(pl) * rng.range(0.3, 0.8);
    return;
  }
  const a = rng.next() * TAU;
  const d = rng.range(200, 480);
  c.tx = Math.min(world.width - 40, Math.max(40, c.x + Math.cos(a) * d));
  c.ty = Math.min(world.groundAt(c.tx) - 40, Math.max(40, c.y + Math.sin(a) * d * 0.6));
}
