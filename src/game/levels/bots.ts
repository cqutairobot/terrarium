import type { EnvSettings } from '../../sim/config';
import type { Creature } from '../../sim/entities/creature';
import type { FoodKind } from '../../sim/entities/food';
import { eventEnvelope, type DisasterKind } from '../../sim/environment';
import { alleleCount, RARE_LOCI } from '../../sim/rareTraits';
import { SIM_DT, type World } from '../../sim/world';
import { levelCall, levelDisaster, levelEnv, levelFeed, levelPair, levelRelease } from './actions';
import { inHueBand, shownHue, type HueBand } from '../conditions';
import { LevelRun } from './run';
import { createLevelWorld } from './setup';
import type { LevelDef } from './types';

/**
 * Scripted players that try each level the way it was meant to be solved.
 * The level tests and the tuning script use them to prove a level can be
 * won (and, with no plan at all, that it can be lost).
 */
export interface BotCtx {
  world: World;
  run: LevelRun;
  /** Seconds into the level. */
  t: number;
  mem: Record<string, unknown>;
  feed(kind: FoodKind, x: number, y: number): boolean;
  pair(a: Creature, b: Creature): boolean;
  release(id: number): boolean;
  call(): boolean;
  env(patch: Partial<EnvSettings>): boolean;
  disaster(kind: DisasterKind, x?: number, y?: number): boolean;
}

export type BotPlan = (ctx: BotCtx) => void;

const LAKE_BLUE: HueBand = { from: 0.47, to: 0.545, word: '湖蓝色' };

function grazers(w: World): Creature[] {
  return w.creatures.filter((c) => c.dying === 0 && c.stage !== 'egg' && c.ph.trophic !== 'carnivore');
}

function adults(w: World): Creature[] {
  return grazers(w).filter((c) => c.stage === 'adult');
}

function carries(c: Creature, key: string): number {
  return alleleCount(c.genome.rare, RARE_LOCI.indexOf(key as (typeof RARE_LOCI)[number]));
}

/** True the first time it is asked (per key). */
function once(ctx: BotCtx, key: string): boolean {
  if (ctx.mem[key]) return false;
  ctx.mem[key] = true;
  return true;
}

/** Every `period` seconds (first at `from`). */
function every(ctx: BotCtx, key: string, period: number, from = 0): boolean {
  const last = (ctx.mem[key] as number | undefined) ?? -Infinity;
  if (ctx.t < from || ctx.t - last < period) return false;
  ctx.mem[key] = ctx.t;
  return true;
}

/** Feed beside a creature, a little above it so the food sinks past. */
function feedBy(ctx: BotCtx, c: { x: number; y: number }, kind: FoodKind = 'pellet'): boolean {
  return ctx.feed(kind, c.x, Math.max(30, c.y - 30));
}

export const PLANS: Record<string, BotPlan> = {

  '1-1': (ctx) => {
    // feed beside the hungry ones, taking turns (the school is not always together)
    if (!every(ctx, 'feed', 14, 5)) return;
    const hungry = grazers(ctx.world).sort((a, b) => a.energy / a.ph.maxEnergy - b.energy / b.ph.maxEnergy);
    const turn = ((ctx.mem.turn as number) ?? 0) + 1;
    ctx.mem.turn = turn;
    const c = hungry[turn % Math.min(3, hungry.length)];
    if (c) feedBy(ctx, c);
  },
  '1-2': (ctx) => {
    if (once(ctx, 'env')) ctx.env({ temperature: 0.55 });
  },
  '1-3': (ctx) => {
    // the last golden fish with a hidden carrier (half their young are golden), then golden with golden
    const w = ctx.world;
    if (!every(ctx, 'look', 5)) return;
    const free = adults(w).filter((c) => !c.bondId);
    const golden = free.filter((c) => c.ph.rare.golden);
    const carriers = free.filter((c) => !c.ph.rare.golden && carries(c, 'golden') > 0);
    while (golden.length >= 2 && ctx.run.left('pair') > 0) ctx.pair(golden.shift()!, golden.shift()!);
    while (golden.length && carriers.length && ctx.run.left('pair') > 0) ctx.pair(golden.shift()!, carriers.shift()!);
    if (every(ctx, 'feed', 45, 20)) for (const c of grazers(w).filter((x) => x.bondId && x.id < x.bondId)) feedBy(ctx, c);
  },
  '1-4': (ctx) => {
    for (const c of ctx.world.creatures) if (c.dying === 0 && c.ph.trophic === 'carnivore') ctx.release(c.id);
  },
  '1-5': (ctx) => {
    // breed the lake-blue ones with each other, send some of the green away
    const w = ctx.world;
    const blue = (c: Creature) => inHueBand(shownHue(c), LAKE_BLUE);
    if (!every(ctx, 'look', 5)) return;
    const free = adults(w).filter((c) => !c.bondId && blue(c));
    while (free.length >= 2 && ctx.run.left('pair') > 0) ctx.pair(free.shift()!, free.shift()!);
    const green = adults(w).filter((c) => !blue(c)).sort((a, b) => b.age - a.age);
    if (green.length && every(ctx, 'release', 20)) ctx.release(green[0].id);
    if (every(ctx, 'feed', 45, 20)) for (const c of grazers(w).filter((x) => x.bondId && x.id < x.bondId)) feedBy(ctx, c);
  },
  '1-6': (ctx) => {
    // warm the water as the cold wave comes in, by about as much as it takes away
    const w = ctx.world;
    const wave = w.env.events.find((e) => !e.done && e.kind === 'coldwave');
    const k = wave ? eventEnvelope(wave, w.time) : 0;
    const want = Math.min(1, 0.5 + 0.34 * (wave?.intensity ?? 1) * k);
    if (Math.abs(w.env.settings.temperature - want) > 0.04) ctx.env({ temperature: want });
    if (k > 0.2 && every(ctx, 'feed', 15)) {
      const hungry = grazers(w).sort((a, b) => a.energy / a.ph.maxEnergy - b.energy / b.ph.maxEnergy)[0];
      if (hungry) feedBy(ctx, hungry);
    }
  },
  '1-7': (ctx) => {
    // a good season right away, and another each time the last has faded
    if (every(ctx, 'bloom', 170)) ctx.disaster('bloom');
  },
  '1-8': (ctx) => {
    PLANS['1-3'](ctx);
    PLANS['1-4'](ctx);
    PLANS['1-6'](ctx);
  },
};

/**
 * Play a level start to finish without a screen: the world runs at its own
 * fixed step, the plan (if any) acts once a simulated second.
 */
export function playLevel(def: LevelDef, plan?: BotPlan, each?: (ctx: BotCtx) => void): { run: LevelRun; world: World } {
  const world = createLevelWorld(def, 16 / 9);
  const run = new LevelRun(def, world);
  const ctx: BotCtx = {
    world,
    run,
    t: 0,
    mem: {},
    feed: (kind, x, y) => levelFeed(run, world, kind, x, y),
    pair: (a, b) => levelPair(run, world, a, b) === null,
    release: (id) => levelRelease(run, world, id),
    call: () => levelCall(run, world),
    env: (patch) => levelEnv(run, world, patch),
    disaster: (kind, x, y) => levelDisaster(run, world, kind, x, y),
  };
  let acc = 0;
  while (run.status === 'playing') {
    world.step(SIM_DT);
    acc += SIM_DT;
    if (acc < 1) continue;
    acc -= 1;
    ctx.t = run.elapsed(world);
    plan?.(ctx);
    run.update(world);
    each?.(ctx);
  }
  return { run, world };
}
