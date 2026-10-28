import { clamp } from '../../sim/core/math';
import { G, type GeneKey } from '../../sim/genome';
import { RARE_DEFS } from '../../sim/rareTraits';
import { createProducer } from '../../sim/spawn';
import { introduceFounders, takeAnywhere } from '../../sim/systems/ecology';
import { World } from '../../sim/world';
import type { LevelDef, SetupStep } from './types';

type FounderStep = Extract<SetupStep, { k: 'founders' }>;

/** Bring in a level's founders, with the genes and rare alleles it asks for. */
export function placeFounders(world: World, step: FounderStep): number {
  const born = introduceFounders(world, step.arch, step.count, {
    adult: step.adult,
    near: step.near,
    energy: step.energy,
    tweak: (g, i) => {
      for (const [k, v] of Object.entries(step.genes ?? {})) if (v !== undefined) g.g[G[k as GeneKey]] = clamp(v, 0, 1);
      for (const [k, v] of Object.entries(step.nudge ?? {})) if (v !== undefined) g.g[G[k as GeneKey]] = clamp(g.g[G[k as GeneKey]] + v, 0, 1);
      if (step.some && i < step.some.count) {
        for (const [k, v] of Object.entries(step.some.genes)) if (v !== undefined) g.g[G[k as GeneKey]] = clamp(v, 0, 1);
      }
      for (const a of step.alleles ?? []) {
        const locus = RARE_DEFS.findIndex((d) => d.key === a.key);
        if (locus < 0) continue;
        const homo = a.homo ?? 0;
        const hetero = a.hetero ?? 0;
        const v = a.allele ?? 1;
        if (i < homo) g.rare[locus * 2] = g.rare[locus * 2 + 1] = v;
        else if (i < homo + hetero) g.rare[locus * 2] = v;
      }
    },
  });
  return born.length;
}

function applyStep(world: World, step: SetupStep): void {
  switch (step.k) {
    case 'founders':
      placeFounders(world, step);
      return;
    case 'thin': {
      // keep an even spread across the tank
      const all = world.producers.filter((p) => p.kind === step.kind).sort((a, b) => a.x - b.x);
      const keep = new Set<number>();
      for (let i = 0; i < Math.min(step.keep, all.length); i++) keep.add(all[Math.floor(((i + 0.5) * all.length) / step.keep)].id);
      for (const p of all) {
        if (keep.has(p.id)) continue;
        world.env.addNutrient(p.x, p.kind === 'plant' ? p.y - 10 : p.y, p.biomass);
        world.producerMap.delete(p.id);
      }
      world.producers = world.producers.filter((p) => p.kind !== step.kind || keep.has(p.id));
      return;
    }
    case 'nutrients': {
      const n = world.env.nutrient;
      let delta = 0;
      for (let i = 0; i < n.length; i++) {
        const d = n[i] * (step.scale - 1);
        n[i] += d;
        delta += d;
      }
      // matter that came from (or went to) outside the tank
      world.ledger.inflow += delta;
      return;
    }
    case 'algae': {
      const rng = world.rng;
      for (let i = 0; i < step.count && world.producers.filter((p) => p.kind === 'algae').length < world.cfg.maxAlgae; i++) {
        const got = takeAnywhere(world, world.cfg.algaeMaxBiomass * 0.5);
        if (got <= 0) break;
        const p = createProducer(world.newId(), 'algae', rng.range(40, world.width - 40), rng.range(60, 260), rng, world.cfg.algaeMaxBiomass, 0.5, rng.range(0.22, 0.36));
        p.biomass = got;
        world.addProducer(p);
      }
      return;
    }
  }
}

/** The tank a level starts in: no wild life sneaking in, no surprise weather, then its setup. */
export function createLevelWorld(def: LevelDef, aspect?: number): World {
  const world = new World({
    seed: def.seed,
    aspect: def.aspect ?? aspect ?? 16 / 9,
    name: def.name,
    config: { wildLife: false, ...(def.config ?? {}) },
    settings: { naturalWeather: false, ...(def.settings ?? {}) },
    lifeless: !def.wild,
  });
  for (const step of def.setup) applyStep(world, step);
  world.rebuildGrids();
  return world;
}
