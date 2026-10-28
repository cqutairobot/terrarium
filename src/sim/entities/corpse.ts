/** Carnivores only want fresh remains; older husks are left to the decomposers. */
export function freshness(k: { age: number }): number {
  return Math.max(0, 1 - k.age / 45);
}

/** Remains of a creature: eaten by carnivores, otherwise decays into detritus. */
export interface Corpse {
  id: number;
  x: number;
  y: number;
  vy: number;
  biomass: number;
  initial: number;
  radius: number;
  hue: number;
  age: number;
  sourceId: number;
}
