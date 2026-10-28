import type { EnvSettings } from '../../sim/config';
import type { Creature } from '../../sim/entities/creature';
import type { FoodKind } from '../../sim/entities/food';
import type { DisasterKind } from '../../sim/environment';
import { emigrate } from '../../sim/migration';
import type { World } from '../../sim/world';
import { bond, pairProblem } from '../breeding';
import type { LevelRun } from './run';
import { placeFounders } from './setup';
import type { ToolKind } from './types';

/**
 * What the player can do inside a challenge, each use counted against the
 * level's budget. The engine and the headless test bots go through these
 * same functions, so a level plays the same either way.
 */

export const FOOD_TOOLS: Record<FoodKind, ToolKind> = { pellet: 'food', rich: 'rich', spore: 'spore' };

/** One pinch of food. */
export function levelFeed(run: LevelRun, world: World, kind: FoodKind, x: number, y: number, count = kind === 'rich' ? 2 : 5): boolean {
  if (!run.use(FOOD_TOOLS[kind])) return false;
  world.feed(kind, x, y, count);
  return true;
}

/** Bond two creatures; returns why not, if they cannot be matched. */
export function levelPair(run: LevelRun, world: World, a: Creature, b: Creature): string | null {
  const problem = pairProblem(a, b);
  if (problem) return problem;
  if (!run.use('pair')) return '这一关的配对次数用完了';
  bond(world, a, b);
  return null;
}

/** A creature leaves the tank for good. */
export function levelRelease(run: LevelRun, world: World, id: number): boolean {
  const c = world.creatureMap.get(id);
  if (!c || c.dying > 0 || !run.use('release')) return false;
  return emigrate(world, id, '远方') !== null;
}

export function levelDisaster(run: LevelRun, world: World, kind: DisasterKind, x?: number, y?: number): boolean {
  if (!run.use(`disaster:${kind}`)) return false;
  world.disaster(kind, x, y);
  return true;
}

/** Call the level's newcomers into the tank. */
export function levelCall(run: LevelRun, world: World): boolean {
  const call = run.def.tools.call;
  if (!call || world.creatures.length + call.count > world.cfg.maxCreatures || !run.use('call')) return false;
  placeFounders(world, { k: 'founders', arch: call.arch, count: call.count, adult: true });
  return true;
}

export function levelEnv(run: LevelRun, world: World, patch: Partial<EnvSettings>): boolean {
  if (!run.def.tools.env || run.status !== 'playing') return false;
  Object.assign(world.env.settings, patch);
  return true;
}
