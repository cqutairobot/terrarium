import { celsius } from '../sim/config';
import type { Creature } from '../sim/entities/creature';
import { formatAge, formatDuration } from '../sim/history/narrator';
import type { World } from '../sim/world';

export { formatAge, formatDuration };

/** "第 3 个昼夜 · 14:20" — the world's own calendar. */
export function worldClock(world: World): string {
  const day = Math.floor(world.time / world.cfg.dayLength) + 1;
  const minutes = Math.floor((((6 + world.env.dayPhase * 24) % 24) * 60) % 1440);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `第 ${day} 个昼夜 · ${hh}:${mm}`;
}

export function wallTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function tempLabel(t: number): string {
  return `${celsius(t).toFixed(1)}°C`;
}

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** Personality words derived from the genes that drive behavior. */
export function personality(c: Creature): string[] {
  const ph = c.ph;
  const tags: string[] = [];
  if (ph.timidity > 0.66) tags.push('胆小');
  else if (ph.timidity < 0.3) tags.push('大胆');
  if (ph.curiosity > 0.66) tags.push('好奇');
  if (ph.activity > 0.66) tags.push('活跃');
  else if (ph.activity < 0.34) tags.push('懒惰');
  if (ph.sociability > 0.66) tags.push('合群');
  else if (ph.sociability < 0.3) tags.push('独行');
  if (ph.aggression > 0.62) tags.push('好斗');
  else if (ph.aggression < 0.22) tags.push('温和');
  if (ph.nocturnality > 0.62) tags.push('夜行');
  if (tags.length === 0) tags.push('随和');
  return tags.slice(0, 4);
}

export const STAGE_LABELS = { egg: '卵', juvenile: '幼体', adult: '成年', elder: '老年' } as const;

export const TROPHIC_LABELS = { herbivore: '草食', omnivore: '杂食', carnivore: '肉食' } as const;
