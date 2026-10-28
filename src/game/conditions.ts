import { wrap01 } from '../sim/core/math';
import { celsius } from '../sim/config';
import type { Creature } from '../sim/entities/creature';
import type { Trophic } from '../sim/genome';
import { formatAge, formatDuration } from '../sim/history/narrator';
import { rareKeyLabel, rareTraitKeys } from '../sim/rareTraits';
import type { World } from '../sim/world';

/**
 * Goals shared by requests (育种委托) and challenge levels: plain data,
 * judged against the real state of a world, with a progress value for bars.
 */

/** An inclusive numeric range; either end may be open. */
export type Range = [number | null, number | null];

export type Measure = 'size' | 'speed' | 'sense' | 'lifespan' | 'tentacles' | 'tail' | 'fins' | 'eyes' | 'warmth' | 'night' | 'boldness';

interface MeasureDef {
  label: string;
  get(c: Creature): number;
  /** How a value reads in a sentence. */
  fmt(v: number): string;
}

const num = (digits: number) => (v: number) => v.toFixed(digits);

/** Observable qualities a goal can ask for (all read from the phenotype). */
export const MEASURES: Record<Measure, MeasureDef> = {
  size: { label: '体型', get: (c) => c.ph.radius, fmt: num(1) },
  speed: { label: '速度', get: (c) => c.ph.maxSpeed, fmt: num(0) },
  sense: { label: '感知', get: (c) => c.ph.senseRadius, fmt: num(0) },
  lifespan: { label: '寿命', get: (c) => c.ph.lifespan, fmt: (v) => formatAge(v) },
  tentacles: { label: '触须', get: (c) => c.ph.tentacleCount, fmt: num(0) },
  tail: { label: '尾巴', get: (c) => c.ph.tailLen, fmt: num(2) },
  fins: { label: '鳍', get: (c) => c.ph.finSize, fmt: num(2) },
  eyes: { label: '眼睛', get: (c) => c.ph.eyeSize, fmt: num(2) },
  warmth: { label: '适温', get: (c) => celsius(c.ph.thermalPref), fmt: (v) => `${v.toFixed(0)}°C` },
  night: { label: '夜行', get: (c) => c.ph.nocturnality, fmt: num(2) },
  boldness: { label: '胆量', get: (c) => 1 - c.ph.timidity, fmt: num(2) },
};

/** A hue interval [from, to) on the color wheel; `from` may be negative to wrap past red. */
export interface HueBand {
  from: number;
  to: number;
  word: string;
}

export function inHueBand(hue: number, band: HueBand): boolean {
  const h = wrap01(hue);
  if (band.from < 0) return h >= band.from + 1 || h < band.to;
  return h >= band.from && h < band.to;
}

/** What a sought-after creature looks like and can do. */
export interface CreatureSpec {
  hue?: HueBand;
  ranges?: Partial<Record<Measure, Range>>;
  /** Rare traits it must show (codex keys). */
  rare?: string[];
  trophic?: Trophic;
  /** Only grown-ups count. */
  adult?: boolean;
  minGeneration?: number;
}

/** The color a creature shows (golden bodies read as gold). */
export function shownHue(c: Creature): number {
  return c.ph.rare.golden ? 0.13 : c.ph.hue;
}

function inRange(v: number, [lo, hi]: Range): boolean {
  return (lo === null || v >= lo) && (hi === null || v <= hi);
}

/** Each criterion of a spec, checked separately (for "nearly there" hints). */
export function specChecks(c: Creature, spec: CreatureSpec): { label: string; ok: boolean }[] {
  const out: { label: string; ok: boolean }[] = [];
  if (spec.hue) out.push({ label: spec.hue.word, ok: inHueBand(shownHue(c), spec.hue) });
  for (const [m, r] of Object.entries(spec.ranges ?? {}) as [Measure, Range][]) {
    out.push({ label: rangePhrase(m, r), ok: inRange(MEASURES[m].get(c), r) });
  }
  if (spec.rare?.length) {
    const keys = rareTraitKeys(c.ph.rare);
    for (const k of spec.rare) out.push({ label: `有${rareKeyLabel(k)}`, ok: keys.includes(k) });
  }
  if (spec.trophic) out.push({ label: TROPHIC_WORDS[spec.trophic], ok: c.ph.trophic === spec.trophic });
  if (spec.adult) out.push({ label: '已经成年', ok: c.stage === 'adult' || c.stage === 'elder' });
  if (spec.minGeneration !== undefined) out.push({ label: `第 ${spec.minGeneration} 代以后`, ok: c.generation >= spec.minGeneration });
  return out;
}

