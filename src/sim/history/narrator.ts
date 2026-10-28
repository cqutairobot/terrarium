import { hash32 } from '../core/rng';
import { G, GENE_KEYS, type Phenotype } from '../genome';
import { colorWord } from '../names';

/** Everything the chronicle and the log can say. Stored as kind + params. */
export type StoryKind =
  | 'worldBorn'
  | 'firstBirth'
  | 'firstMutation'
  | 'birthNotable'
  | 'twins'
  | 'rareFirst'
  | 'rareSpread'
  | 'rareVanished'
  | 'rareLost'
  | 'rareReturn'
  | 'popMilestone'
  | 'dominance'
  | 'speciation'
  | 'speciesExtinct'
  | 'firstExtinction'
  | 'familyDepth'
  | 'oldestFamily'
  | 'familyEnd'
  | 'generation'
  | 'disasterStart'
  | 'disasterEnd'
  | 'allGone'
  | 'revival'
  | 'predatorArrive'
  | 'predatorsGone'
  | 'traitDrift'
  | 'longevity'
  | 'elderDeath'
  | 'escape'
  | 'watchBorn'
  | 'watchFirstMeal'
  | 'watchParent'
  | 'watchChildren'
  | 'watchDisaster'
  | 'watchEscape'
  | 'watchElder'
  | 'watchDeath'
  | 'watchDescendants';

export type Importance = 1 | 2 | 3;

export interface StoryEvent {
  id: number;
  /** Simulated time. */
  t: number;
  /** Wall clock (ms). */
  w: number;
  k: StoryKind;
  /** 1 ambient, 2 notable, 3 major (kept in the chronicle). */
  i: Importance;
  p: Record<string, string | number>;
}

export type StoryCategory = 'world' | 'life' | 'species' | 'family' | 'rare' | 'disaster' | 'watch';

export function categoryOf(k: StoryKind): StoryCategory {
  if (k.startsWith('watch')) return 'watch';
  if (k.startsWith('rare')) return 'rare';
  if (k === 'disasterStart' || k === 'disasterEnd') return 'disaster';
  if (k === 'familyDepth' || k === 'oldestFamily' || k === 'familyEnd') return 'family';
  if (
    k === 'popMilestone' ||
    k === 'dominance' ||
    k === 'speciation' ||
    k === 'speciesExtinct' ||
    k === 'firstExtinction' ||
    k === 'traitDrift' ||
    k === 'predatorArrive' ||
    k === 'predatorsGone'
  )
    return 'species';
  if (k === 'worldBorn' || k === 'allGone' || k === 'revival' || k === 'generation') return 'world';
  return 'life';
}

const DISASTER_START: Record<string, [string, string]> = {
  storm: ['雨开始落下，水流变得湍急起来。', '一场细雨落在水面上。'],
  coldwave: ['寒潮来了，水一点一点变冷。', '水温悄悄降了一些。'],
  heatwave: ['热浪笼罩了水面，一切都变得躁动。', '水面晒得有些暖了。'],
  meteor: ['一颗流星划过夜空，坠入了水中。', '一颗流星划过夜空，坠入了水中。'],
  bloom: ['万物开始疯长，一场繁荣正在到来。', '水草们迎来了一段好时光。'],
};

const DISASTER_NAMES: Record<string, string> = {
  storm: '暴雨',
  coldwave: '寒潮',
  heatwave: '热浪',
  meteor: '流星',
  bloom: '生态繁荣',
};

const NATURAL_NAMES: Record<string, string> = {
  storm: '阵雨',
  coldwave: '冷空气',
  heatwave: '暖流',
  meteor: '流星',
  bloom: '好时节',
};

function pick(e: StoryEvent, options: string[]): string {
  return options[Math.floor(hash32(e.id * 7919 + 13) * options.length)];
}

function fill(template: string, p: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (p[k] !== undefined ? String(p[k]) : ''));
}

