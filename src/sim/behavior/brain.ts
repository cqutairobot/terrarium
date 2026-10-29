import { TAU } from '../core/math';
import type { BehaviorState, Creature } from '../entities/creature';
import { plantHeight } from '../entities/producer';
import type { World } from '../world';
import { breedingPressure } from '../systems/reproduction';
import { comfortSpot, nearestRefuge } from '../decor';
import { canBreed, findRestSpot, maxEnergyOf, perceive, type Perception } from './perception';

/**
 * Utility AI: every think, each possible intention gets a score shaped by
 * genes, body state and what the creature currently perceives. The best
 * score wins, with a small bonus for the current state to avoid dithering.
 */
const CANDIDATES: BehaviorState[] = ['flee', 'hunt', 'forage', 'seekMate', 'rest', 'social', 'explore', 'wander', 'follow'];
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
  } else if (p.alarm > 0 && c.state !== 'flee') {
    // many eyes: a fleeing neighbour is warning enough (the fear keeps its original time)
    c.fearX = p.alarmX;
    c.fearY = p.alarmY;
    c.fearT = world.time - 1;
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

  const threat = p.threat ? p.threatLevel : p.alarm > 0 ? 0.25 + 0.08 * Math.min(3, p.alarm) : 0;
  scores.flee = threat * (0.5 + 0.8 * ph.timidity) * 1.3;
  const carnivorous = ph.diet > 0.55;
  // hunters only go out when properly hungry, then digest in peace
  scores.hunt = carnivorous && hunger > 0.3
    ? Math.pow(hunger, 1.1) * 1.5 * (p.prey ? 1.25 : 0.5) * (c.stamina > 0.3 ? 1 : 0.4)
    : 0;
  // a hunter with a meal in front of it finishes the meal
  if (c.state === 'eat' || (carnivorous && p.foodKind === 'corpse')) scores.hunt *= 0.3;
  const eFrac = c.energy / maxE;
  const ready = canBreed(c);
  // a pair matched by the player looks only for each other, across the whole tank
  let partner = c.bondId ? world.creatureMap.get(c.bondId) : undefined;
  if (c.bondId && (!partner || partner.dying > 0)) {
    c.bondId = 0;
    partner = undefined;
  }
  const mate = ready ? (partner ? (canBreed(partner) ? partner : null) : (p.mate ?? distantMate(world, c))) : null;
  scores.seekMate = ready
    ? (eFrac - ph.reproThreshold + 0.3) *
      1.3 *
      (1 / (1 + Math.max(0, p.kin - 6) * 0.12)) *
      breedingPressure(world, c) *
      (mate ? 1.2 : 0.7) *
      // only breed when the neighbourhood can feed the young
      (carnivorous ? 1 : 0.25 + 0.75 * Math.min(1, p.foodPerHead / 40)) *
      // photoperiod: breed when one's own active hours are at hand
      (0.3 + 0.7 * (1 - sleepy))
    : 0;
  // the player's match wins over crowding and mood once both are ready; until then, it waits
  if (partner) scores.seekMate = mate ? Math.max(0.65, scores.seekMate * 2) : scores.seekMate * 0.3;
  // searching blindly in one's sleeping hours is a poor bargain: better to save energy
  const foodKnown = p.foodKind !== 'none' || memFresh;
  const blindSearch = 0.9 * (1 - 0.7 * sleepy);
  scores.forage = herbivorous || p.foodKind !== 'none'
    ? Math.pow(hunger, 1.3) * 1.25 * (p.foodKind !== 'none' ? 1.15 : memFresh ? 0.95 : blindSearch)
    : 0;
  scores.rest =
    (c.fatigue * (0.5 + 0.8 * (1 - ph.activity)) + sleepy * 0.55 + (carnivorous && !ready ? (1 - hunger) * 0.35 : 0)) *
      (1 - hunger * 0.7) +
    (foodKnown ? 0 : sleepy * 0.3);
  scores.social =
    p.social && world.time - c.lastSocial > 25 ? ph.sociability * 0.45 * (1 - hunger) : 0;
  const boredom = c.state === 'wander' ? Math.min(0.25, c.stateTime / 120) : 0;
  scores.explore = ph.curiosity * 0.4 * (1 - hunger) + boredom;
  scores.wander = (0.22 + 0.1 * ph.activity) * (1 - 0.8 * hunger);
  scores.follow =
    c.stage === 'juvenile' && p.parent ? 0.7 * (1 - c.age / ph.maturityAge) * (1 - hunger * 0.5) : 0;

  let best: BehaviorState = 'wander';
  let bestScore = -1;
  for (const s of CANDIDATES) {
    let v = scores[s] + rng.next() * 0.06;
    if (s === c.state) v += 0.12;
    // finishing a meal feels good: eaters keep eating until nearly full
    if (s === 'forage' && c.state === 'eat' && hunger > 0.08) v += 0.25;
    if (v > bestScore) {
      bestScore = v;
      best = s;
    }
  }
  // resting has a minimum duration unless danger appears
  if (c.state === 'rest' && c.stateTime < 4 && best !== 'flee' && hunger < 0.8) best = 'rest';
  applyChoice(world, c, best, p, mate);
}

