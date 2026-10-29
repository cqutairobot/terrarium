import { clamp01, hueDist, wrap01 } from './core/math';
import type { Rng } from './core/rng';
import { emptyAlleles, expressRare, inheritRare, type RareExpression } from './rareTraits';

/**
 * Continuous genes, all normalized to [0, 1]. Every gene feeds the phenotype
 * in a way that changes survival or reproduction, and every benefit carries a
 * cost so there is no single "better" direction for evolution to climb.
 */
export const GENE_KEYS = [
  'size',
  'speed',
  'perception',
  'metabolism',
  'longevity',
  'fertility',
  'aggression',
  'armor',
  'sociability',
  'curiosity',
  'timidity',
  'activity',
  'nocturnality',
  'thermalPref',
  'diet',
  'hue',
  'accentHue',
  'brightness',
  'elongation',
  'tailLength',
  'finSize',
  'tentacles',
  'eyeSize',
] as const;

export type GeneKey = (typeof GENE_KEYS)[number];
export const N_GENES = GENE_KEYS.length;

export const G = Object.fromEntries(GENE_KEYS.map((k, i) => [k, i])) as Record<GeneKey, number>;

export interface GeneDef {
  key: GeneKey;
  label: string;
  /** Gaussian mutation step. */
  sigma: number;
  /** Weight in genetic distance. */
  weight: number;
  circular?: boolean;
}

export const GENE_DEFS: readonly GeneDef[] = [
  { key: 'size', label: '体型', sigma: 0.04, weight: 1.5 },
  { key: 'speed', label: '速度', sigma: 0.05, weight: 1 },
  { key: 'perception', label: '感知', sigma: 0.05, weight: 1 },
  { key: 'metabolism', label: '代谢', sigma: 0.05, weight: 1 },
  { key: 'longevity', label: '寿命', sigma: 0.05, weight: 0.8 },
  { key: 'fertility', label: '繁殖策略', sigma: 0.05, weight: 0.8 },
  { key: 'aggression', label: '攻击性', sigma: 0.06, weight: 0.8 },
  { key: 'armor', label: '防御', sigma: 0.05, weight: 0.8 },
  { key: 'sociability', label: '社交', sigma: 0.06, weight: 0.7 },
  { key: 'curiosity', label: '好奇', sigma: 0.06, weight: 0.5 },
  { key: 'timidity', label: '胆小', sigma: 0.06, weight: 0.5 },
  { key: 'activity', label: '活跃', sigma: 0.06, weight: 0.5 },
  { key: 'nocturnality', label: '夜行', sigma: 0.06, weight: 0.6 },
  { key: 'thermalPref', label: '适温', sigma: 0.04, weight: 0.8 },
  { key: 'diet', label: '食性', sigma: 0.025, weight: 2.5 },
  { key: 'hue', label: '体色', sigma: 0.03, weight: 1.5, circular: true },
  { key: 'accentHue', label: '饰色', sigma: 0.04, weight: 0.8, circular: true },
  { key: 'brightness', label: '亮度', sigma: 0.05, weight: 0.6 },
  { key: 'elongation', label: '体长比', sigma: 0.04, weight: 1 },
  { key: 'tailLength', label: '尾', sigma: 0.05, weight: 0.6 },
  { key: 'finSize', label: '鳍', sigma: 0.05, weight: 0.6 },
  { key: 'tentacles', label: '触须', sigma: 0.05, weight: 0.8 },
  { key: 'eyeSize', label: '眼睛', sigma: 0.05, weight: 0.6 },
];

const WEIGHT_SUM = GENE_DEFS.reduce((s, d) => s + d.weight, 0);

/** Body plan. It never mutates and is passed down whole, so different forms never interbreed. */
export type Morph = 'fish' | 'jelly' | 'shrimp' | 'snail';

export const MORPH_LABELS: Record<Morph, string> = { fish: '鱼', jelly: '水母', shrimp: '小虾', snail: '螺' };

export interface Genome {
  /** Continuous genes, length N_GENES. */
  g: number[];
  /** Diploid rare alleles, length N_RARE * 2. */
  rare: number[];
  /** Body plan (absent: a fish, as every first-version creature was). */
  morph?: Morph;
}

export function morphOf(g: Genome): Morph {
  return g.morph ?? 'fish';
}

/**
 * The diet a body plan allows: bells and shells only graze, a shrimp eats
 * whatever settles (an omnivore that never hunts).
 */
