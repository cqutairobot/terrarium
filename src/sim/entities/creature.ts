import type { Genome, Phenotype } from '../genome';

export type BehaviorState =
  | 'egg'
  | 'wander'
  | 'explore'
  | 'forage'
  | 'eat'
  | 'rest'
  | 'flee'
  | 'hunt'
  | 'seekMate'
  | 'court'
  | 'social'
  | 'follow'
  | 'dying';

export const STATE_LABELS: Record<BehaviorState, string> = {
  egg: '卵中孕育',
  wander: '漫游中',
  explore: '探索中',
  forage: '觅食中',
  eat: '进食中',
  rest: '休息中',
  flee: '逃跑中',
  hunt: '追猎中',
  seekMate: '寻找伴侣',
  court: '求偶舞',
  social: '打招呼',
  follow: '跟随父母',
  dying: '正在离去',
};

export type TargetKind = 'none' | 'producer' | 'food' | 'corpse' | 'creature' | 'point';

export type DeathCause = 'age' | 'starvation' | 'predation' | 'cold' | 'heat' | 'impact' | 'injury';

export const DEATH_LABELS: Record<DeathCause, string> = {
  age: '寿终',
  starvation: '饥饿',
  predation: '被捕食',
  cold: '寒冷',
  heat: '炎热',
  impact: '灾害冲击',
  injury: '伤病',
};

export type LifeStage = 'egg' | 'juvenile' | 'adult' | 'elder';

export interface Creature {
  id: number;
  name: string;
  /** Name given by the observer, if any. */
  customName: string | null;
  speciesId: number;
  familyId: number;
  parentA: number;
  parentB: number;
  generation: number;
  genome: Genome;
  /** Derived from genome; never serialized. */
  ph: Phenotype;

  // kinematics
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  /** Position/heading at the start of the last step (render interpolation). */
  px: number;
  py: number;
  ph0: number;
  swim: number;

  // physiology
  age: number;
  energy: number;
  structure: number;
  health: number;
  fatigue: number;
  stress: number;
  stamina: number;
  /** Juvenile growth factor 0.45 → 1. */
  growth: number;
  stage: LifeStage;
  eggTimer: number;

  // mind
  state: BehaviorState;
  stateTime: number;
  thinkTimer: number;
  targetKind: TargetKind;
  targetId: number;
  tx: number;
  ty: number;
  memFoodX: number;
  memFoodY: number;
  memFoodT: number;
  fearX: number;
  fearY: number;
  fearT: number;
  wanderAngle: number;
  /** Cached schooling info from the last think (count, center, mean velocity). */
  kinN: number;
  kinX: number;
  kinY: number;
  kinVx: number;
  kinVy: number;
  threatId: number;
  lastSocial: number;
  /** Look direction for the eyes, world-space unit vector. */
  lookX: number;
  lookY: number;

  // reproduction & combat
  reproCooldown: number;
  /** Partner during courtship or a social greeting. */
  partnerId: number;
  danceT: number;
  /** True for the partner who leads a courtship (and lays the eggs). */
  courtLead: boolean;
  attackCooldown: number;
  lastAttacker: number;
  /** What last hurt this creature (becomes the death cause). */
  lastHurt: DeathCause;

  // states from the environment
  glowT: number;
  stardust: number;
  /** Visible eating animation timer. */
  munch: number;

  // death
  dying: number;
  deathCause: DeathCause | null;

  // life milestones (cheap story backbone for every creature)
  bornT: number;
  bornX: number;
  bornY: number;
  firstMealT: number;
  firstReproT: number;
  children: number;
  kids: number[];
  disasters: number[];
  escapes: number;
  kills: number;
  /** Notable mutations at birth: gene indices (+100 + locus for rare). */
  mutations: number[];
  /** Watched-lineage tags (ids of watched ancestors). */
  tags: number[];
}

export function creatureDisplayName(c: { name: string; customName: string | null }): string {
  return c.customName || c.name;
}
