import { bodyRadius } from '../behavior/perception';
import { clamp } from '../core/math';
import type { DisasterKind, ImpactSnapshot, WeatherEvent } from '../environment';
import type { World } from '../world';
import { healthMax, killCreature } from './life';

export interface DisasterSpec {
  duration: number;
  ramp: number;
}

export const DISASTER_SPECS: Record<DisasterKind, DisasterSpec> = {
  storm: { duration: 140, ramp: 18 },
  coldwave: { duration: 170, ramp: 25 },
  heatwave: { duration: 170, ramp: 25 },
  meteor: { duration: 36, ramp: 4 },
  bloom: { duration: 140, ramp: 18 },
};

/** Seconds after an event ends during which its aftermath still counts. */
const AFTERMATH = 30;
/** The meteor falls for this long before it hits. */
export const METEOR_FALL = 1.6;
const METEOR_RADIUS = 95;

function snapshot(world: World): ImpactSnapshot {
  let plants = 0;
  let plantBiomass = 0;
  let algae = 0;
  for (const p of world.producers) {
    if (p.kind === 'plant') {
      plants++;
      plantBiomass += p.biomass;
    } else if (p.kind === 'algae') algae++;
  }
  return {
    creatures: world.creatures.length,
    consumers: world.consumerCount,
    predators: world.predatorCount,
    plants,
    plantBiomass,
    algae,
  };
}

/** Start a disaster (from the observer, or a mild natural one). */
export function triggerDisaster(
  world: World,
  kind: DisasterKind,
  opts: { x?: number; y?: number; natural?: boolean; intensity?: number } = {},
): WeatherEvent {
  const spec = DISASTER_SPECS[kind];
  const natural = opts.natural ?? false;
  const before = snapshot(world);
  const duration = natural ? spec.duration * 0.8 : spec.duration;
  // how many would have died anyway, from the last ten minutes of history
  const recent = world.history.series.window(600, 'sim', world.time, world.clock());
  const span = recent.length > 1 ? recent[recent.length - 1].t - recent[0].t + 10 : 0;
  const rate = span > 0 ? recent.reduce((a, s) => a + s.deaths, 0) / span : 0;
  const e: WeatherEvent = {
    id: world.newId(),
    kind,
    natural,
    start: world.time,
    duration,
    ramp: spec.ramp,
    intensity: opts.intensity ?? (natural ? 0.45 : 1),
    x: clamp(opts.x ?? world.rng.range(world.width * 0.2, world.width * 0.8), 30, world.width - 30),
    y: clamp(opts.y ?? world.height * 0.6, 40, world.groundAt(opts.x ?? world.width / 2) - 10),
    before,
    deaths: 0,
    births: 0,
    expectedDeaths: rate * (duration + AFTERMATH),
    impactKills: 0,
    minPlantBiomass: before.plantBiomass,
    minPlants: before.plants,
    done: false,
  };
  if (kind === 'meteor') e.y = clamp(opts.y ?? world.groundAt(e.x) - 20, 60, world.groundAt(e.x) - 8);
  world.env.events.push(e);
  world.history.add('disasterStart', natural ? 1 : 2, { kind, natural: natural ? 1 : 0 });
  // creatures alive now will remember having lived through it
  for (const c of world.creatures) {
    if (c.dying === 0 && c.stage !== 'egg' && c.disasters.length < 8) c.disasters.push(e.id);
  }
  return e;
}

