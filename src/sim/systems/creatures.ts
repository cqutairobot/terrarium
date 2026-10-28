import { think } from '../behavior/brain';
import { steer } from '../behavior/steering';
import type { Creature } from '../entities/creature';
import type { World } from '../world';
import { updateFeeding } from './feeding';
import { updateDying, updateEgg, updateHealth } from './life';
import { updateMetabolism } from './metabolism';
import { updateHunt } from './predation';
import { finishCourtship, tryCourt } from './reproduction';

/** Advance every creature by one fixed step: think → steer → act → metabolize. */
export function updateCreatures(world: World, dt: number): void {
  const interval = world.cfg.thinkInterval;
  // iterate over a stable length: eggs laid this step start next step
  const n = world.creatures.length;
  for (let i = 0; i < n; i++) {
    const c = world.creatures[i];
    c.px = c.x;
    c.py = c.y;
    c.ph0 = c.heading;
    if (c.dying > 0) {
      updateDying(world, c, dt);
      continue;
    }
    if (c.stage === 'egg') {
      updateEgg(world, c, dt);
      continue;
    }
    if (c.danceT > 0) {
      c.danceT -= dt;
      if (c.danceT <= 0) {
        if (c.state === 'court') finishCourtship(world, c);
        else if (c.state === 'social') finishSocial(world, c);
        else c.partnerId = 0;
      }
    }
    c.thinkTimer -= dt;
    if (c.thinkTimer <= 0) {
      think(world, c);
      const urgent = c.state === 'flee' || c.state === 'hunt';
      c.thinkTimer = interval * (0.75 + 0.5 * world.rng.next()) * (urgent ? 0.5 : 1);
    }
    steer(world, c, dt);
    if (c.state === 'seekMate' && c.targetKind === 'creature') tryCourt(world, c);
    else if (c.state === 'hunt') updateHunt(world, c);
    updateFeeding(world, c, dt);
    updateMetabolism(world, c, dt);
    updateHealth(world, c, dt);
  }
}

/** End of a social greeting: share where food was last seen, feel a little calmer. */
function finishSocial(world: World, c: Creature): void {
  const o = world.creatureMap.get(c.partnerId);
  if (o && o.memFoodT > c.memFoodT) {
    c.memFoodX = o.memFoodX;
    c.memFoodY = o.memFoodY;
    c.memFoodT = o.memFoodT;
  }
  c.stress = Math.max(0, c.stress - 0.3);
  c.state = 'wander';
  c.stateTime = 0;
  c.partnerId = 0;
  c.thinkTimer = 0;
}
