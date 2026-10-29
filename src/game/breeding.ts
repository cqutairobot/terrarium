import { Rng } from '../sim/core/rng';
import type { Creature } from '../sim/entities/creature';
import { breed, compatibility, express } from '../sim/genome';
import { rareKeyLabel, rareTraitKeys } from '../sim/rareTraits';
import type { World } from '../sim/world';
import { MEASURES, type Measure } from './conditions';

/** Qualities shown when two creatures are matched. */
export const FORECAST_MEASURES: Measure[] = ['size', 'speed', 'sense', 'lifespan', 'tentacles', 'warmth'];

export interface TraitForecast {
  measure: Measure;
  label: string;
  /** The two parents' own values. */
  a: number;
  b: number;
  /** The young: 10th percentile, median, 90th percentile. */
  low: number;
  mid: number;
  high: number;
}

export interface RareForecast {
  key: string;
  label: string;
  /** Share of the young expected to show it. */
  chance: number;
}

export interface BroodForecast {
  /** Chance a courtship between them succeeds. */
  compat: number;
  traits: TraitForecast[];
  /** A spread of the young's body colors. */
  hues: number[];
  rare: RareForecast[];
  /** Chance a youngster carries a notable new mutation. */
  surprise: number;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

/**
 * What the young of `a` and `b` would look like, from real crossings: the
 * same breed() the tank uses, run on a separate random stream so the world
 * itself is untouched.
 */
export function forecastBrood(world: World, a: Creature, b: Creature, samples = 240): BroodForecast {
  const cfg = world.cfg;
  const mult = world.env.mutationSet * (1 + 2 * Math.max(a.stardust, b.stardust));
  const params = { rate: cfg.mutationRate * mult, sigmaScale: cfg.mutationSigma, macroChance: cfg.macroMutationChance * mult };
  const rng = new Rng(`forecast:${world.seed}:${a.id}:${b.id}`);
  const values = new Map<Measure, number[]>(FORECAST_MEASURES.map((m) => [m, []]));
  const rareCount = new Map<string, number>();
  const hues: number[] = [];
  let surprises = 0;
  for (let i = 0; i < samples; i++) {
    const r = breed(a.genome, b.genome, rng, params, mult);
    const young = { ph: express(r.genome) } as Creature;
    for (const m of FORECAST_MEASURES) values.get(m)!.push(MEASURES[m].get(young));
    for (const k of rareTraitKeys(young.ph.rare)) rareCount.set(k, (rareCount.get(k) ?? 0) + 1);
    if (r.notes.length > 0 || r.newRare.length > 0) surprises++;
    hues.push(young.ph.rare.golden ? 0.13 : young.ph.hue);
  }
  const traits = FORECAST_MEASURES.map((m) => {
    const v = values.get(m)!.sort((x, y) => x - y);
    return { measure: m, label: MEASURES[m].label, a: MEASURES[m].get(a), b: MEASURES[m].get(b), low: quantile(v, 0.1), mid: quantile(v, 0.5), high: quantile(v, 0.9) };
  });
  const rare = [...rareCount.entries()]
    .map(([key, n]) => ({ key, label: rareKeyLabel(key), chance: n / samples }))
    .sort((x, y) => y.chance - x.chance);
  return {
    compat: compatibility(a.genome, b.genome, cfg.compatDistance),
    traits,
    hues: hues.slice(0, 48),
    rare,
    surprise: surprises / samples,
  };
}

/** Why two creatures cannot be matched, if they cannot. */
export function pairProblem(a: Creature, b: Creature): string | null {
  if (a.id === b.id) return '不能和自己配对';
  if (a.dying > 0 || b.dying > 0) return '它正在离去';
  if (a.stage === 'egg' || b.stage === 'egg') return '卵还不能配对';
  if (a.ph.morph !== b.ph.morph) return '身体结构不同的生命无法结为伴侣';
  if (a.ph.trophic === 'carnivore' && b.ph.trophic !== 'carnivore') return '掠食者和小生命无法结为伴侣';
  if (b.ph.trophic === 'carnivore' && a.ph.trophic !== 'carnivore') return '掠食者和小生命无法结为伴侣';
  return null;
}

/** Match two creatures: from now on they court only each other. */
export function bond(world: World, a: Creature, b: Creature): void {
  for (const c of [a, b]) {
    const old = c.bondId ? world.creatureMap.get(c.bondId) : undefined;
    if (old && old.bondId === c.id) old.bondId = 0;
  }
  a.bondId = b.id;
  b.bondId = a.id;
  for (const c of [a, b]) c.thinkTimer = 0;
}

export function unbond(world: World, c: Creature): void {
  const other = c.bondId ? world.creatureMap.get(c.bondId) : undefined;
  if (other && other.bondId === c.id) other.bondId = 0;
  c.bondId = 0;
}
