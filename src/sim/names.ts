import { wrap01 } from './core/math';
import type { Rng } from './core/rng';

const SOLO = [
  '汐', '萤', '苔', '澜', '溪', '芽', '露', '星', '雾', '霁', '澄', '漾', '泡', '糯', '栗', '桃',
  '杏', '柚', '茉', '棠', '荷', '萍', '珀', '璃', '晞', '岚', '汀', '涟', '漪', '沫', '芙', '蕊',
  '葵', '橙', '柠', '莓', '豆', '团', '绒', '布', '丁', '啾', '咕', '嘟', '波', '朵', '铃', '叮',
  '珊', '贝', '螺', '羽', '月', '云', '雨', '霜', '晴', '暮', '晨', '夕', '湫', '渺', '芊', '苒',
];
const DOUBLE_OK = [
  '糯', '团', '啾', '咕', '嘟', '泡', '豆', '朵', '铃', '叮', '星', '露', '萤', '圆', '绒', '波',
  '栗', '桃', '柚', '莓', '苔', '汐', '溪', '芽', '晴', '月', '云', '漾',
];
const FIRST = ['青', '星', '露', '云', '月', '晴', '澄', '汐', '萤', '苔', '雾', '溪', '棠', '荷', '栗', '桃', '小', '浅', '微', '晚'];
const SECOND = ['禾', '屑', '珠', '朵', '铃', '糖', '团', '泡', '沫', '影', '光', '芽', '叶', '果', '豆', '丸', '岚', '汀', '漪', '茸'];

export function creatureName(rng: Rng): string {
  const r = rng.next();
  if (r < 0.28) return '小' + rng.pick(SOLO);
  if (r < 0.42) return '阿' + rng.pick(SOLO);
  if (r < 0.66) {
    const c = rng.pick(DOUBLE_OK);
    return c + c;
  }
  let a = rng.pick(FIRST);
  let b = rng.pick(SECOND);
  if (a === b) b = rng.pick(SECOND);
  if (a === '小' && rng.chance(0.5)) a = rng.pick(FIRST);
  return a + b;
}

const FAMILY = [
  '澄溪', '青苔', '星屑', '晚汐', '雾岚', '春芽', '栗原', '萤野', '珊湾', '碧潭', '柚光', '白露', '霁月',
  '云渚', '汀兰', '苇岸', '萍洲', '晨曦', '浅湾', '石泉', '松涛', '月泊', '芦雪', '晴川', '鹭渚', '烟波',
  '琉璃', '暮山', '清漪', '花溆', '竹溪', '荷塘', '薄荷', '桂影', '远岫', '水湄', '幽篁', '落英', '流萤',
];

export function familyName(rng: Rng): string {
  return rng.pick(FAMILY);
}

const COLOR_STOPS: readonly [number, string, string][] = [
  [0.03, '绯', '绯红'],
  [0.075, '珊', '珊瑚色'],
  [0.12, '杏', '杏橙色'],
  [0.165, '金', '金色'],
  [0.215, '柠', '柠黄色'],
  [0.3, '苔', '苔绿色'],
  [0.4, '碧', '碧绿色'],
  [0.47, '青', '青色'],
  [0.545, '湖', '湖蓝色'],
  [0.635, '蓝', '蓝色'],
  [0.715, '靛', '靛蓝色'],
  [0.79, '紫', '紫色'],
  [0.87, '堇', '堇紫色'],
  [0.955, '桃', '桃粉色'],
  [1.01, '绯', '绯红'],
];

/** The named color bands, as hue intervals [from, to). */
export const COLOR_BANDS: readonly { char: string; word: string; from: number; to: number }[] = COLOR_STOPS.slice(0, -1).map(([to, char, word], i) => ({
  char,
  word,
  from: i === 0 ? -0.045 : COLOR_STOPS[i - 1][0],
  to,
}));

/** One-character color word, e.g. 蓝. */
export function colorChar(hue: number): string {
  const h = wrap01(hue);
  for (const [limit, c] of COLOR_STOPS) if (h < limit) return c;
  return '绯';
}

/** Descriptive color word, e.g. 湖蓝色. */
export function colorWord(hue: number): string {
  const h = wrap01(hue);
  for (const [limit, , w] of COLOR_STOPS) if (h < limit) return w;
  return '绯红';
}

export interface SpeciesNameTraits {
  hue: number;
  finSize: number;
  tentacles: number;
  tailLength: number;
  eyeSize: number;
  armor: number;
  perception: number;
  size: number;
  diet: number;
  /** Body plan (absent: fish). */
  morph?: 'fish' | 'jelly' | 'shrimp' | 'snail';
}

const MORPH_SUFFIX = { jelly: '水母', shrimp: '虾', snail: '螺' } as const;

/** Name a species after the traits of its founding cluster, e.g. 蓝鳍族 / 靛尾掠食者. */
export function speciesName(t: SpeciesNameTraits, taken: ReadonlySet<string>): string {
  const parts: [number, string][] = [
    [t.finSize, '鳍'],
    [t.tentacles, '须'],
    [t.tailLength, '尾'],
    [t.eyeSize, '瞳'],
    [t.armor, '甲'],
    [t.perception, '角'],
  ];
  // name a kind after what makes it distinctive, not merely what is large
  parts.sort((a, b) => Math.abs(b[0] - 0.45) - Math.abs(a[0] - 0.45));
  const color = colorChar(t.hue);
  const suffix = t.morph && t.morph !== 'fish' ? MORPH_SUFFIX[t.morph] : t.diet > 0.65 ? '掠食者' : t.diet > 0.35 ? '游者' : '族';
  const prefixes = t.size < 0.18 ? ['', '小'] : t.size > 0.6 && t.diet <= 0.65 ? ['', '大'] : [''];
  for (const p of prefixes) {
    for (const [, part] of parts) {
      const name = p + color + part + suffix;
      if (!taken.has(name)) return name;
    }
  }
  const alt = ['纹', '鳞', '羽', '冠', '翼', '斑'];
  for (const a of alt) {
    const name = color + a + suffix;
    if (!taken.has(name)) return name;
  }
  let i = 2;
  while (taken.has(color + parts[0][1] + suffix + i)) i++;
  return color + parts[0][1] + suffix + i;
}

const WORLD_A = ['微光', '静谧', '澄澈', '晨雾', '星屑', '月影', '青苔', '浮生', '琉璃', '薄荷', '萤火', '潮汐', '初雪', '松风'];
const WORLD_B = ['浅湾', '水境', '之潭', '小宇宙', '生态缸', '秘境', '苔原', '水底花园', '湖心', '泉眼'];

export function worldName(rng: Rng): string {
  return rng.pick(WORLD_A) + rng.pick(WORLD_B);
}