export function morphDiet(morph: Morph | undefined, raw: number): number {
  if (morph === 'jelly' || morph === 'snail') return Math.min(raw, 0.2);
  if (morph === 'shrimp') return Math.min(0.5, Math.max(0.38, raw));
  return raw;
}

export interface MutationNote {
  gene: number;
  delta: number;
}

export type Trophic = 'herbivore' | 'omnivore' | 'carnivore';

export interface Phenotype {
  radius: number;
  mass: number;
  maxEnergy: number;
  maxHealth: number;
  adultStructure: number;
  maxSpeed: number;
  accel: number;
  turnRate: number;
  senseRadius: number;
  nightVision: number;
  /** mass^0.75 × metabolism × armor; multiplied by EcoConfig.basalCoeff. */
  basalFactor: number;
  /** Fixed upkeep of eyes and appendages, e/s. */
  upkeep: number;
  moveCoeff: number;
  senseCost: number;
  lifespan: number;
  maturityAge: number;
  elderAge: number;
  reproThreshold: number;
  investFraction: number;
  reproCooldown: number;
  twinChance: number;
  attack: number;
  defense: number;
  herbEff: number;
  carnEff: number;
  biteRate: number;
  reach: number;
  visibility: number;
  attractiveness: number;
  thermalPref: number;
  metabolismMult: number;
  trophic: Trophic;
  diet: number;
  aggression: number;
  sociability: number;
  curiosity: number;
  timidity: number;
  activity: number;
  nocturnality: number;
  // appearance
  hue: number;
  accentHue: number;
  sat: number;
  light: number;
  elong: number;
  tailLen: number;
  finSize: number;
  tentacleCount: number;
  tentacleLen: number;
  eyeSize: number;
  antennaLen: number;
  rare: RareExpression;
  morph: Morph;
}

export function cloneGenome(g: Genome): Genome {
  return g.morph ? { g: g.g.slice(), rare: g.rare.slice(), morph: g.morph } : { g: g.g.slice(), rare: g.rare.slice() };
}

export function geneValue(genome: Genome, key: GeneKey): number {
  return genome.g[G[key]];
}

/** Weighted, normalized genetic distance in roughly [0, 1]. */
export function geneticDistance(a: Genome, b: Genome): number {
  let sum = 0;
  for (let i = 0; i < N_GENES; i++) {
    const def = GENE_DEFS[i];
    const d = def.circular ? hueDist(a.g[i], b.g[i]) * 2 : a.g[i] - b.g[i];
    sum += def.weight * d * d;
  }
  // different body plans are worlds apart
  return Math.sqrt(sum / WEIGHT_SUM) + (morphOf(a) === morphOf(b) ? 0 : 1);
}

/** Probability that two genomes produce viable offspring. */
export function compatibility(a: Genome, b: Genome, compatDistance: number): number {
  if (morphOf(a) !== morphOf(b)) return 0;
  const d = geneticDistance(a, b) / compatDistance;
  return Math.exp(-(d * d * d * d));
}

export function crossover(a: Genome, b: Genome, rng: Rng): number[] {
  const out = new Array<number>(N_GENES);
  for (let i = 0; i < N_GENES; i++) {
    const def = GENE_DEFS[i];
    const r = rng.next();
    if (r < 0.35) out[i] = a.g[i];
    else if (r < 0.7) out[i] = b.g[i];
    else {
      const t = rng.next();
      if (def.circular) {
        let d = b.g[i] - a.g[i];
        if (d > 0.5) d -= 1;
        if (d < -0.5) d += 1;
        out[i] = wrap01(a.g[i] + d * t);
      } else {
        out[i] = a.g[i] + (b.g[i] - a.g[i]) * t;
      }
    }
  }
  return out;
}

export interface MutationParams {
  rate: number;
  sigmaScale: number;
  macroChance: number;
}

/** Mutates genes in place; returns notable (macro) mutations. */
export function mutateGenes(g: number[], rng: Rng, p: MutationParams): MutationNote[] {
  const notes: MutationNote[] = [];
  for (let i = 0; i < N_GENES; i++) {
    const def = GENE_DEFS[i];
    if (rng.next() < p.macroChance) {
      const delta = rng.normal() * def.sigma * 4 * p.sigmaScale + rng.sign() * def.sigma * 2;
      const before = g[i];
      g[i] = def.circular ? wrap01(g[i] + delta) : reflect01(g[i] + delta);
      const real = def.circular ? signedHueDelta(before, g[i]) : g[i] - before;
      if (Math.abs(real) > 0.06) notes.push({ gene: i, delta: real });
    } else if (rng.next() < p.rate) {
      const delta = rng.normal() * def.sigma * p.sigmaScale;
      g[i] = def.circular ? wrap01(g[i] + delta) : reflect01(g[i] + delta);
    }
  }
  return notes;
}

