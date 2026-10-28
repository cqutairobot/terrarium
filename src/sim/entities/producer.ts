export type ProducerKind = 'plant' | 'algae' | 'fungus';

/** Producers: rooted seaweed, drifting algae colonies and glowing fungus on the floor. */
export interface Producer {
  id: number;
  kind: ProducerKind;
  /** Root position for plants and fungi, colony center for algae. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  biomass: number;
  maxBiomass: number;
  age: number;
  lifespan: number;
  /** Heritable visual hue offset (plants pass it to their seeds). */
  hue: number;
  /** Shape seed for the renderer. */
  variant: number;
  seedTimer: number;
  /** Stardust taken up from meteor craters; passed to grazers. */
  stardust: number;
  /** Seconds since last grazed (renderer rustle). */
  grazed: number;
}

/** A drifting plant seed that may root when it settles on fertile ground. */
export interface Seed {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hue: number;
  age: number;
  /** Biomass carried by the seed (it becomes the seedling). */
  energy: number;
}

/** Height of a plant in world units for a given biomass. */
export function plantHeight(p: { biomass: number; maxBiomass: number; variant: number }): number {
  const f = Math.sqrt(Math.max(0, p.biomass) / p.maxBiomass);
  return 26 + (150 + 140 * p.variant) * f;
}
