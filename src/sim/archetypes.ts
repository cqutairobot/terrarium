import type { GeneTemplate, Morph } from './genome';

/**
 * Founding body plans. A new world picks two consumer archetypes and one
 * predator archetype and jitters them by seed, so every world starts with
 * different-looking (and differently adapted) life.
 */
export interface Archetype {
  key: string;
  template: GeneTemplate;
  count: number;
  /** Body plan (absent: fish). */
  morph?: Morph;
}

export const CONSUMER_ARCHETYPES: readonly Archetype[] = [
  {
    // small, quick, schooling grazers
    key: 'schooler',
    count: 22,
    template: {
      size: 0.22, speed: 0.55, perception: 0.45, metabolism: 0.5, longevity: 0.4, fertility: 0.6,
      aggression: 0.15, armor: 0.12, sociability: 0.78, curiosity: 0.5, timidity: 0.62, activity: 0.62,
      nocturnality: 0.2, thermalPref: 0.45, diet: 0.08, hue: 0.48, accentHue: 0.56, brightness: 0.5,
      elongation: 0.28, tailLength: 0.55, finSize: 0.45, tentacles: 0.3, eyeSize: 0.6,
    },
  },
  {
    // round, solitary browsers with long feelers
    key: 'browser',
    count: 20,
    template: {
      size: 0.33, speed: 0.4, perception: 0.42, metabolism: 0.45, longevity: 0.5, fertility: 0.42,
      aggression: 0.3, armor: 0.32, sociability: 0.25, curiosity: 0.62, timidity: 0.4, activity: 0.45,
      nocturnality: 0.45, thermalPref: 0.55, diet: 0.12, hue: 0.04, accentHue: 0.85, brightness: 0.56,
      elongation: 0.12, tailLength: 0.32, finSize: 0.6, tentacles: 0.62, eyeSize: 0.72,
    },
  },
  {
    // slow, armored, nocturnal bottom grazers
    key: 'nibbler',
    count: 20,
    template: {
      size: 0.3, speed: 0.3, perception: 0.35, metabolism: 0.35, longevity: 0.6, fertility: 0.35,
      aggression: 0.25, armor: 0.55, sociability: 0.4, curiosity: 0.35, timidity: 0.5, activity: 0.35,
      nocturnality: 0.72, thermalPref: 0.4, diet: 0.1, hue: 0.14, accentHue: 0.3, brightness: 0.42,
      elongation: 0.2, tailLength: 0.25, finSize: 0.35, tentacles: 0.45, eyeSize: 0.8,
    },
  },
  {
    // airy drifters with many feelers
    key: 'drifter',
    count: 22,
    template: {
      size: 0.2, speed: 0.38, perception: 0.6, metabolism: 0.55, longevity: 0.35, fertility: 0.7,
      aggression: 0.1, armor: 0.08, sociability: 0.55, curiosity: 0.7, timidity: 0.55, activity: 0.5,
      nocturnality: 0.35, thermalPref: 0.6, diet: 0.06, hue: 0.78, accentHue: 0.62, brightness: 0.62,
      elongation: 0.08, tailLength: 0.2, finSize: 0.7, tentacles: 0.85, eyeSize: 0.55,
    },
  },
];

export const PREDATOR_ARCHETYPES: readonly Archetype[] = [
  {
    // long, gliding night hunters with a glowing lure
    key: 'glider',
    count: 2,
    template: {
      size: 0.6, speed: 0.5, perception: 0.62, metabolism: 0.2, longevity: 0.7, fertility: 0.22,
      aggression: 0.62, armor: 0.3, sociability: 0.1, curiosity: 0.4, timidity: 0.12, activity: 0.38,
      nocturnality: 0.62, thermalPref: 0.5, diet: 0.9, hue: 0.69, accentHue: 0.13, brightness: 0.45,
      elongation: 0.66, tailLength: 0.72, finSize: 0.75, tentacles: 0.1, eyeSize: 0.45,
    },
  },
  {
    // stocky ambushers that cruise near the plants
    key: 'lurker',
    count: 2,
    template: {
      size: 0.62, speed: 0.44, perception: 0.55, metabolism: 0.18, longevity: 0.75, fertility: 0.2,
      aggression: 0.7, armor: 0.42, sociability: 0.08, curiosity: 0.3, timidity: 0.1, activity: 0.3,
      nocturnality: 0.4, thermalPref: 0.45, diet: 0.92, hue: 0.12, accentHue: 0.02, brightness: 0.4,
      elongation: 0.5, tailLength: 0.55, finSize: 0.55, tentacles: 0.25, eyeSize: 0.5,
    },
  },
];

/**
 * Other body plans. They never appear in a new world by themselves; the
 * player brings them in (shop, challenges).
 */
export const FORM_ARCHETYPES: readonly Archetype[] = [
  {
    // pale, pulsing bells trailing long threads, grazing the drifting algae
    key: 'jelly',
    count: 5,
    morph: 'jelly',
    template: {
      size: 0.3, speed: 0.35, perception: 0.4, metabolism: 0.35, longevity: 0.45, fertility: 0.55,
      aggression: 0.08, armor: 0.05, sociability: 0.45, curiosity: 0.3, timidity: 0.3, activity: 0.4,
      nocturnality: 0.5, thermalPref: 0.5, diet: 0.08, hue: 0.56, accentHue: 0.86, brightness: 0.72,
      elongation: 0.1, tailLength: 0.1, finSize: 0.3, tentacles: 0.6, eyeSize: 0.25,
    },
  },
  {
    // little red shrimp that keep to the floor and clean up whatever settles there
    key: 'shrimp',
    count: 6,
    morph: 'shrimp',
    template: {
      size: 0.16, speed: 0.6, perception: 0.5, metabolism: 0.55, longevity: 0.35, fertility: 0.7,
      aggression: 0.2, armor: 0.4, sociability: 0.4, curiosity: 0.6, timidity: 0.65, activity: 0.6,
      nocturnality: 0.6, thermalPref: 0.55, diet: 0.45, hue: 0.02, accentHue: 0.08, brightness: 0.62,
      elongation: 0.6, tailLength: 0.5, finSize: 0.4, tentacles: 0.5, eyeSize: 0.5,
    },
  },
  {
    // slow amber snails creeping along the floor, grazing the plants' feet
    key: 'snail',
    count: 4,
    morph: 'snail',
    template: {
      size: 0.28, speed: 0.25, perception: 0.3, metabolism: 0.25, longevity: 0.75, fertility: 0.4,
      aggression: 0.05, armor: 0.75, sociability: 0.2, curiosity: 0.3, timidity: 0.6, activity: 0.3,
      nocturnality: 0.55, thermalPref: 0.5, diet: 0.05, hue: 0.1, accentHue: 0.06, brightness: 0.45,
      elongation: 0.3, tailLength: 0.1, finSize: 0.1, tentacles: 0.3, eyeSize: 0.4,
    },
  },
];