export function matchesSpec(c: Creature, spec: CreatureSpec): boolean {
  if (c.dying > 0 || c.stage === 'egg') return false;
  return specChecks(c, spec).every((x) => x.ok);
}

/** Share of a spec's criteria a creature already meets (0–1). */
export function specCloseness(c: Creature, spec: CreatureSpec): number {
  const checks = specChecks(c, spec);
  return checks.length ? checks.filter((x) => x.ok).length / checks.length : 1;
}

export type Condition =
  /** Living (hatched) creatures of a kind, within bounds. */
  | { k: 'population'; who: 'consumer' | 'predator' | 'all'; min?: number; max?: number }
  /** Species with living members. */
  | { k: 'species'; min: number }
  /** Living creatures that fit a description. */
  | { k: 'matching'; spec: CreatureSpec; min: number }
  /** Living creatures that show a rare trait. */
  | { k: 'rare'; key: string; min: number }
  /** The highest generation the tank has reached. */
  | { k: 'generation'; min: number }
  /** The deepest a watched bloodline has gone (generations of descendants). */
  | { k: 'bloodline'; min: number }
  /** Share of the floor covered by plants (0–1). */
  | { k: 'plants'; min?: number; max?: number }
  /** Clumps of algae. */
  | { k: 'algae'; min?: number; max?: number }
  /** Mean of a quality among living consumers. */
  | { k: 'mean'; measure: Measure; min?: number; max?: number }
  /** Another condition that must stay true for a while. */
  | { k: 'hold'; cond: Condition; seconds: number }
  /** Every one of several conditions. */
  | { k: 'all'; of: Condition[] };

export interface CondStatus {
  met: boolean;
  /** 0–1, for progress bars. */
  progress: number;
  /** What was measured (count, share, seconds...). */
  value: number;
}

/** Remembers since when 'hold' conditions have been true (serializable). */
export interface Tracker {
  since: Record<string, number>;
}

export function newTracker(): Tracker {
  return { since: {} };
}

function living(world: World): Creature[] {
  return world.creatures.filter((c) => c.dying === 0 && c.stage !== 'egg');
}

/** Share of the floor under plants: the same measure the statistics use. */
export function plantCoverage(world: World): number {
  const bins = new Float64Array(64);
  for (const p of world.producers) {
    if (p.kind !== 'plant') continue;
    bins[Math.min(63, Math.floor((p.x / world.width) * 64))] += p.biomass;
  }
  let covered = 0;
  for (const b of bins) if (b > 30) covered++;
  return covered / 64;
}

/** Judge bounds: the closer to the target, the fuller the bar. */
function bounded(value: number, min?: number, max?: number): CondStatus {
  const okMin = min === undefined || value >= min;
  const okMax = max === undefined || value <= max;
  let progress = 1;
  if (!okMin) progress = min! > 0 ? Math.max(0, value / min!) : 0;
  else if (!okMax) progress = value > 0 ? Math.max(0, max! / value) : 0;
  return { met: okMin && okMax, progress: Math.min(1, progress), value };
}

/**
 * How a condition stands right now. `path` identifies this condition inside
 * a larger goal so 'hold' timers do not collide.
 */
export function evaluate(world: World, cond: Condition, tracker: Tracker = newTracker(), path = 'c'): CondStatus {
  switch (cond.k) {
    case 'population': {
      const n = living(world).filter((c) => cond.who === 'all' || (cond.who === 'predator') === (c.ph.trophic === 'carnivore')).length;
      return bounded(n, cond.min, cond.max);
    }
    case 'species': {
      const ids = new Set(living(world).map((c) => c.speciesId));
      return bounded(ids.size, cond.min);
    }
    case 'matching':
      return bounded(living(world).filter((c) => matchesSpec(c, cond.spec)).length, cond.min);
    case 'rare':
      return bounded(living(world).filter((c) => rareTraitKeys(c.ph.rare).includes(cond.key)).length, cond.min);
    case 'generation':
      return bounded(world.counters.generationsMax, cond.min);
    case 'bloodline': {
      let depth = 0;
      for (const s of world.history.stories.values()) if (s.watched) depth = Math.max(depth, s.maxDepth);
      return bounded(depth, cond.min);
    }
    case 'plants':
      return bounded(plantCoverage(world), cond.min, cond.max);
    case 'algae':
      return bounded(world.producers.filter((p) => p.kind === 'algae').length, cond.min, cond.max);
    case 'mean': {
      const cons = living(world).filter((c) => c.ph.trophic !== 'carnivore');
      const mean = cons.length ? cons.reduce((a, c) => a + MEASURES[cond.measure].get(c), 0) / cons.length : 0;
      const s = bounded(mean, cond.min, cond.max);
      return cons.length ? s : { met: false, progress: 0, value: 0 };
    }
    case 'hold': {
      const inner = evaluate(world, cond.cond, tracker, path + '.h');
      if (!inner.met) {
        delete tracker.since[path];
        return { met: false, progress: inner.progress * 0.5, value: 0 };
      }
      const since = (tracker.since[path] ??= world.time);
      const held = world.time - since;
      return { met: held >= cond.seconds, progress: 0.5 + 0.5 * Math.min(1, held / Math.max(1e-6, cond.seconds)), value: held };
    }
    case 'all': {
      const parts = cond.of.map((c, i) => evaluate(world, c, tracker, `${path}.${i}`));
      return {
        met: parts.every((p) => p.met),
        progress: parts.length ? parts.reduce((a, p) => a + p.progress, 0) / parts.length : 1,
        value: parts.filter((p) => p.met).length,
      };
    }
  }
}

