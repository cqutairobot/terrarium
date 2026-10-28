import type { DisasterKind } from '../../sim/environment';
import { triggerDisaster } from '../../sim/systems/weather';
import type { World } from '../../sim/world';
import { evaluate, newTracker, type CondStatus } from '../conditions';
import { placeFounders } from './setup';
import type { LevelDef, LevelStatus, StarRule, ToolKind } from './types';

/** How many uses of a tool a level gives (undefined: not allowed). */
export function capOf(def: LevelDef, tool: ToolKind): number | undefined {
  const t = def.tools;
  if (tool.startsWith('disaster:')) return t.disasters?.[tool.slice(9) as DisasterKind];
  if (tool === 'call') return t.call?.uses;
  return t[tool as 'food' | 'rich' | 'spore' | 'pair' | 'release'];
}

/** A disaster the level has announced: where and when it will strike. */
export interface Warning {
  kind: DisasterKind;
  x: number;
  y: number;
  /** Seconds into the level when it strikes. */
  at: number;
}

/** Where the small life is thickest: the middle of the densest stretch of water. */
export function crowdCenter(world: World): { x: number; y: number } {
  const cons = world.creatures.filter((c) => c.dying === 0 && c.stage !== 'egg' && c.ph.trophic !== 'carnivore');
  if (!cons.length) return { x: world.width / 2, y: world.height * 0.6 };
  let best = cons[0];
  let bestN = -1;
  for (const c of cons) {
    let n = 0;
    for (const o of cons) if (Math.abs(o.x - c.x) < 120 && Math.abs(o.y - c.y) < 120) n++;
    if (n > bestN) {
      bestN = n;
      best = c;
    }
  }
  const near = cons.filter((o) => Math.abs(o.x - best.x) < 120 && Math.abs(o.y - best.y) < 120);
  return { x: near.reduce((a, c) => a + c.x, 0) / near.length, y: near.reduce((a, c) => a + c.y, 0) / near.length };
}

/**
 * One attempt at a level: it keeps time, fires the level's own events,
 * judges goals and failures from the real world state, counts the tools
 * used, and grades the result. It knows nothing about the screen, so the
 * same run drives the game and the headless test bots.
 */
export class LevelRun {
  status: LevelStatus = 'playing';
  /** Why the level was lost. */
  reason = '';
  /** Simulated seconds from start to the end of the attempt. */
  endT = 0;
  used: Partial<Record<ToolKind, number>> = {};
  goals: CondStatus[] = [];
  /** Which stars were earned: [won, first extra, second extra]. */
  starHits: [boolean, boolean, boolean] = [false, false, false];
  /** Things the level wants to say as they happen (drained by the host). */
  messages: string[] = [];
  /** Announced disasters still to come. */
  warnings: Warning[] = [];
  private readonly startT: number;
  private tracker = newTracker();
  private fired = new Set<number>();

  constructor(
    readonly def: LevelDef,
    world: World,
  ) {
    this.startT = world.time;
    this.goals = def.goals.map(() => ({ met: false, progress: 0, value: 0 }));
  }

  elapsed(world: World): number {
    return world.time - this.startT;
  }

  remaining(world: World): number {
    return Math.max(0, this.def.timeLimit - this.elapsed(world));
  }

  get stars(): number {
    return this.starHits.filter(Boolean).length;
  }

  /** Uses left of a tool: Infinity when free, 0 when not allowed or spent. */
  left(tool: ToolKind): number {
    const cap = capOf(this.def, tool);
    return cap === undefined ? 0 : cap - (this.used[tool] ?? 0);
  }

  /** Spend one use of a tool; false if it is not allowed or used up. */
  use(tool: ToolKind): boolean {
    if (this.status !== 'playing' || this.left(tool) <= 0) return false;
    this.used[tool] = (this.used[tool] ?? 0) + 1;
    return true;
  }

  /** Advance the level's own clock: events, failures, goals, time. Call once per simulated second or so. */
  update(world: World): void {
    if (this.status !== 'playing') return;
    const t = this.elapsed(world);
    (this.def.events ?? []).forEach((e, i) => {
      if (this.fired.has(i)) return;
      if (e.k === 'disaster') {
        const warnAt = e.at - (e.warn ?? 0);
        if (t >= warnAt && !this.warnings.some((w) => w.at === e.at && w.kind === e.kind)) {
          const spot = e.aim === 'crowd' ? crowdCenter(world) : { x: e.x ?? world.width / 2, y: e.y ?? world.height * 0.6 };
          this.warnings.push({ kind: e.kind, x: spot.x, y: spot.y, at: e.at });
          if (e.say) this.messages.push(e.say);
        }
        if (t < e.at) return;
        const w = this.warnings.find((x) => x.at === e.at && x.kind === e.kind)!;
        this.warnings = this.warnings.filter((x) => x !== w);
        this.fired.add(i);
        triggerDisaster(world, e.kind, {
          x: e.aim || e.x !== undefined ? w.x : undefined,
          y: e.aim || e.y !== undefined ? w.y : undefined,
          intensity: e.intensity,
        });
        return;
      }
      if (t < e.at) return;
      this.fired.add(i);
      placeFounders(world, e.step);
      if (e.say) this.messages.push(e.say);
    });
    for (const f of this.def.fails ?? []) {
      if (t >= (f.after ?? 0) && evaluate(world, f.cond).met) {
        this.lose(world, f.say);
        return;
      }
    }
    const instant = this.def.goals.filter((g) => !g.atEnd).length === this.def.goals.length;
    this.goals = this.def.goals.map((g, i) => evaluate(world, g.cond, this.tracker, `g${i}`));
    if (instant && this.goals.every((g) => g.met)) {
      this.win(world);
      return;
    }
    if (t >= this.def.timeLimit) {
      if (!instant && this.goals.every((g) => g.met)) this.win(world);
      else this.lose(world, '时间到了');
    }
  }

  private judge(world: World, rule: StarRule): boolean {
    switch (rule.k) {
      case 'time':
        return this.endT <= rule.under;
      case 'spare':
        return this.left(rule.tool) >= rule.atLeast;
      case 'cond':
        return evaluate(world, rule.cond).met;
    }
  }

  private win(world: World): void {
    this.status = 'won';
    this.endT = this.elapsed(world);
    this.starHits = [true, this.judge(world, this.def.stars[0]), this.judge(world, this.def.stars[1])];
  }

  private lose(world: World, reason: string): void {
    this.status = 'lost';
    this.reason = reason;
    this.endT = this.elapsed(world);
  }
}

/** How a star is earned, in words. */
export function describeStar(rule: StarRule): string {
  switch (rule.k) {
    case 'time':
      return `在 ${Math.round(rule.under / 60)} 分钟内完成`;
    case 'spare': {
      const names: Record<string, string> = { food: '营养颗粒', rich: '高能食物', spore: '发光孢子', pair: '配对', release: '放生', call: '召唤' };
      const name = names[rule.tool] ?? '灾害';
      return `结束时还剩至少 ${rule.atLeast} 次${name}`;
    }
    case 'cond':
      return rule.label;
  }
}