function setState(c: Creature, s: BehaviorState): void {
  if (c.state !== s) {
    c.state = s;
    c.stateTime = 0;
  }
}

function applyChoice(world: World, c: Creature, s: BehaviorState, p: Perception, mate: Creature | null): void {
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
    case 'hunt': {
      setState(c, 'hunt');
      if (p.prey) {
        c.targetKind = 'creature';
        c.targetId = p.prey.id;
        c.memFoodX = p.prey.x;
        c.memFoodY = p.prey.y;
        c.memFoodT = world.time;
      } else if (c.targetKind !== 'point' || Math.hypot(c.tx - c.x, c.ty - c.y) < 40) {
        // patrol: back to where prey was last seen, or a slow cruise
        c.targetKind = 'point';
        c.targetId = 0;
        if (c.memFoodT >= 0 && world.time - c.memFoodT < 90 && Math.hypot(c.memFoodX - c.x, c.memFoodY - c.y) > 60) {
          c.tx = c.memFoodX;
          c.ty = c.memFoodY;
        } else pickSearchPoint(world, c);
      }
      return;
    }
    case 'seekMate': {
      setState(c, 'seekMate');
      if (mate) {
        c.targetKind = 'creature';
        c.targetId = mate.id;
      } else if (c.targetKind !== 'point' || Math.hypot(c.tx - c.x, c.ty - c.y) < 40) {
        c.targetKind = 'point';
        c.targetId = 0;
        // look for company: drift toward kin if any were seen
        if (p.kin > 0) {
          c.tx = p.kinX;
          c.ty = p.kinY;
        } else pickSearchPoint(world, c);
      }
      if (c.stateTime > 20) c.reproCooldown = Math.max(c.reproCooldown, 8);
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
        // a warm (or cool) stone when the water is uncomfortable, a hollow rock for the small
        const cozy = world.decor.length ? comfortSpot(world, c) : null;
        const refuge = !cozy && c.ph.trophic !== 'carnivore' ? nearestRefuge(world, c, 300) : null;
        const hide = !cozy && !refuge && night > 0.5 && c.ph.nocturnality < 0.5 ? findRestSpot(world, c, 260) : null;
        if (cozy) {
          c.tx = cozy.x + rng.range(-24, 24);
          c.ty = cozy.y - rng.range(14, 40);
        } else if (refuge) {
          c.tx = refuge.x + rng.range(-12, 12);
          c.ty = refuge.y - rng.range(10, 26);
        } else if (hide) {
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

/**
 * Rare kinds call to each other across the whole tank (think whale song or
 * pheromones): when its species is small, a breeder finds the nearest ready
 * partner even beyond sight.
 */
function distantMate(world: World, c: Creature): Creature | null {
  const sp = world.species.get(c.speciesId);
  if (!sp || sp.population > 8) return null;
  let best: Creature | null = null;
  let bd = Infinity;
  for (const o of world.creatures) {
    if (o === c || o.speciesId !== c.speciesId || !canBreed(o)) continue;
    const d = Math.hypot(o.x - c.x, o.y - c.y);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
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
