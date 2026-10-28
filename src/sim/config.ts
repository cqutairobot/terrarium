/**
 * Ecological parameters. Everything that shapes the balance of the tank lives
 * here so it can be tuned with the headless runner and persisted per world.
 */
export interface EcoConfig {
  // population limits
  maxCreatures: number;
  softCap: number;
  maxPredators: number;
  /** Territorial limit: predator breeding halves around this many hunters. */
  predatorSoftCap: number;
  maxPlants: number;
  maxAlgae: number;
  maxFungi: number;
  maxFood: number;
  maxCorpses: number;
  maxSeeds: number;

  // cycles (seconds of simulated time)
  dayLength: number;
  seasonLength: number;

  // creature energetics
  basalCoeff: number;
  moveCoeff: number;
  refSpeed: number;
  excretion: number;
  structurePerMass: number;
  starvationDamage: number;
  healthRegen: number;
  growthEfficiency: number;
  hatchTime: number;
  dyingTime: number;

  // producers
  plantGrowth: number;
  plantMaxBiomass: number;
  algaeGrowth: number;
  algaeMaxBiomass: number;
  fungusGrowth: number;
  fungusMaxBiomass: number;
  lightAttenuation: number;
  nutrientHalfSat: number;
  plantSeedRate: number;
  algaeSplitRate: number;
  fungusSpawnRate: number;

  // nutrient cycle
  nutrientCell: number;
  nutrientTarget: number;
  nutrientRelax: number;
  diffusion: number;
  sinking: number;
  decomposition: number;

  // genetics
  mutationRate: number;
  mutationSigma: number;
  macroMutationChance: number;
  compatDistance: number;
  speciationDistance: number;

  // behavior
  thinkInterval: number;

  /** Wild life finds its way in: dormant spores revive consumers, strangers bring predators back. Off in a nursery. */
  wildLife: boolean;
}

export const DEFAULT_CONFIG: EcoConfig = {
  maxCreatures: 320,
  softCap: 190,
  maxPredators: 24,
  predatorSoftCap: 6,
  maxPlants: 140,
  maxAlgae: 220,
  maxFungi: 90,
  maxFood: 160,
  maxCorpses: 70,
  maxSeeds: 30,

  dayLength: 1200,
  seasonLength: 7200,

  basalCoeff: 0.18,
  moveCoeff: 0.2,
  refSpeed: 50,
  excretion: 0.75,
  structurePerMass: 60,
  starvationDamage: 4,
  healthRegen: 1.5,
  growthEfficiency: 0.8,
  hatchTime: 8,
  dyingTime: 3.2,

  plantGrowth: 0.2,
  plantMaxBiomass: 150,
  algaeGrowth: 0.18,
  algaeMaxBiomass: 30,
  fungusGrowth: 0.05,
  fungusMaxBiomass: 30,
  lightAttenuation: 1.0,
  nutrientHalfSat: 6,
  plantSeedRate: 0.012,
  algaeSplitRate: 0.05,
  fungusSpawnRate: 0.02,

  nutrientCell: 50,
  nutrientTarget: 110,
  nutrientRelax: 0.01,
  diffusion: 0.08,
  sinking: 0.02,
  decomposition: 0.02,

  mutationRate: 0.06,
  mutationSigma: 1,
  macroMutationChance: 0.0008,
  compatDistance: 0.22,
  speciationDistance: 0.2,

  thinkInterval: 0.45,
  wildLife: true,
};

/** Environment controls the observer can change (targets; the world eases toward them). */
export interface EnvSettings {
  /** Surface light multiplier, 0.2–1.5. */
  light: number;
  /** Nutrient richness multiplier, 0.3–2. */
  nutrients: number;
  /** Baseline temperature, 0 (cold) – 1 (warm). 0.5 ≈ 19°C. */
  temperature: number;
  /** Natural mutation multiplier, 0.25–4. */
  mutation: number;
  /** Mild spontaneous weather events. */
  naturalWeather: boolean;
}

export const DEFAULT_SETTINGS: EnvSettings = {
  light: 1,
  nutrients: 1,
  temperature: 0.5,
  mutation: 1,
  naturalWeather: true,
};

/** Temperature in °C for display. */
export function celsius(t: number): number {
  return 4 + t * 30;
}
