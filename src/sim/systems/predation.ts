import { bodyRadius } from '../behavior/perception';
import type { Creature } from '../entities/creature';
import type { World } from '../world';
import { killCreature } from './life';

/**
 * Hunting: bites rather than instant kills. Prey in a school is harder to
 * hit (confusion), armor absorbs damage, and a predator that runs out of
 * stamina gives up — so many chases end with an escape.
 */
export function updateHunt(world: World, c: Creature): void {
  if (c.targetKind !== 'creature') return;
  const prey = world.creatureMap.get(c.targetId);
  if (!prey || prey.dying > 0 || prey.stage === 'egg') {
    c.thinkTimer = 0;
    return;
  }
  const d = Math.hypot(prey.x - c.x, prey.y - c.y);
  if (d < bodyRadius(c) + bodyRadius(prey) + 4 && c.attackCooldown <= 0) bite(world, c, prey);
  if (c.dying > 0 || c.state !== 'hunt') return;
  if (c.stateTime > 40 || c.stamina <= 0.02) {
    // the chase is over; the prey got away
    prey.escapes++;
    world.events.push({ t: 'escape', id: prey.id, predator: c.id });
    c.state = 'rest';
    c.stateTime = 0;
    c.fatigue = Math.min(1, c.fatigue + 0.35);
    c.targetKind = 'point';
    c.tx = c.x;
    c.ty = c.y;
    c.thinkTimer = 3;
  }
}

function bite(world: World, c: Creature, prey: Creature): void {
  const rng = world.rng;
  c.attackCooldown = 1.1;
  const hitChance = (0.85 / (1 + 0.1 * prey.kinN)) * (prey.state === 'rest' ? 1.15 : 1);
  // the prey always notices
  prey.fearX = c.x;
  prey.fearY = c.y;
  prey.fearT = world.time;
  prey.thinkTimer = 0;
  if (rng.next() > hitChance) return;
  // an ambush on unsuspecting prey lands harder
  const surprise = prey.state !== 'flee' ? 1.5 : 1;
  const dmg = c.ph.attack * (0.75 + 0.5 * rng.next()) * (1 - prey.ph.defense) * surprise;
  prey.health -= dmg;
  prey.lastHurt = 'predation';
  prey.lastAttacker = c.id;
  prey.stress = Math.min(1, prey.stress + 0.3);
  c.stamina = Math.max(0, c.stamina - 0.1);
  world.emit('bite', prey.x, prey.y, prey.ph.hue, bodyRadius(prey) * 1.6, prey.id);
  if (prey.health <= 0) {
    const before = world.corpses.length;
    killCreature(world, prey, 'predation', c.id);
    c.kills++;
    const corpse = world.corpses.length > before ? world.corpses[world.corpses.length - 1] : undefined;
    if (corpse) {
      c.state = 'eat';
      c.stateTime = 0;
      c.targetKind = 'corpse';
      c.targetId = corpse.id;
      c.tx = corpse.x;
      c.ty = corpse.y;
      c.thinkTimer = 3;
    } else {
      c.thinkTimer = 0;
    }
  }
}