function signedHueDelta(a: number, b: number): number {
  let d = b - a;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return d;
}

function reflect01(v: number): number {
  if (v < 0) v = -v;
  if (v > 1) v = 2 - v;
  return clamp01(v);
}

export interface BreedResult {
  genome: Genome;
  notes: MutationNote[];
  newRare: number[];
}

export function breed(a: Genome, b: Genome, rng: Rng, p: MutationParams, rareMultiplier: number): BreedResult {
  const g = crossover(a, b, rng);
  const notes = mutateGenes(g, rng, p);
  const rare = inheritRare(a.rare, b.rare, rng, rareMultiplier);
  const genome: Genome = a.morph ? { g, rare: rare.alleles, morph: a.morph } : { g, rare: rare.alleles };
  return { genome, notes, newRare: rare.newMutations };
}

export type GeneTemplate = Partial<Record<GeneKey, number>>;

export function genomeFromTemplate(t: GeneTemplate, rng: Rng, jitter: number): Genome {
  const g = new Array<number>(N_GENES);
  for (let i = 0; i < N_GENES; i++) {
    const def = GENE_DEFS[i];
    const base = t[def.key] ?? 0.5;
    const v = base + rng.normal() * jitter;
    g[i] = def.circular ? wrap01(v) : reflect01(v);
  }
  return { g, rare: emptyAlleles() };
}

export function trophicOf(diet: number): Trophic {
  return diet < 0.35 ? 'herbivore' : diet > 0.65 ? 'carnivore' : 'omnivore';
}

/**
 * Decode a genome into the numbers the simulation actually uses.
 * Units: world units (u), seconds (s), energy (e).
 */
/** Lifespans relative to the first version (a livelier turnover for play). */
export const LIFESPAN_SCALE = 0.8;
/** Share of a lifetime spent growing up (first version: 0.22). */
export const MATURITY_FRACTION = 0.15;
/** Rest between broods, in seconds, before size and metabolism (first version: 45 + 70). */
const COOLDOWN_BASE = 35;
const COOLDOWN_K = 55;