const TROPHIC_WORDS: Record<Trophic, string> = { herbivore: '吃素', omnivore: '杂食', carnivore: '吃肉' };

const WHO_WORDS = { consumer: '小生命', predator: '掠食者', all: '生命' } as const;

function rangePhrase(m: Measure, [lo, hi]: Range): string {
  const d = MEASURES[m];
  if (m === 'tentacles') {
    if (lo !== null && hi === null) return `至少 ${lo} 根触须`;
    if (lo === null && hi !== null) return hi === 0 ? '没有触须' : `不超过 ${hi} 根触须`;
  }
  if (m === 'warmth') {
    if (lo === null && hi !== null) return `喜欢 ${d.fmt(hi)} 以下的凉水`;
    if (lo !== null && hi === null) return `喜欢 ${d.fmt(lo)} 以上的暖水`;
  }
  if (lo !== null && hi !== null) return `${d.label}在 ${d.fmt(lo)}–${d.fmt(hi)} 之间`;
  if (lo !== null) return `${d.label}至少 ${d.fmt(lo)}`;
  if (hi !== null) return `${d.label}不超过 ${d.fmt(hi)}`;
  return d.label;
}

/** "湖蓝色、体型至少 10.0、有星瞳的成年生命" */
export function describeSpec(spec: CreatureSpec): string {
  const parts: string[] = [];
  if (spec.hue) parts.push(spec.hue.word);
  for (const [m, r] of Object.entries(spec.ranges ?? {}) as [Measure, Range][]) parts.push(rangePhrase(m, r));
  for (const k of spec.rare ?? []) parts.push(`有${rareKeyLabel(k)}`);
  if (spec.trophic) parts.push(TROPHIC_WORDS[spec.trophic]);
  if (spec.minGeneration !== undefined) parts.push(`第 ${spec.minGeneration} 代以后`);
  const who = `${spec.adult ? '成年' : ''}生命`;
  return parts.length ? `${parts.join('、')}的${who}` : who;
}

/** A condition as a sentence for the request board or a level's goals. */
export function describeCondition(cond: Condition): string {
  switch (cond.k) {
    case 'population': {
      const who = WHO_WORDS[cond.who];
      if (cond.min !== undefined && cond.max !== undefined) return `让${who}保持在 ${cond.min}–${cond.max} 只之间`;
      if (cond.min !== undefined) return `让${who}达到 ${cond.min} 只`;
      return `让${who}不超过 ${cond.max} 只`;
    }
    case 'species':
      return `让 ${cond.min} 个族群同时生活在缸里`;
    case 'matching':
      return `让 ${cond.min} 只${describeSpec(cond.spec)}同时在世`;
    case 'rare':
      return `让 ${cond.min} 只拥有「${rareKeyLabel(cond.key)}」的生命同时在世`;
    case 'generation':
      return `繁衍到第 ${cond.min} 代`;
    case 'bloodline':
      return `让你关注的一条血脉延续 ${cond.min} 代`;
    case 'plants':
      if (cond.min !== undefined) return `让水草覆盖 ${Math.round(cond.min * 100)}% 以上的缸底`;
      return `让水草覆盖不超过 ${Math.round((cond.max ?? 1) * 100)}% 的缸底`;
    case 'algae':
      if (cond.max !== undefined) return `把藻类控制在 ${cond.max} 团以内`;
      return `让藻类至少有 ${cond.min} 团`;
    case 'mean': {
      const d = MEASURES[cond.measure];
      if (cond.min !== undefined) return `让小生命的平均${d.label}达到 ${d.fmt(cond.min)}`;
      return `让小生命的平均${d.label}降到 ${d.fmt(cond.max ?? 0)} 以下`;
    }
    case 'hold':
      return `${describeCondition(cond.cond)}，并保持 ${formatDuration(cond.seconds)}`;
    case 'all':
      return cond.of.map(describeCondition).join('；');
  }
}
