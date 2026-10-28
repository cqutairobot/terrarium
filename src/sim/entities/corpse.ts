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