/** Render a stored event as gentle Chinese prose. */
export function narrate(e: StoryEvent): string {
  const p = e.p;
  switch (e.k) {
    case 'worldBorn':
      return fill(pick(e, ['{world}在一滴水里醒来。', '第一缕光落进了{world}，生命开始了。']), p);
    case 'firstBirth':
      return fill('第一个新生命诞生了——{name}，它是{pa}与{pb}的孩子。', p);
    case 'firstMutation':
      return fill('{name}的身上出现了这个世界的第一次变异：{desc}。', p);
    case 'birthNotable':
      return fill(pick(e, ['第 {gen} 代，一只拥有{desc}的小生命诞生了。', '第 {gen} 代里，{name}带着{desc}来到了这个世界。']), p);
    case 'twins':
      return fill('{pa}和{pb}迎来了一对双胞胎。', p);
    case 'rareFirst':
      return fill(
        pick(e, ['一只{trait}的小生命出现了。这个世界从未见过它的模样。', '{name}出生了，带着{trait}——它是世界上的第一只。']),
        p,
      );
    case 'rareSpread':
      return fill('{trait}正在族群里悄悄蔓延，如今已有 {n} 只。', p);
    case 'rareVanished':
      return fill('最后一只{trait}的小生命离开了。也许它的血脉里，还藏着这份奇迹。', p);
    case 'rareLost':
      return fill('{trait}的基因，从这个世界上彻底消失了。', p);
    case 'rareReturn':
      return fill('消失了{gap}的{trait}，又一次回到了这个世界。', p);
    case 'popMilestone':
      return fill(pick(e, ['{species}突破了 {n} 只。', '{species}的数量第一次超过了 {n}。']), p);
    case 'dominance':
      return fill('{species}成为了这片水域里最繁盛的族群。', p);
    case 'speciation':
      return fill(pick(e, ['一支{color}的族群渐渐走上了自己的路——{species}诞生了。', '{parent}之中分化出了新的族群：{species}。']), p);
    case 'speciesExtinct':
      return fill('最后一只{species}离开了这个世界。', p);
    case 'firstExtinction':
      return fill('这个世界经历了第一次物种灭绝：{species}再也不会出现了。', p);
    case 'familyDepth':
      return fill('{family}家已经延续了 {n} 代。', p);
    case 'oldestFamily':
      return fill('最古老的家族已经延续了 {n} 代——{family}家。', p);
    case 'familyEnd':
      return fill('延续了 {n} 代的{family}家，走到了尽头。', p);
    case 'generation':
      return fill('这个世界迎来了第 {n} 代生命。', p);
    case 'disasterStart': {
      const pair = DISASTER_START[String(p.kind)] ?? ['天气变了。', '天气变了。'];
      return p.natural ? pair[1] : pair[0];
    }
    case 'disasterEnd':
      return disasterSummary(p);
    case 'allGone':
      return p.kind === 'predator' ? '最后一只掠食者消失了，水里少了一份警觉。' : '水里安静了下来。所有游动的生命都已离去。';
    case 'revival':
      return p.fromBank ? '沉睡在泥沙里的孢子醒来了，生命重新开始。' : '新的生命从泥沙中苏醒。';
    case 'predatorArrive':
      return p.fromBank ? '一只似曾相识的大型生物，从深处游了回来。' : '一只陌生的大型生物从深处游来。';
    case 'predatorsGone':
      return '最后一只掠食者消失了，水里少了一份警觉。';
    case 'traitDrift':
      return fill('比起最初的祖先，如今的{species}{phrase}。', p);
    case 'longevity':
      return fill('{name}成为了这个世界有史以来最长寿的生命：{age}。', p);
    case 'elderDeath':
      return fill('{name}在{age}之后安静地离开了，留下了 {children} 个孩子。', p);
    case 'escape':
      return fill('{name}从{predator}的追捕中逃脱了。', p);
    case 'watchBorn':
      return fill('{name}出生在{place}，父母是{pa}与{pb}。', p);
    case 'watchFirstMeal':
      return fill('{name}第一次找到了食物。', p);
    case 'watchParent':
      return fill('{name}第一次成为了父母。', p);
    case 'watchChildren':
      return fill('{name}已经有了 {n} 个孩子。', p);
    case 'watchDisaster':
      return fill('{name}挺过了一场{kind}。', p);
    case 'watchEscape':
      return fill('{name}从掠食者口中逃脱了。', p);
    case 'watchElder':
      return fill('{name}慢慢老了。', p);
    case 'watchDeath':
      return fill('{name}因{cause}离开了这个世界，享年{age}，留下了 {children} 个孩子。', p);
    case 'watchDescendants':
      return fill('{name}的血脉已经延续到了第 {n} 代后裔。', p);
  }
  return '';
}

