import type { Trophic } from './genome';

/** A species: a reproductively coherent cluster of genomes, tracked over time. */
export interface SpeciesRecord {
  id: number;
  name: string;
  hue: number;
  trophic: Trophic;
  foundedAt: number;
  parentSpecies: number;
  /** Running centroid of member genes (continuous genes only). */
  centroid: number[];
  population: number;
  peak: number;
  totalBorn: number;
  extinctAt: number | null;
  /** Population milestones already announced. */
  milestones: number[];
}

/** A family (家族): a line passed down through the initiating parent. */
export interface FamilyRecord {
  id: number;
  name: string;
  founderId: number;
  founderName: string;
  founderGen: number;
  foundedAt: number;
  speciesId: number;
  hue: number;
  living: number;
  maxGen: number;
  totalMembers: number;
  extinctAt: number | null;
  /** Depth milestones already announced. */
  milestones: number[];
}

export function familyDepth(f: FamilyRecord): number {
  return Math.max(0, f.maxGen - f.founderGen);
}
