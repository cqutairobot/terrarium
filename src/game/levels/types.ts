import type { EcoConfig, EnvSettings } from '../../sim/config';
import type { DisasterKind } from '../../sim/environment';
import type { Condition } from '../conditions';

/** Rare alleles given to founders: how many of them carry one copy / two copies. */
export interface FounderAlleles {
  key: string;
  /** Allele value (1 for most loci; the eye variant for special eyes). */
  allele?: number;
  hetero?: number;
  homo?: number;
}

/** How a level's tank is prepared before the player arrives. */
export type SetupStep =
  /** A group of one founding body plan. */
  | {
      k: 'founders';
      arch: string;
      count: number;
      adult?: boolean;
      near?: number;
      /** Share of a full belly they arrive with (default 0.8). */
      energy?: number;
      /** Genes set exactly (0–1) or nudged (+/-) for every founder. */
      genes?: Partial<Record<string, number>>;
      nudge?: Partial<Record<string, number>>;
      /** Different genes for the first few founders (one species, a few odd ones out). */
      some?: { count: number; genes: Partial<Record<string, number>> };
      alleles?: FounderAlleles[];
    }
  /** Thin the plants or the algae to this many (their matter returns to the water). */
  | { k: 'thin'; kind: 'plant' | 'algae'; keep: number }
  /** Scale the dissolved nutrients (the difference is booked as inflow). */
  | { k: 'nutrients'; scale: number }
  /** Clumps of algae seeded near the surface, made of the water's nutrients. */
  | { k: 'algae'; count: number };

/** Something that happens on its own during the level. */
export type LevelEvent =
  | {
      k: 'disaster';
      at: number;
      kind: DisasterKind;
      x?: number;
      y?: number;
      /** Aim at where the small life crowds together (decided when the warning goes out). */
      aim?: 'crowd';
      /** Seconds of warning beforehand (the spot is shown to the player). */
      warn?: number;
      /** Strength (1 = what the player's own disasters bring). */
      intensity?: number;
      say?: string;
    }
  | { k: 'founders'; at: number; step: Extract<SetupStep, { k: 'founders' }>; say?: string };

export interface LevelGoal {
  cond: Condition;
  /** Only judged when time runs out (e.g. "still alive at the end"). */
  atEnd?: boolean;
}

export interface LevelFail {
  cond: Condition;
  /** What to tell the player when it happens. */
  say: string;
  /** Grace period before this can fail the level (sim seconds). */
  after?: number;
}

/** What the player may use, and how often (undefined = not allowed; Infinity = freely). */
export interface ToolBudget {
  food?: number;
  rich?: number;
  spore?: number;
  disasters?: Partial<Record<DisasterKind, number>>;
  pair?: number;
  release?: number;
  /** Calling a group of newcomers into the tank. */
  call?: { arch: string; count: number; uses: number; label: string };
  /** The environment sliders (light, nutrients, temperature, mutation). */
  env?: boolean;
}

export type ToolKind = 'food' | 'rich' | 'spore' | 'pair' | 'release' | 'call' | `disaster:${DisasterKind}`;

export type StarRule =
  | { k: 'time'; under: number }
  | { k: 'spare'; tool: ToolKind; atLeast: number }
  | { k: 'cond'; cond: Condition; label: string };

export interface LevelDef {
  id: string;
  chapter: number;
  index: number;
  name: string;
  /** Story told before the level starts. */
  intro: string;
  /** Said when the level is won. */
  outro: string;
  hint?: string;
  seed: string;
  aspect?: number;
  config?: Partial<EcoConfig>;
  settings?: Partial<EnvSettings>;
  /** Keep the world's own founding animals (by default a level starts with plants and water only). */
  wild?: boolean;
  setup: SetupStep[];
  events?: LevelEvent[];
  goals: LevelGoal[];
  fails?: LevelFail[];
  /** Simulated seconds the player has. */
  timeLimit: number;
  tools: ToolBudget;
  /** Two extra stars beyond winning. */
  stars: [StarRule, StarRule];
  reward: { lumen: number; unlock?: string };
}

export type LevelStatus = 'playing' | 'won' | 'lost';
