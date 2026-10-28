import { bodyRadius, canBreed, maxEnergyOf } from '../behavior/perception';
import type { Creature } from '../entities/creature';
import { breed, compatibility, express } from '../genome';
import { createCreature } from '../spawn';
import type { World } from '../world';

const COURT_TIME = 2.6;

/** Population pressure on breeding: crowded tanks breed less (smooth, not a wall). */
export function breedingPressure(world: World, c: Creature): number {
  const cfg = world.cfg;
  if (c.ph.trophic === 'carnivore') {
    // hunters hold territories: once the tank is full of them, few new pairs form
    const n = world.predatorCount;
    return 1 / (1 + Math.exp((n - cfg.predatorSoftCap) / 1.2));
  }
  const n = world.creatures.length;
  return 1 / (1 + Math.exp((n - cfg.softCap) / 15));
}

/** A suitor reached its chosen mate: try to begin the courtship dance. */
export function tryCourt(world: World, c: Creature): void {
  const m = world.creatureMap.get(c.targetId);
  if (!m || m.dying > 0 || !canBreed(c) || !canBreed(m) || m.state === 'court' || m.state === 'flee' || m.state === 'hunt') {
    c.thinkTimer = 0;
    return;
  }
  const d = Math.hypot(m.x - c.x, m.y - c.y);
  if (d > bodyRadius(c) + bodyRadius(m) + 16) return;
  const compat = compatibility(c.genome, m.genome, world.cfg.compatDistance);
  if (world.rng.next() > compat) {
    // not a match: both move on for a while
    c.reproCooldown = Math.max(c.reproCooldown, 12);
    c.thinkTimer = 0;
    return;
  }
  for (const [a, b] of [
    [c, m],
    [m, c],
  ] as const) {
    a.state = 'court';
    a.stateTime = 0;
    a.partnerId = b.id;
    a.targetKind = 'creature';
    a.targetId = b.id;
    a.danceT = COURT_TIME;
    a.courtLead = false;
  }
  // the suitor leads (becomes parent A)
  c.courtLead = true;
  world.emit('court', (c.x + m.x) / 2, (c.y + m.y) / 2, c.ph.hue, bodyRadius(c) + bodyRadius(m), c.id);
}

/** End of a courtship dance: the leading partner lays the eggs. */
export function finishCourtship(world: World, c: Creature): void {
  c.state = 'wander';
  c.stateTime = 0;
  c.thinkTimer = 0;
  if (!c.courtLead) return;
  c.courtLead = false;
  const m = world.creatureMap.get(c.partnerId);
  if (m && m.dying === 0 && m.partnerId === c.id) layEggs(world, c, m);
  c.partnerId = 0;
}

export function layEggs(world: World, a: Creature, b: Creature): number {
  const cfg = world.cfg;
  const rng = world.rng;
  const env = world.env;
  const stardust = Math.max(a.stardust, b.stardust);
  const mult = env.mutationSet * (1 + 2 * stardust);
  const params = { rate: cfg.mutationRate * mult, sigmaScale: cfg.mutationSigma, macroChance: cfg.macroMutationChance * mult };
  const twinChance = (a.ph.twinChance + b.ph.twinChance) / 2;
  const litter = 1 + (rng.next() < twinChance ? 1 : 0);
  let laid = 0;
  for (let i = 0; i < litter; i++) {
    const result = breed(a.genome, b.genome, rng, params, mult);
    const ph = express(result.genome);
    const needS = ph.adultStructure * 0.2025;
    const needE = ph.maxEnergy * 0.2025 * (0.6 + 0.4 * ph.investFraction);
    const pool = needS + needE;
    const half = pool / 2;
    if (a.energy - half < maxEnergyOf(a) * 0.15 || b.energy - half < maxEnergyOf(b) * 0.15) break;
    a.energy -= half;
    b.energy -= half;
    const egg = createCreature({
      id: world.newId(),
      genome: result.genome,
      x: (a.x + b.x) / 2 + rng.range(-6, 6),
      y: (a.y + b.y) / 2 + rng.range(2, 10),
      time: world.time,
      rng,
      speciesId: a.speciesId,
      familyId: a.familyId,
      parentA: a.id,
      parentB: b.id,
      generation: Math.max(a.generation, b.generation) + 1,
      eggEnergy: pool,
      hatchTime: cfg.hatchTime * rng.range(0.85, 1.15),
    });
    // encoding: gene (raised), gene + 50 (lowered), 100 + locus (new rare allele)
    egg.mutations = [...result.notes.map((n) => (n.delta >= 0 ? n.gene : n.gene + 50)), ...result.newRare.map((l) => 100 + l)];
    world.addCreature(egg);
    for (const p of [a, b]) {
      p.children++;
      if (p.kids.length < 24) p.kids.push(egg.id);
    }
    laid++;
  }
  for (const p of [a, b]) {
    p.reproCooldown = p.ph.reproCooldown * (laid > 0 ? 1 : 0.3);
    if (laid > 0 && p.firstReproT < 0) p.firstReproT = world.time;
    p.partnerId = 0;
  }
  if (laid > 0) world.events.push({ t: 'eggs', parentA: a.id, parentB: b.id, count: laid, x: a.x, y: a.y });
  return laid;
}
