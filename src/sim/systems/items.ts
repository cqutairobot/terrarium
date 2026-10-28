import type { Vec } from '../environment';
import { FOOD_SPECS } from '../entities/food';
import { createProducer } from '../spawn';
import type { World } from '../world';

const flow: Vec = { x: 0, y: 0 };

/** Physics and decay for food, seeds, remains and drifting algae (every step). */
export function updateItems(world: World, dt: number): void {
  const env = world.env;
  const cfg = world.cfg;
  const rng = world.rng;
  const drag = Math.exp(-1.2 * dt);

  for (const f of world.foods) {
    f.age += dt;
    const spec = FOOD_SPECS[f.kind];
    const floor = world.groundAt(f.x) - 2;
    if (f.landed > 0 || f.y >= floor) {
      f.y = floor;
      f.landed += dt;
      f.vx = 0;
      f.vy = 0;
      if (f.kind === 'spore' && f.landed > 5) {
        // a settled glow spore becomes a fungus colony
        if (countKind(world, 'fungus') < cfg.maxFungi) {
          const fungus = createProducer(world.newId(), 'fungus', f.x, world.groundAt(f.x) + 1, rng, cfg.fungusMaxBiomass, 0, rng.next());
          fungus.age = 0;
          fungus.biomass = f.energy;
          world.addProducer(fungus);
          f.energy = 0;
        } else {
          env.addDetritus(f.x, f.y, f.energy);
          f.energy = 0;
        }
        continue;
      }
      if (f.landed > 40) {
        const melt = Math.min(f.energy, f.energy * 0.08 * dt + 0.02 * dt);
        f.energy -= melt;
        env.addNutrient(f.x, f.y - 4, melt);
      }
      continue;
    }
    env.flowAt(f.x, f.y, flow);
    f.vx = f.vx * drag + flow.x * 0.6 * (1 - drag);
    const target = spec.sink;
    f.vy += (target - f.vy) * Math.min(1, dt * 1.5);
    f.x += (f.vx + flow.x * 0.5) * dt;
    f.y += (f.vy + flow.y * 0.3) * dt;
    if (f.kind === 'spore') {
      // spores rise to the surface, drift, then slowly sink again
      if (f.y < 30) f.vy = Math.abs(f.vy) * 0.2 + 2;
      if (f.age > 60) f.vy = Math.max(f.vy, 6);
    }
    if (f.x < 4) f.x = 4;
    if (f.x > world.width - 4) f.x = world.width - 4;
    if (f.y < 6) f.y = 6;
    if (f.age > 420) {
      env.addNutrient(f.x, f.y, f.energy);
      f.energy = 0;
    }
  }

  // seeds drift, settle and (maybe) root
  let w = 0;
  for (const s of world.seeds) {
    s.age += dt;
    env.flowAt(s.x, s.y, flow);
    s.vx = s.vx * drag + flow.x * (1 - drag);
    s.vy += (7 - s.vy) * Math.min(1, dt);
    s.x = Math.min(world.width - 6, Math.max(6, s.x + (s.vx + flow.x * 0.5) * dt));
    s.y += s.vy * dt;
    const floor = world.groundAt(s.x);
    if (s.y >= floor - 2) {
      s.y = floor - 2;
      const crowded = world.plants.some((p) => Math.abs(p.x - s.x) < 16);
      const fertile = env.nutrientAt(s.x, s.y - 10) > 0.5;
      if (!crowded && fertile && countKind(world, 'plant') < cfg.maxPlants) {
        const p = createProducer(world.newId(), 'plant', s.x, floor + 3, rng, cfg.plantMaxBiomass * rng.range(0.75, 1.2), 0, s.hue);
        p.age = 0;
        p.biomass = s.energy;
        world.addProducer(p);
        continue;
      }
      if (s.age > 25) {
        env.addDetritus(s.x, s.y, s.energy);
        continue;
      }
    }
    if (s.age > 120) {
      env.addDetritus(s.x, s.y, s.energy);
      continue;
    }
    world.seeds[w++] = s;
  }
  world.seeds.length = w;

  // remains sink and decay into detritus
  const q = env.q10();
  for (const k of world.corpses) {
    k.age += dt;
    const floor = world.groundAt(k.x) - k.radius * 0.5;
    if (k.y < floor) {
      k.vy += (7 - k.vy) * Math.min(1, dt);
      k.y = Math.min(floor, k.y + k.vy * dt);
    }
    const rot = Math.min(k.biomass, (k.biomass * 0.01 * q + 0.02) * dt);
    k.biomass -= rot;
    env.addDetritus(k.x, k.y, rot);
    if (k.age > 240) {
      env.addDetritus(k.x, k.y, k.biomass);
      k.biomass = 0;
    }
  }

  // algae colonies drift with the current and hold their depth near the light
  for (const p of world.pointProducers) {
    if (p.kind !== 'algae') continue;
    env.flowAt(p.x, p.y, flow);
    const prefer = 70 + (p.variant * 220);
    p.vy += ((prefer - p.y) * 0.02 - p.vy) * Math.min(1, dt * 0.5);
    p.vx += (flow.x * 0.8 - p.vx) * Math.min(1, dt * 0.8);
    p.x += p.vx * dt;
    p.y += (p.vy + flow.y * 0.5) * dt;
    if (p.x < 8) {
      p.x = 8;
      p.vx = Math.abs(p.vx);
    } else if (p.x > world.width - 8) {
      p.x = world.width - 8;
      p.vx = -Math.abs(p.vx);
    }
    if (p.y < 14) p.y = 14;
    const floor = world.groundAt(p.x) - 20;
    if (p.y > floor) p.y = floor;
  }
}

function countKind(world: World, kind: 'plant' | 'algae' | 'fungus'): number {
  let n = 0;
  for (const p of world.producers) if (p.kind === kind) n++;
  return n;
}
