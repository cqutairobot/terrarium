import { think } from '../behavior/brain';
import { steer } from '../behavior/steering';
import type { Creature } from '../entities/creature';
import type { World } from '../world';
import { updateFeeding } from './feeding';
import { updateMetabolism } from './metabolism';

/** Advance every creature by one fixed step: think → steer → feed → metabolize. */
export function updateCreatures(world: World, dt: number): void {
  const interval = world.cfg.thinkInterval;
  for (const c of world.creatures) {
    c.px = c.x;
    c.py = c.y;
    c.ph0 = c.heading;
    if (c.danceT > 0) {
      c.danceT -= dt;
      if (c.danceT <= 0) finishTogetherness(world, c);
    }
    c.thinkTimer -= dt;
    if (c.thinkTimer <= 0) {
      think(world, c);
      const urgent = c.state === 'flee' || c.state === 'hunt';
      c.thinkTimer = interval * (0.75 + 0.5 * world.rng.next()) * (urgent ? 0.5 : 1);
    }
    steer(world, c, dt);
    updateFeeding(world, c, dt);
    updateMetabolism(world, c, dt);
  }
}

/** End of a social greeting: share where food was last seen, feel a little calmer. */
function finishTogetherness(world: World, c: Creature): void {
  const o = world.creatureMap.get(c.partnerId);
  if (c.state === 'social') {
    if (o && o.memFoodT > c.memFoodT) {
      c.memFoodX = o.memFoodX;
      c.memFoodY = o.memFoodY;
      c.memFoodT = o.memFoodT;
    }
    c.stress = Math.max(0, c.stress - 0.3);
    c.state = 'wander';
    c.stateTime = 0;
  }
  c.partnerId = 0;
  c.thinkTimer = 0;
}