/** Advance disasters: impacts, bookkeeping, endings with real summaries, natural weather. */
export function updateWeather(world: World, dt: number): void {
  const env = world.env;
  for (const e of env.events) {
    if (e.done) continue;
    const local = world.time - e.start;
    if (e.kind === 'meteor' && local >= METEOR_FALL && local - dt < METEOR_FALL) meteorImpact(world, e);
    for (const ev of world.events) {
      if (ev.t === 'death') {
        e.deaths++;
        if (ev.cause === 'impact') e.impactKills++;
      } else if (ev.t === 'birth') e.births++;
    }
    if (world.tick % 15 === 0) {
      const now = snapshot(world);
      if (now.plantBiomass < e.minPlantBiomass) e.minPlantBiomass = now.plantBiomass;
      if (now.plants < e.minPlants) e.minPlants = now.plants;
    }
    if (local > e.duration + AFTERMATH) {
      e.done = true;
      const before = e.before.plantBiomass;
      const now = snapshot(world);
      const lowest = Math.min(e.minPlantBiomass, now.plantBiomass);
      const loss = before > 0 ? (lowest - before) / before : 0;
      const gain = before > 0 ? (now.plantBiomass - before) / before : 0;
      const plantPct = Math.round((Math.abs(loss) > Math.abs(gain) && loss < 0 ? loss : gain) * 100);
      const excess = Math.max(0, Math.round(e.deaths - e.expectedDeaths));
      const severe = excess >= 12 || Math.abs(plantPct) >= 30 || e.impactKills >= 5;
      world.history.add('disasterEnd', e.natural && !severe ? 1 : severe ? 3 : 2, {
        kind: e.kind,
        natural: e.natural ? 1 : 0,
        plantPct,
        excess,
        impactKills: e.impactKills,
        deaths: e.deaths,
        births: e.births,
        consumersBefore: e.before.consumers,
        consumersAfter: now.consumers,
      });
    }
  }
  if (env.events.length > 0 && env.events.every((e) => e.done)) env.events = env.events.filter((e) => !e.done);
  else if (env.events.length > 12) env.events = env.events.filter((e) => !e.done || world.time - e.start < e.duration + AFTERMATH + 5);

  // mild natural weather now and then (about one every 35 minutes)
  if (env.settings.naturalWeather && env.events.length === 0 && world.rng.next() < dt / 2100) {
    const kinds: DisasterKind[] = ['storm', 'storm', 'coldwave', 'heatwave', 'bloom'];
    triggerDisaster(world, kinds[world.rng.int(kinds.length)], { natural: true, intensity: world.rng.range(0.3, 0.55) });
  }
}

function meteorImpact(world: World, e: WeatherEvent): void {
  const env = world.env;
  const R = METEOR_RADIUS * (0.7 + 0.3 * e.intensity);
  world.emit('impact', e.x, e.y, 0.1, R * 1.6, e.id);
  for (const c of world.creatures) {
    if (c.dying > 0) continue;
    const dx = c.x - e.x;
    const dy = c.y - e.y;
    const d = Math.hypot(dx, dy) + 1e-6;
    if (d < R * 2.2) {
      // shockwave pushes everyone away
      const push = (1 - d / (R * 2.2)) * 160 * e.intensity;
      c.vx += (dx / d) * push;
      c.vy += (dy / d) * push;
      c.fearX = e.x;
      c.fearY = e.y;
      c.fearT = world.time;
      c.thinkTimer = 0;
    }
    if (d < R + bodyRadius(c) && c.stage !== 'egg') {
      const damage = (1 - d / (R + bodyRadius(c))) * 1.3 * healthMax(c) * e.intensity;
      c.health -= damage;
      c.lastHurt = 'impact';
      if (c.health <= 0) killCreature(world, c, 'impact');
    }
  }
  // plants caught in the blast are torn up
  for (const p of world.producers) {
    const d = Math.hypot(p.x - e.x, (p.kind === 'plant' ? p.y - 40 : p.y) - e.y);
    if (d < R) {
      const lost = p.biomass * (1 - d / R) * 0.9;
      p.biomass -= lost;
      env.addDetritus(p.x, p.y - 5, lost);
    }
  }
  // star-stuff: rare minerals that feed the plants and stir the genes of grazers
  const cells = 3;
  for (let ox = -cells; ox <= cells; ox++) {
    for (let oy = -1; oy <= 2; oy++) {
      const x = e.x + ox * env.cell;
      const y = Math.max(e.y, world.groundAt(e.x) - 30) + oy * env.cell * 0.5;
      const i = env.cellIndex(x, y);
      const k = 1 - Math.abs(ox) / (cells + 1);
      env.stardust[i] = Math.min(2, env.stardust[i] + k * 1.5 * e.intensity);
    }
  }
  const gift = 900 * e.intensity;
  env.addNutrient(e.x, world.groundAt(e.x) - 10, gift);
  world.ledger.feed += gift;
}
