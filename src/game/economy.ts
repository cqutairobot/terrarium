import type { StoryEvent } from '../sim/history/narrator';
import type { World } from '../sim/world';
import type { Profile } from './profile';

/**
 * 灵光: what the player earns from what really happens in their tanks, and
 * spends on new tools, tanks and life.
 */

export type ItemKind = 'unlock' | 'repeatable' | 'goods';
export type ShopGroup = '工具' | '水缸' | '生命' | '水草';

export interface ShopItem {
  id: string;
  name: string;
  desc: string;
  kind: ItemKind;
  group: ShopGroup;
  /** First price; repeatables grow by `growth` each time. */
  base: number;
  growth?: number;
  max?: number;
  /** Goods delivered into the shown tank: not into a nursery if it would bring predators there. */
  predators?: boolean;
}

export const SHOP: readonly ShopItem[] = [
  { id: 'lens', name: '基因透镜', desc: '看见生命隐性携带的稀有基因，配对时也能看到后代出现稀有特征的概率。', kind: 'unlock', group: '工具', base: 120 },
  { id: 'nursery', name: '育种缸', desc: '一个没有掠食者的小水缸，把选中的生命搬进去安心培育。', kind: 'unlock', group: '水缸', base: 150 },
  { id: 'tank-slot', name: '多一个水缸位', desc: '可以多养一个水缸。', kind: 'repeatable', group: '水缸', base: 220, growth: 2, max: 3 },
  { id: 'card-slot', name: '三个生命卡格子', desc: '多存三张生命卡。', kind: 'repeatable', group: '生命', base: 60, growth: 1.6, max: 6 },
  { id: 'founders:schooler', name: '一群成群游的小鱼', desc: '6 只爱结伴、动作轻快的小草食者，来到当前水缸。', kind: 'goods', group: '生命', base: 45 },
  { id: 'founders:browser', name: '几只长触角的漫游者', desc: '6 只圆润、独来独往、好奇心重的小生命。', kind: 'goods', group: '生命', base: 45 },
  { id: 'founders:nibbler', name: '几只夜里啃食的小家伙', desc: '6 只披着硬壳、夜里活动的底栖草食者。', kind: 'goods', group: '生命', base: 45 },
  { id: 'founders:drifter', name: '一群漂浮的触须精灵', desc: '6 只轻盈、触须繁多、繁殖很快的小生命。', kind: 'goods', group: '生命', base: 45 },
  { id: 'founders:glider', name: '一对滑翔的掠食者', desc: '2 只修长的夜行掠食者。会改变缸里的平衡，请想清楚。', kind: 'goods', group: '生命', base: 80, predators: true },
  { id: 'founders:lurker', name: '一对伏击的掠食者', desc: '2 只敦实的伏击者，在水草附近巡游。', kind: 'goods', group: '生命', base: 80, predators: true },
  { id: 'seeds', name: '一包水草种子', desc: '在当前水缸撒下 6 颗水草种子。', kind: 'goods', group: '水草', base: 20 },
];

export function itemById(id: string): ShopItem | undefined {
  return SHOP.find((i) => i.id === id);
}

export function owned(p: Profile, id: string): number {
  return p.unlocks.filter((u) => u === id).length;
}

export function has(p: Profile, id: string): boolean {
  return p.unlocks.includes(id);
}

export function priceOf(p: Profile, item: ShopItem): number {
  return Math.round(item.base * Math.pow(item.growth ?? 1, item.kind === 'repeatable' ? owned(p, item.id) : 0));
}

/** Whether the player can buy it now, and if not, why. */
export function canBuy(p: Profile, item: ShopItem): { ok: boolean; why?: string } {
  if (item.kind === 'unlock' && has(p, item.id)) return { ok: false, why: '已拥有' };
  if (item.kind === 'repeatable' && item.max !== undefined && owned(p, item.id) >= item.max) return { ok: false, why: '已到上限' };
  if (p.lumen < priceOf(p, item)) return { ok: false, why: '灵光不够' };
  return { ok: true };
}

export function cardLimit(p: Profile): number {
  return p.cardSlots + 3 * owned(p, 'card-slot');
}

export interface Reward {
  amount: number;
  reason: string;
  /** A first-ever discovery across all of the player's tanks. */
  flag?: string;
}

/** Lumen for something real that happened in a tank (read from its chronicle). */
export function rewardFor(e: StoryEvent, p: Profile): Reward | null {
  const key = String(e.p.key ?? '');
  switch (e.k) {
    case 'rareFirst': {
      const flag = 'rare:' + key;
      if (!p.flags[flag]) return { amount: 50, reason: `第一次见到「${e.p.trait}」`, flag };
      return { amount: 15, reason: `又一个水缸出现了「${e.p.trait}」` };
    }
    case 'rareReturn':
      return { amount: 10, reason: `「${e.p.trait}」重新出现` };
    case 'rareSpread':
      return e.i >= 3 ? { amount: 10, reason: `「${e.p.trait}」在族群里传开了` } : null;
    case 'speciation':
      return { amount: 15, reason: `新的族群「${e.p.species}」诞生` };
    case 'generation':
      return { amount: e.i >= 3 ? 20 : 8, reason: `繁衍到第 ${e.p.n} 代` };
    case 'oldestFamily':
      return { amount: 15, reason: `${e.p.family}家延续了 ${e.p.n} 代` };
    case 'watchDescendants':
      return { amount: 5, reason: `${e.p.name}的血脉延续到第 ${e.p.n} 代后裔` };
    case 'firstBirth':
      return { amount: 10, reason: '水缸里的第一个孩子' };
    default:
      return null;
  }
}

/** Gentle income from a living, varied tank, per simulated minute. */
export function vitalityPerMinute(world: World): number {
  const ids = new Set<number>();
  let predators = 0;
  for (const c of world.creatures) {
    if (c.dying > 0 || c.stage === 'egg') continue;
    ids.add(c.speciesId);
    if (c.ph.trophic === 'carnivore') predators++;
  }
  return Math.min(6, ids.size) * 0.25 + (predators > 0 ? 0.25 : 0);
}