function disasterSummary(p: Record<string, string | number>): string {
  const label = p.natural ? NATURAL_NAMES[String(p.kind)] : DISASTER_NAMES[String(p.kind)];
  const plantPct = Number(p.plantPct ?? 0);
  const excess = Number(p.excess ?? 0);
  if (p.kind === 'meteor') {
    const killed = Number(p.impactKills ?? 0);
    const head = killed > 0 ? `流星坠落的地方，${killed} 个小生命化作了光` : '流星坠落的地方没有生命受伤';
    return `${head}；那片泥土里，留下了闪烁的星尘。`;
  }
  const parts: string[] = [];
  if (Math.abs(plantPct) >= 10) {
    parts.push(plantPct < 0 ? `一场${label}让植物减少了 ${Math.abs(plantPct)}%` : `一场${label}让水草多长了 ${plantPct}%`);
  }
  if (excess >= 5) parts.push(`比平时多离去了 ${excess} 个小生命`);
  if (parts.length === 0) return `${label}过去了，水里又恢复了平静。`;
  if (parts.length === 1 && parts[0].startsWith('一场')) return parts[0] + '。';
  if (parts.length === 1) return `${label}过去了，${parts[0]}。`;
  return `${parts[0]}，${parts[1]}。`;
}

const VISIBLE_GENES = new Set([G.hue, G.accentHue, G.size, G.elongation, G.tailLength, G.finSize, G.tentacles, G.eyeSize, G.brightness]);

const MUTATION_PHRASES: Record<string, [string, string]> = {
  size: ['更大的身体', '小巧的身体'],
  speed: ['更快的游速', '悠缓的游姿'],
  perception: ['更敏锐的感知', '迟钝的感知'],
  metabolism: ['更旺盛的代谢', '更慢的代谢'],
  longevity: ['更长的寿命', '更短的寿命'],
  fertility: ['旺盛的繁殖力', '少生优育的天性'],
  aggression: ['好斗的性情', '温和的性情'],
  armor: ['更坚硬的外壳', '更柔软的身体'],
  sociability: ['更合群的性子', '独来独往的性子'],
  curiosity: ['格外的好奇心', '安于现状的性子'],
  timidity: ['更胆小的性子', '更大胆的性子'],
  activity: ['活泼的性子', '慵懒的性子'],
  nocturnality: ['夜行的习性', '日行的习性'],
  thermalPref: ['喜暖的体质', '耐寒的体质'],
  diet: ['偏爱肉食的口味', '偏爱素食的口味'],
  brightness: ['明亮的颜色', '素淡的颜色'],
  elongation: ['修长的身形', '圆润的身形'],
  tailLength: ['长长的尾巴', '短短的尾巴'],
  finSize: ['宽大的鳍', '小小的鳍'],
  tentacles: ['更多的触须', '更少的触须'],
  eyeSize: ['大大的眼睛', '细小的眼睛'],
};

/** Describe a notable mutation in words, e.g. 紫色触须 / 更大的身体. */
export function describeMutation(gene: number, delta: number, ph: Phenotype): string {
  if (gene === G.hue) return colorWord(ph.hue) + '的身体';
  if (gene === G.accentHue) {
    const part = ph.tentacleCount > 0 ? '触须' : ph.finSize > 0.7 ? '鳍' : '尾巴';
    return colorWord(ph.accentHue) + part;
  }
  const key = GENE_KEYS[gene];
  const pair = MUTATION_PHRASES[key];
  return pair ? (delta > 0 ? pair[0] : pair[1]) : '不一样的基因';
}

/** Prefer describing a mutation people can see (codes: gene, or gene + 50 when lowered). */
export function mostVisible(mutations: number[]): number {
  for (const m of mutations) if (VISIBLE_GENES.has(m % 50)) return m;
  return mutations[0];
}

/** "3小时12分" style duration for simulated seconds. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}天${h}小时`;
  if (h > 0) return `${h}小时${m}分`;
  if (m > 0) return `${m}分${s % 60 >= 30 ? '半' : ''}`.replace('分半', '分半');
  return `${s}秒`;
}

/** Age in friendly words (simulated seconds). */
export function formatAge(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分${s % 60 ? (s % 60) + '秒' : ''}`;
  const h = Math.floor(m / 60);
  return `${h}小时${m % 60}分`;
}
