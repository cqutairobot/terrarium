import type { Rng } from './core/rng';

/**
 * Rare appearance traits are carried on explicit diploid loci and follow
 * Mendelian segregation. They never grant a free advantage: every expressed
 * trait pairs a small benefit with an equal cost (see phenotype mapping).
 */
export const RARE_LOCI = [
  'golden',
  'translucent',
  'twinTail',
  'multiTentacle',
  'fluorescent',
  'specialEyes',
  'rainbow',
] as const;

export type RareKey = (typeof RARE_LOCI)[number];
export const N_RARE = RARE_LOCI.length;

export type Inheritance = 'recessive' | 'dominant' | 'incomplete';

export interface RareDef {
  key: RareKey;
  label: string;
  mode: Inheritance;
  /** Forward mutation probability per allele per birth (before the world multiplier). */
  mu: number;
  /** Number of non-zero allele variants. */
  variants: number;
}

export const RARE_DEFS: readonly RareDef[] = [
  { key: 'golden', label: '金色身体', mode: 'recessive', mu: 1 / 2500, variants: 1 },
  { key: 'translucent', label: '半透明身体', mode: 'recessive', mu: 1 / 2500, variants: 1 },
  { key: 'twinTail', label: '双尾', mode: 'dominant', mu: 1 / 12000, variants: 1 },
  { key: 'multiTentacle', label: '多触须', mode: 'incomplete', mu: 1 / 9000, variants: 1 },
  { key: 'fluorescent', label: '荧光纹路', mode: 'dominant', mu: 1 / 12000, variants: 1 },
  { key: 'specialEyes', label: '特殊眼睛', mode: 'recessive', mu: 1 / 2500, variants: 3 },
  { key: 'rainbow', label: '彩虹渐变', mode: 'recessive', mu: 1 / 8000, variants: 1 },
];

/** Reverse mutation back to the common allele. */
export const RARE_REVERSION = 1 / 1000;

export const EYE_TYPES = ['', '星瞳', '三目', '月牙瞳', '异色瞳'] as const;

export interface RareExpression {
  golden: boolean;
  translucent: boolean;
  twinTail: boolean;
  /** 0, 3 or 6 additional tentacles. */
  extraTentacles: number;
  fluorescent: boolean;
  /** 0 none, 1 star pupil, 2 three eyes, 3 crescent pupil, 4 heterochromia. */
  eyeType: number;
  rainbow: boolean;
  /** Bitmask over RARE_LOCI of expressed traits. */
  mask: number;
}

export function emptyAlleles(): number[] {
  return new Array(N_RARE * 2).fill(0);
}

export function expressRare(alleles: readonly number[]): RareExpression {
  const pair = (i: number): [number, number] => [alleles[i * 2] | 0, alleles[i * 2 + 1] | 0];
  const both = (i: number) => {
    const [a, b] = pair(i);
    return a !== 0 && b !== 0;
  };
  const any = (i: number) => {
    const [a, b] = pair(i);
    return a !== 0 || b !== 0;
  };
  const golden = both(0);
  const translucent = both(1);
  const twinTail = any(2);
  const [ta, tb] = pair(3);
  const extraTentacles = (ta !== 0 ? 3 : 0) + (tb !== 0 ? 3 : 0);
  const fluorescent = any(4);
  const [ea, eb] = pair(5);
  const eyeType = ea !== 0 && eb !== 0 ? (ea === eb ? ea : 4) : 0;
  const rainbow = both(6);
  let mask = 0;
  if (golden) mask |= 1 << 0;
  if (translucent) mask |= 1 << 1;
  if (twinTail) mask |= 1 << 2;
  if (extraTentacles > 0) mask |= 1 << 3;
  if (fluorescent) mask |= 1 << 4;
  if (eyeType > 0) mask |= 1 << 5;
  if (rainbow) mask |= 1 << 6;
  return { golden, translucent, twinTail, extraTentacles, fluorescent, eyeType, rainbow, mask };
}

export interface RareInheritance {
  alleles: number[];
  /** Loci where a brand-new rare allele appeared in this birth. */
  newMutations: number[];
}

/** Mendelian segregation: one allele from each parent's pair, then rare mutation. */
export function inheritRare(
  a: readonly number[],
  b: readonly number[],
  rng: Rng,
  mutationMultiplier: number,
): RareInheritance {
  const alleles = emptyAlleles();
  const newMutations: number[] = [];
  for (let i = 0; i < N_RARE; i++) {
    const fromA = a[i * 2 + (rng.next() < 0.5 ? 0 : 1)] | 0;
    const fromB = b[i * 2 + (rng.next() < 0.5 ? 0 : 1)] | 0;
    const def = RARE_DEFS[i];
    const out = [fromA, fromB];
    for (let k = 0; k < 2; k++) {
      if (out[k] === 0) {
        if (rng.next() < def.mu * mutationMultiplier) {
          out[k] = 1 + rng.int(def.variants);
          if (!newMutations.includes(i)) newMutations.push(i);
        }
      } else if (rng.next() < RARE_REVERSION) {
        out[k] = 0;
      }
    }
    alleles[i * 2] = out[0];
    alleles[i * 2 + 1] = out[1];
  }
  return { alleles, newMutations };
}

/** Number of non-zero alleles a genome carries at a locus (0..2). */
export function alleleCount(alleles: readonly number[], locus: number): number {
  return (alleles[locus * 2] !== 0 ? 1 : 0) + (alleles[locus * 2 + 1] !== 0 ? 1 : 0);
}

/** Stable key used by the codex for a single trait or a combination. */
export function rareTraitKeys(expr: RareExpression): string[] {
  const keys: string[] = [];
  if (expr.golden) keys.push('golden');
  if (expr.translucent) keys.push('translucent');
  if (expr.twinTail) keys.push('twinTail');
  if (expr.extraTentacles === 3) keys.push('multiTentacle');
  if (expr.extraTentacles === 6) keys.push('multiTentacle2');
  if (expr.fluorescent) keys.push('fluorescent');
  if (expr.eyeType > 0) keys.push('eyes' + expr.eyeType);
  if (expr.rainbow) keys.push('rainbow');
  return keys;
}

export const RARE_KEY_LABELS: Record<string, string> = {
  golden: '金色身体',
  translucent: '半透明身体',
  twinTail: '双尾',
  multiTentacle: '多触须',
  multiTentacle2: '繁密触须',
  fluorescent: '荧光纹路',
  eyes1: '星瞳',
  eyes2: '三目',
  eyes3: '月牙瞳',
  eyes4: '异色瞳',
  rainbow: '彩虹渐变',
};

export function rareKeyLabel(key: string): string {
  if (key.includes('+')) return key.split('+').map((k) => RARE_KEY_LABELS[k] ?? k).join(' · ');
  return RARE_KEY_LABELS[key] ?? key;
}
