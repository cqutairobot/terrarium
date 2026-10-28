import type { EcoConfig, EnvSettings } from './config';
import type { RngState } from './core/rng';
import type { Corpse } from './entities/corpse';
import type { Creature } from './entities/creature';
import type { Food } from './entities/food';
import type { Producer, Seed } from './entities/producer';
import { Environment, type Wave, type WeatherEvent } from './environment';
import { express } from './genome';
import type { FamilyRecord, SpeciesRecord } from './registry';
import type { EcologyState } from './systems/ecology';
import type { Terrain } from './terrain';
import { World, type Ledger, type WorldCounters } from './world';

/** Bump when the snapshot shape changes; add a migration below. */
export const SAVE_VERSION = 1;

export type SavedCreature = Omit<Creature, 'ph'>;

export interface EnvSnapshot {
  settings: EnvSettings;
  lightSet: number;
  nutrientSet: number;
  tempSet: number;
  mutationSet: number;
  time: number;
  dayPhase: number;
  daylight: number;
  light: number;
  lightAvg: number;
  temperature: number;
  turbulence: number;
  flowAmp: number;
  growthBoost: number;
  nutrientBoost: number;
  lightWeather: number;
  tempWeather: number;
  seasonPhase: number;
  driftPhase: number;
  events: WeatherEvent[];
  nutrient: number[];
  detritus: number[];
  stardust: number[];
  waves: Wave[];
  turbWaves: Wave[];
}

export interface WorldSnapshot {
  version: number;
  savedAt: number;
  seed: string;
  name: string;
  width: number;
  height: number;
  createdAt: number;
  time: number;
  tick: number;
  realTime: number;
  nextId: number;
  slowAcc: number;
  speciesTimer: number;
  ecologyTimer: number;
  cfg: EcoConfig;
  rng: RngState;
  terrain: Terrain;
  env: EnvSnapshot;
  creatures: SavedCreature[];
  producers: Producer[];
  foods: Food[];
  corpses: Corpse[];
  seeds: Seed[];
  species: SpeciesRecord[];
  families: FamilyRecord[];
  ledger: Ledger;
  counters: WorldCounters;
  ecology: EcologyState;
  /** History layer state (chronicle, stats, lineage...), owned by the history module. */
  history?: unknown;
}

const clone = <T>(v: T): T => structuredClone(v);

/** Capture everything needed to continue this world exactly where it is. */
export function snapshotWorld(w: World): WorldSnapshot {
  const env = w.env;
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    seed: w.seed,
    name: w.name,
    width: w.width,
    height: w.height,
    createdAt: w.createdAt,
    time: w.time,
    tick: w.tick,
    realTime: w.realTime,
    nextId: w.nextId,
    slowAcc: w.slowAcc,
    speciesTimer: w.speciesTimer,
    ecologyTimer: w.ecologyTimer,
    cfg: { ...w.cfg },
    rng: w.rng.getState(),
    terrain: clone(w.terrain),
    env: {
      settings: { ...env.settings },
      lightSet: env.lightSet,
      nutrientSet: env.nutrientSet,
      tempSet: env.tempSet,
      mutationSet: env.mutationSet,
      time: env.time,
      dayPhase: env.dayPhase,
      daylight: env.daylight,
      light: env.light,
      lightAvg: env.lightAvg,
      temperature: env.temperature,
      turbulence: env.turbulence,
      flowAmp: env.flowAmp,
      growthBoost: env.growthBoost,
      nutrientBoost: env.nutrientBoost,
      lightWeather: env.lightWeather,
      tempWeather: env.tempWeather,
      seasonPhase: env.seasonPhase,
      driftPhase: env.driftPhase,
      events: clone(env.events),
      nutrient: Array.from(env.nutrient),
      detritus: Array.from(env.detritus),
      stardust: Array.from(env.stardust),
      waves: clone(env.waves),
      turbWaves: clone(env.turbWaves),
    },
    creatures: w.creatures.map((c) => {
      const { ph: _ph, ...rest } = c;
      return clone(rest);
    }),
    producers: clone(w.producers),
    foods: clone(w.foods),
    corpses: clone(w.corpses),
    seeds: clone(w.seeds),
    species: clone([...w.species.values()]),
    families: clone([...w.families.values()]),
    ledger: { ...w.ledger },
    counters: { ...w.counters },
    ecology: clone(w.ecology),
    history: w.history ? w.history.save() : undefined,
  };
}

/** Upgrade older snapshots in place (none yet beyond version 1). */
export function migrate(snap: WorldSnapshot): WorldSnapshot {
  if (!snap || typeof snap !== 'object' || typeof snap.version !== 'number') throw new Error('不是有效的生态缸存档');
  if (snap.version > SAVE_VERSION) throw new Error('存档来自更新版本的浮生，无法读取');
  return snap;
}

/** Rebuild a live world from a snapshot. */
export function restoreWorld(input: WorldSnapshot): World {
  const snap = migrate(input);
  const w = new World(
    { seed: snap.seed, aspect: snap.width / snap.height, name: snap.name, config: snap.cfg, createdAt: snap.createdAt },
    true,
  );
  w.terrain = clone(snap.terrain);
  w.env = new Environment(w.width, w.height, w.terrain, w.cfg, snap.env.settings, w.rng.fork('env'));
  const e = w.env;
  const se = snap.env;
  e.lightSet = se.lightSet;
  e.nutrientSet = se.nutrientSet;
  e.tempSet = se.tempSet;
  e.mutationSet = se.mutationSet;
  e.time = se.time;
  e.dayPhase = se.dayPhase;
  e.daylight = se.daylight;
  e.light = se.light;
  e.lightAvg = se.lightAvg;
  e.temperature = se.temperature;
  e.turbulence = se.turbulence;
  e.flowAmp = se.flowAmp;
  e.growthBoost = se.growthBoost;
  e.nutrientBoost = se.nutrientBoost;
  e.lightWeather = se.lightWeather;
  e.tempWeather = se.tempWeather;
  e.seasonPhase = se.seasonPhase;
  e.driftPhase = se.driftPhase;
  e.events = clone(se.events);
  e.nutrient = Float64Array.from(se.nutrient);
  e.detritus = Float64Array.from(se.detritus);
  e.stardust = Float64Array.from(se.stardust);
  e.waves = clone(se.waves);
  e.turbWaves = clone(se.turbWaves);

  w.rng.setState(snap.rng);
  w.time = snap.time;
  w.tick = snap.tick;
  w.realTime = snap.realTime;
  w.nextId = snap.nextId;
  w.slowAcc = snap.slowAcc;
  w.speciesTimer = snap.speciesTimer;
  w.ecologyTimer = snap.ecologyTimer;
  w.ledger = { ...snap.ledger, moved: snap.ledger.moved ?? 0 };
  w.counters = { ...snap.counters };
  w.ecology = clone(snap.ecology);
  for (const s of snap.species) w.species.set(s.id, clone(s));
  for (const f of snap.families) w.families.set(f.id, clone(f));
  for (const sc of snap.creatures) {
    const c = clone(sc) as Creature;
    c.ph = express(c.genome);
    w.addCreature(c);
  }
  for (const p of snap.producers) w.addProducer(clone(p));
  for (const f of snap.foods) w.addFood(clone(f));
  for (const k of snap.corpses) w.addCorpse(clone(k));
  w.seeds = clone(snap.seeds);
  if (snap.history !== undefined && w.history) w.history.load(snap.history);
  w.rebuildGrids();
  return w;
}
