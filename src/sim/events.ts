import type { DeathCause } from './entities/creature';

/**
 * Facts emitted by the simulation during a step. The history layer turns
 * them into statistics, stories and chronicle entries; nothing here is
 * invented after the fact.
 */
export type SimEvent =
  | {
      t: 'birth';
      id: number;
      parentA: number;
      parentB: number;
      generation: number;
      species: number;
      family: number;
      /** Gene indices with notable mutations; 100 + locus for brand-new rare alleles. */
      mutations: number[];
      rareMask: number;
      newFamily: boolean;
      x: number;
      y: number;
    }
  | {
      t: 'death';
      id: number;
      cause: DeathCause;
      age: number;
      species: number;
      family: number;
      generation: number;
      killer: number;
      children: number;
      rareMask: number;
      x: number;
      y: number;
    }
  | { t: 'eggs'; parentA: number; parentB: number; count: number; x: number; y: number }
  | { t: 'firstMeal'; id: number }
  | { t: 'speciation'; species: number; parent: number; members: number }
  | { t: 'speciesExtinct'; species: number; lastId: number }
  | { t: 'familyExtinct'; family: number }
  | { t: 'escape'; id: number; predator: number }
  | { t: 'respawn'; kind: 'consumer' | 'predator' | 'plant'; count: number; fromBank: boolean }
  | { t: 'allGone'; kind: 'consumer' | 'predator' };
