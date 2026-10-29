import type { StoryEvent } from '../sim/history/narrator';
import type { World } from '../sim/world';
import type { Profile } from './profile';

/**
 * 灵光: what the player earns from what really happens in their tanks, and
 * spends on new tools, tanks and life.
 */

export type ItemKind = 'unlock' | 'repeatable' | 'goods';
export type ShopGroup = '工具' | '水缸' | '生命' | '水草' | '装饰';

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
  /** Set down by hand: paid for when placed. */
  place?: boolean;
}

export const SHOP: readonly ShopItem[] = [
  { id: 'lens', name: '基因透镜', desc: '看见生命隐性携带的稀有基因，配对时也能看到后代出现稀有特征的概率。', kind: 'unlock', group: '工具', base: 120 },
  { id: 'nursery', name: '育种缸', desc: '一个没有掠食者的小水缸，把选中的生命搬进去安心培育。', kind: 'unlock', group: '水缸', base: 150 },
  { id: 'biome:abyss', name: '寒冷深渊', desc: '新水缸可以选择这种水：又冷又暗，生命耐寒、夜里活动，苔藓铺地，发光海葵和水母点亮黑暗。', kind: 'unlock', group: '水缸', base: 180 },
  { id: 'biome:reef', name: '暖光珊瑚礁', desc: '新水缸可以选择这种水：温暖明亮，生命颜色鲜艳，珊瑚和海葵丛中藏着小虾。', kind: 'unlock', group: '水缸', base: 180 },
  { id: 'tank-slot', name: '多一个水缸位', desc: '可以多养一个水缸。', kind: 'repeatable', group: '水缸', base: 220, growth: 2, max: 3 },
  { id: 'card-slot', name: '三个生命卡格子', desc: '多存三张生命卡。', kind: 'repeatable', group: '生命', base: 60, growth: 1.6, max: 6 },
  { id: 'founders:schooler', name: '一群成群游的小鱼', desc: '6 只爱结伴、动作轻快的小草食者，来到当前水缸。', kind: 'goods', group: '生命', base: 45 },
  { id: 'founders:browser', name: '几只长触角的漫游者', desc: '6 只圆润、独来独往、好奇心重的小生命。', kind: 'goods', group: '生命', base: 45 },
  { id: 'founders:nibbler', name: '几只夜里啃食的小家伙', desc: '6 只披着硬壳、夜里活动的底栖草食者。', kind: 'goods', group: '生命', base: 45 },
  { id: 'founders:drifter', name: '一群漂浮的触须精灵', desc: '6 只轻盈、触须繁多、繁殖很快的小生命。', kind: 'goods', group: '生命', base: 45 },
  { id: 'founders:glider', name: '一对滑翔的掠食者', desc: '2 只修长的夜行掠食者。会改变缸里的平衡，请想清楚。', kind: 'goods', group: '生命', base: 80, predators: true },
  { id: 'founders:lurker', name: '一对伏击的掠食者', desc: '2 只敦实的伏击者，在水草附近巡游。', kind: 'goods', group: '生命', base: 80, predators: true },
  { id: 'founders:jelly', name: '几只月光水母', desc: '5 只一张一缩、随水漂流的水母，在上层水里吃漂浮的藻类。和鱼不能配对。', kind: 'goods', group: '生命', base: 60 },
  { id: 'founders:shrimp', name: '一群小红虾', desc: '6 只贴着缸底活动的小虾，专吃沉下来的碎屑，也吃残渣。繁殖很快。', kind: 'goods', group: '生命', base: 50 },
  { id: 'founders:snail', name: '几只琥珀螺', desc: '4 只慢吞吞的螺，在缸底啃水草根和菌丝，壳很硬，掠食者咬不动。', kind: 'goods', group: '生命', base: 50 },
  { id: 'seeds', name: '一包水草种子', desc: '在当前水缸撒下 6 颗水草种子。', kind: 'goods', group: '水草', base: 20 },
  { id: 'moss', name: '一片苔藓', desc: '在缸底铺下 6 小片苔藓。它们会慢慢蔓延，是螺和小虾的食物，也让贴底的小生命不容易被发现。', kind: 'goods', group: '水草', base: 30 },
  { id: 'anemone', name: '发光海葵', desc: '一株夜里会发光的海葵，放在缸底。不能吃，小生命爱躲进它的触手里过夜。偶尔会分出新的一株。', kind: 'goods', group: '水草', base: 45, place: true },
  { id: 'decor:shelter', name: '岩洞', desc: '一块中空的岩石，放在缸底。小生命躲进去，掠食者就很难发现它们，也爱在里面过夜。', kind: 'goods', group: '装饰', base: 40, place: true },
  { id: 'decor:warmStone', name: '暖石', desc: '让周围的水暖上七八度。怕冷的生命在寒潮里会聚到它身边。', kind: 'goods', group: '装饰', base: 35, place: true },
  { id: 'decor:coolStone', name: '冷石', desc: '让周围的水凉下七八度，热浪里的避暑地。', kind: 'goods', group: '装饰', base: 35, place: true },
  { id: 'decor:lamp', name: '水灯', desc: '一盏柔和的灯，日夜照着附近的水草和藻类，让它们长得更好。', kind: 'goods', group: '装饰', base: 45, place: true },
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