export function express(genome: Genome): Phenotype {
  const g = genome.g;
  const v = (k: GeneKey) => g[G[k]];
  const rare = expressRare(genome.rare);
  const morph = morphOf(genome);
  const jelly = morph === 'jelly';
  const shrimp = morph === 'shrimp';
  const snail = morph === 'snail';

  const size = v('size');
  const armor = v('armor');
  const metab = v('metabolism');
  const elong = 0.8 + 1.4 * v('elongation');
  const tail = v('tailLength');
  const fin = v('finSize');
  const tentGene = v('tentacles');
  const eye = v('eyeSize');
  const diet = morphDiet(morph, v('diet'));
  const brightness = v('brightness');
  const noct = v('nocturnality');

  const radius = (4.5 + 21 * Math.pow(size, 1.2)) * (shrimp ? 0.78 : 1);
  const rel = radius / 6;
  const mass = rel * rel * (1 + 0.35 * armor);
  const M = 0.3 + 1.25 * metab;

  // a bell trails many more threads than a fish has feelers
  const tentacleCount = (jelly ? 6 + Math.floor(tentGene * 6.99) : Math.min(6, Math.floor(tentGene * 7))) + rare.extraTentacles;
  const twin = rare.twinTail ? 1 : 0;

  // locomotion: thrust from tail and body shape, armor weighs it down
  // a bell pulses slowly, a snail creeps, a shrimp darts
  const form = jelly ? { speed: 0.45, accel: 0.5, turn: 0.6 } : snail ? { speed: 0.22, accel: 0.5, turn: 0.5 } : shrimp ? { speed: 1.05, accel: 1.6, turn: 1.3 } : { speed: 1, accel: 1, turn: 1 };
  const maxSpeed =
    (28 + 52 * v('speed')) *
    Math.pow(rel, 0.22) *
    (1 + 0.1 * (elong - 1)) *
    (1 + 0.12 * tail) *
    (1 - 0.3 * armor) *
    (1 + 0.08 * twin) *
    form.speed;
  const accel = maxSpeed * (1.2 + 0.8 * M) * form.accel;
  const turnRate = ((3.0 + 2.2 * fin) / (0.7 + 0.3 * elong)) * form.turn;

  const special = rare.eyeType > 0 ? 1 : 0;
  const senseRadius = (60 + 200 * v('perception')) * (1 + 0.25 * eye) * Math.pow(rel, 0.15) * (snail ? 0.6 : jelly ? 0.8 : 1);
  const nightVision = Math.min(1.2, 0.4 + 0.4 * eye + 0.3 * noct + 0.25 * special);

  // energetics (Kleiber) — appendages cost drag and upkeep
  const drag = (1 + 0.04 * tentacleCount) * (1 + 0.08 * fin) * (1 + 0.1 * twin) * (1 + 0.05 * tail);
  const basalFactor = Math.pow(mass, 0.7) * M * (1 + 0.25 * armor) * (jelly ? 0.75 : snail ? 0.6 : 1);
  const upkeep = 0.015 * eye + 0.02 * special + (jelly ? 0.002 : 0.005) * tentacleCount;
  const moveCoeff = Math.pow(mass, 0.75) * drag * (jelly ? 0.45 : snail ? 1.2 : 1);
  const senseCost = 0.00025 * senseRadius;

  const lifespan = ((LIFESPAN_SCALE * (360 + 780 * v('longevity')) * Math.pow(rel, 0.55)) / Math.sqrt(M)) * (snail ? 1.4 : jelly ? 0.85 : 1);
  // game pacing: the young come of age quickly, so a bred line shows its next generation within minutes
  const maturityAge = lifespan * MATURITY_FRACTION * (1.15 - 0.3 * metab);

  const fert = v('fertility');
  const reproThreshold = 0.5 + 0.2 * (1 - fert);
  const investFraction = 0.35 + 0.4 * (1 - fert);
  const reproCooldown = (((COOLDOWN_BASE + COOLDOWN_K * (1 - fert)) * Math.sqrt(rel)) / M) * (shrimp ? 0.85 : 1);
  const twinChance = 0.25 * fert * fert;

  const aggression = v('aggression');
  const attack = (6 + 14 * aggression) * Math.pow(mass, 0.7) * (1 + 0.5 * diet);
  // shells: a snail's is a fortress, a shrimp's a coat of mail
  const defense = Math.min(0.9, 0.6 * armor + (snail ? 0.35 : shrimp ? 0.12 : 0));

  const herbEff = 0.85 * Math.pow(1 - diet, 1.6);
  const carnEff = 0.9 * Math.pow(diet, 1.6);
  const biteRate = (5 + 4 * (tentacleCount / 6)) * Math.pow(rel, 1.1) * (0.8 + 0.4 * M);
  const tentacleLen = 1.2 + 1.6 * tentGene;
  const reach = radius * (0.7 + 0.12 * tentacleCount * Math.min(1, tentacleLen / 2));

  let visibility = (0.85 + 0.5 * brightness) * (jelly ? 0.75 : snail ? 0.8 : 1);
  if (rare.golden) visibility += 0.35;
  if (rare.rainbow) visibility += 0.35;
  if (rare.translucent) visibility -= 0.35;
  const attractiveness = 0.6 + 0.6 * brightness;

  const maxHealth = 100 * Math.pow(mass, 0.8) * (1 + 0.6 * armor) * (rare.translucent ? 0.85 : 1) * (snail ? 1.3 : 1);

  const hue = v('hue');
  return {
    radius,
    mass,
    maxEnergy: 100 * mass,
    maxHealth,
    adultStructure: 60 * mass,
    maxSpeed,
    accel,
    turnRate,
    senseRadius,
    nightVision,
    basalFactor,
    upkeep,
    moveCoeff,
    senseCost,
    lifespan,
    maturityAge,
    elderAge: lifespan * 0.8,
    reproThreshold,
    investFraction,
    reproCooldown,
    twinChance,
    attack,
    defense,
    herbEff,
    carnEff,
    biteRate,
    reach,
    visibility,
    attractiveness,
    thermalPref: 0.2 + 0.6 * v('thermalPref'),
    metabolismMult: M,
    trophic: trophicOf(diet),
    diet,
    aggression,
    sociability: v('sociability'),
    curiosity: v('curiosity'),
    timidity: v('timidity'),
    activity: v('activity'),
    nocturnality: noct,
    hue,
    accentHue: v('accentHue'),
    sat: 0.38 + 0.4 * brightness,
    light: 0.56 + 0.16 * brightness,
    elong,
    tailLen: 0.5 + 1.4 * tail,
    finSize: 0.25 + 0.95 * fin,
    tentacleCount,
    tentacleLen,
    eyeSize: 0.7 + 0.7 * eye,
    antennaLen: v('perception'),
    rare,
    morph,
  };
}
