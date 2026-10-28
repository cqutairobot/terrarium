import type { StoryEvent } from '../sim/history/narrator';
import type { World } from '../sim/world';

/** A few numbers taken before a catch-up, to tell what changed. */
export interface AwayFacts {
  time: number;
  births: number;
  deaths: number;
  gen: number;
  pop: number;
  species: number;
}

/** "While you were away": what happened in a tank nobody was watching. */
export interface AwaySummary {
  tankName: string;
  awayMs: number;
  simulated: number;
  /** True when the catch-up stopped short (skipped, or the absence was longer than the cap). */
  partial: boolean;
  births: number;
  deaths: number;
  genFrom: number;
  genTo: number;
  popFrom: number;
  popTo: number;
  speciesFrom: number;
  speciesTo: number;
  events: StoryEvent[];
}

function livingSpecies(w: World): number {
  let n = 0;
  for (const s of w.species.values()) if (s.extinctAt === null && s.population > 0) n++;
  return n;
}

export function awayFacts(w: World): AwayFacts {
  return {
    time: w.time,
    births: w.counters.births,
    deaths: w.counters.deaths,
    gen: w.counters.generationsMax,
    pop: w.consumerCount + w.predatorCount,
    species: livingSpecies(w),
  };
}

/** The most telling chronicle entries of the absence: major first, then the latest, in time order. */
export function summarizeAway(before: AwayFacts, after: World, awayMs: number, simulated: number, partial: boolean, maxEvents = 6): AwaySummary {
  const events = after.history.chronicle
    .filter((e) => e.t > before.time)
    .slice()
    .sort((a, b) => b.i - a.i || b.t - a.t)
    .slice(0, maxEvents)
    .sort((a, b) => a.t - b.t);
  return {
    tankName: after.name,
    awayMs,
    simulated,
    partial,
    births: after.counters.births - before.births,
    deaths: after.counters.deaths - before.deaths,
    genFrom: before.gen,
    genTo: after.counters.generationsMax,
    popFrom: before.pop,
    popTo: after.consumerCount + after.predatorCount,
    speciesFrom: before.species,
    speciesTo: livingSpecies(after),
    events,
  };
}
