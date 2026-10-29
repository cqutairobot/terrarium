import { clamp, clamp01 } from './core/math';
import type { Creature } from './entities/creature';
import { thermalStress } from './systems/metabolism';
import type { World } from './world';

/**
 * Things the player sets on the floor. Each changes its own small patch of
 * water: a hollow rock hides the small from hunters, a stone warms or cools
 * the water around it, a lamp keeps plants growing into the night.
 */
export type DecorKind = 'shelter' | 'warmStone' | 'coolStone' | 'lamp';

export interface Decor {
  id: number;
  kind: DecorKind;
  x: number;
  y: number;
}

export const DECOR_LABELS: Record<DecorKind, string> = { shelter: '岩洞', warmStone: '暖石', coolStone: '冷石', lamp: '水灯' };

/** How far each one reaches, in world units. */
export const DECOR_REACH: Record<DecorKind, number> = { shelter: 48, warmStone: 180, coolStone: 180, lamp: 200 };

/** A tank holds only so many. */
export const MAX_DECOR = 8;

/** Temperature change right at a stone (about 8°C). */
const STONE_SHIFT = 0.28;
/** Extra light right at a lamp. */
const LAMP_LIGHT = 0.7;

export function placeDecor(world: World, kind: DecorKind, x: number): Decor | null {
  if (world.decor.length >= MAX_DECOR) return null;
  const cx = clamp(x, 30, world.width - 30);
  const d: Decor = { id: world.newId(), kind, x: cx, y: world.groundAt(cx) };
  world.decor.push(d);
  return d;
}

export function removeDecor(world: World, id: number): boolean {
  const n = world.decor.length;
  world.decor = world.decor.filter((d) => d.id !== id);
  return world.decor.length < n;
}

function falloff(d: Decor, x: number, y: number): number {
  const reach = DECOR_REACH[d.kind];
  const dist = Math.hypot(x - d.x, y - d.y);
  if (dist >= reach) return 0;
  const f = 1 - dist / reach;
  return f * f * (3 - 2 * f);
}

/** The water temperature here, stones included. */
export function temperatureAt(world: World, x: number, y: number): number {
  let t = world.env.temperature;
  for (const d of world.decor) {
    if (d.kind === 'warmStone') t += STONE_SHIFT * falloff(d, x, y);
    else if (d.kind === 'coolStone') t -= STONE_SHIFT * falloff(d, x, y);
  }
  return clamp01(t);
}

/** Light a lamp adds here (it shines day and night). */
export function lampLight(world: World, x: number, y: number): number {
  let l = 0;
  for (const d of world.decor) if (d.kind === 'lamp') l += LAMP_LIGHT * falloff(d, x, y - 40);
  return l;
}

/** Inside a hollow rock: hunters can hardly see in. */
export function inShelter(world: World, x: number, y: number): boolean {
  for (const d of world.decor) {
    if (d.kind === 'shelter' && Math.abs(x - d.x) < DECOR_REACH.shelter && y > d.y - DECOR_REACH.shelter) return true;
  }
  return false;
}

/** A stone nearby whose water would suit this creature better than where it is, if any. */
export function comfortSpot(world: World, c: Creature, maxDist = 420, discomfort = 0.25): Decor | null {
  const here = thermalStress(c, temperatureAt(world, c.x, c.y));
  if (here < discomfort) return null;
  let best: Decor | null = null;
  let bestStress = here * 0.7;
  for (const d of world.decor) {
    if (d.kind !== 'warmStone' && d.kind !== 'coolStone') continue;
    if (Math.abs(d.x - c.x) > maxDist) continue;
    const s = thermalStress(c, temperatureAt(world, d.x, d.y - 30));
    if (s < bestStress) {
      bestStress = s;
      best = d;
    }
  }
  return best;
}

const near: number[] = [];

/** A refuge already holds as many as it can (a hollow rock more than an anemone). */
function full(world: World, x: number, y: number, room: number): boolean {
  near.length = 0;
  world.cgrid.query(world.creatures, x, y - 20, 50, near);
  return near.length >= room;
}

/** The nearest hollow rock (or, for the smallest, an anemone) with room left to rest in. */
export function nearestRefuge(world: World, c: Creature, maxDist: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bd = maxDist;
  for (const d of world.decor) {
    if (d.kind !== 'shelter') continue;
    const dist = Math.abs(d.x - c.x) + Math.abs(d.y - c.y) * 0.5;
    if (dist < bd && !full(world, d.x, d.y, 10)) {
      bd = dist;
      best = d;
    }
  }
  if (c.ph.radius < 10) {
    for (const p of world.pointProducers) {
      if (p.kind !== 'anemone' || p.biomass < 8) continue;
      const dist = Math.abs(p.x - c.x) + Math.abs(p.y - c.y) * 0.5;
      if (dist < bd && !full(world, p.x, p.y, 5)) {
        bd = dist;
        best = p;
      }
    }
  }
  return best;
}
