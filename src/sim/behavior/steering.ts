import { angleDiff, clamp } from '../core/math';
import type { Creature } from '../entities/creature';
import { plantHeight } from '../entities/producer';
import type { Vec } from '../environment';
import type { World } from '../world';
import { bodyRadius } from './perception';

const flow: Vec = { x: 0, y: 0 };
const near: number[] = [];

/** Base speed fraction for each intention. */
function stateSpeed(c: Creature): number {
  switch (c.state) {
    case 'wander':
      return 0.3;
    case 'explore':
      return 0.5;
    case 'forage':
      return 0.62;
    case 'eat':
      return 0.25;
    case 'rest':
      return 0.12;
    case 'flee':
      return 1;
    case 'hunt':
      return 0.95;
    case 'seekMate':
      return 0.5;
    case 'court':
      return 0.45;
    case 'social':
      return 0.35;
    case 'follow':
      return 0.6;
    default:
      return 0;
  }
}

/**
 * Turn the current intention into a desired velocity, add separation,
 * schooling and boundary forces, then integrate with inertia and a limited
 * turning rate so motion stays soft and lifelike.
 */
export function steer(world: World, c: Creature, dt: number): void {
  const ph = c.ph;
  const r = bodyRadius(c);
  const elder = c.stage === 'elder' ? 0.8 : 1;
  const cold = 0.7 + 0.3 * Math.min(1, world.env.q10());
  let speedCap = ph.maxSpeed * elder * cold * (0.85 + 0.3 * c.growth);
  const activity = 0.8 + 0.4 * ph.activity;
  let frac = stateSpeed(c) * (c.state === 'flee' || c.state === 'hunt' ? 1 : activity);

  let dvx = 0;
  let dvy = 0;
  switch (c.state) {
    case 'wander': {
      c.wanderAngle += (world.rng.next() - 0.5) * 2.2 * dt;
      // gently prefer the open middle of the water column
      const midY = world.height * 0.45;
      c.wanderAngle += clamp((midY - c.y) / world.height, -0.5, 0.5) * 0.4 * dt * Math.sign(Math.cos(c.wanderAngle));
      dvx = Math.cos(c.wanderAngle);
      dvy = Math.sin(c.wanderAngle) * 0.6;
      break;
    }
    case 'explore':
    case 'forage':
    case 'rest':
    case 'eat': {
      const target = resolveTargetPoint(world, c);
      const dx = target.x - c.x;
      const dy = target.y - c.y;
      const d = Math.hypot(dx, dy) + 1e-6;
      const slow = c.state === 'rest' ? 30 : 60;
      const arrive = Math.min(1, d / slow);
      dvx = (dx / d) * arrive;
      dvy = (dy / d) * arrive;
      if (c.state === 'explore' && d < 30) c.thinkTimer = 0;
      if (c.state === 'forage' && c.targetKind === 'point' && d < 26) c.thinkTimer = 0;
      if (c.state === 'rest') frac *= 0.6 + 0.4 * arrive;
      break;
    }
    case 'hunt':
    case 'seekMate': {
      const o = c.targetKind === 'creature' ? world.creatureMap.get(c.targetId) : undefined;
      if (c.targetKind === 'creature' && (!o || o.dying > 0)) {
        c.thinkTimer = 0;
        break;
      }
      let tx = c.tx;
      let ty = c.ty;
      if (o) {
        tx = o.x;
        ty = o.y;
        if (c.state === 'hunt') {
          // lead the target
          const d0 = Math.hypot(o.x - c.x, o.y - c.y);
          const lead = Math.min(1.2, d0 / Math.max(20, ph.maxSpeed));
          tx += o.vx * lead;
          ty += o.vy * lead;
        }
        c.lookX = (o.x - c.x) / (Math.hypot(o.x - c.x, o.y - c.y) + 1e-6);
        c.lookY = (o.y - c.y) / (Math.hypot(o.x - c.x, o.y - c.y) + 1e-6);
      }
      const dx = tx - c.x;
      const dy = ty - c.y;
      const d = Math.hypot(dx, dy) + 1e-6;
      const arrive = o ? (c.state === 'hunt' ? 1 : Math.min(1, d / 40)) : Math.min(1, d / 60);
      dvx = (dx / d) * arrive;
      dvy = (dy / d) * arrive;
      if (!o) frac *= c.state === 'hunt' ? 0.5 : 0.8;
      else if (c.state === 'hunt') {
        // stalk quietly, then strike from close range
        const strike = 70 + r * 2;
        frac = d > strike ? 0.38 : 1;
      }
      if (!o && d < 30) c.thinkTimer = 0;
      break;
    }
    case 'flee': {
      const t = world.creatureMap.get(c.targetId);
      const fx = t ? t.x : c.fearX;
      const fy = t ? t.y : c.fearY;
      let dx = c.x - fx;
      let dy = c.y - fy;
      const d = Math.hypot(dx, dy) + 1e-6;
      dx /= d;
      dy /= d;
      // slide along the floor / surface rather than pinning against it
      if (c.y > world.groundAt(c.x) - 60 && dy > 0) dy = -0.3;
      if (c.y < 60 && dy < 0) dy = 0.3;
      dvx = dx;
      dvy = dy;
      if ((t && d > 360) || (!t && (d > 300 || world.time - c.fearT > 3))) c.thinkTimer = 0;
      break;
    }
    case 'social':
    case 'court': {
      const o = world.creatureMap.get(c.partnerId);
      if (!o || o.dying > 0) {
        c.danceT = 0;
        c.thinkTimer = 0;
        break;
      }
      const dx = o.x - c.x;
      const dy = o.y - c.y;
      const d = Math.hypot(dx, dy) + 1e-6;
      const want = r + bodyRadius(o) + (c.state === 'court' ? 10 : 6);
      // approach, then orbit around each other
      const radial = clamp((d - want) / 30, -1, 1);
      const spin = c.id < o.id ? 1 : -1;
      dvx = (dx / d) * radial + (-dy / d) * 0.8 * spin;
      dvy = (dy / d) * radial + (dx / d) * 0.8 * spin;
      c.lookX = dx / d;
      c.lookY = dy / d;
      break;
    }
    case 'follow': {
      const o = world.creatureMap.get(c.targetId);
      if (!o || o.dying > 0) {
        c.thinkTimer = 0;
        break;
      }
      // trail slightly behind and below the parent
      const back = bodyRadius(o) + r + 14;
      const hx = Math.cos(o.heading);
      const hy = Math.sin(o.heading);
      const tx = o.x - hx * back + hy * 10;
      const ty = o.y - hy * back + 8;
      const dx = tx - c.x;
      const dy = ty - c.y;
      const d = Math.hypot(dx, dy) + 1e-6;
      const arrive = Math.min(1, d / 50);
      dvx = (dx / d) * arrive;
      dvy = (dy / d) * arrive;
      speedCap = Math.max(speedCap, Math.hypot(o.vx, o.vy) * 1.2);
      break;
    }
    default:
      break;
  }

  let wantVx = dvx * speedCap * frac;
  let wantVy = dvy * speedCap * frac;

  // schooling: align and cohere with kin while cruising
  if (c.kinN > 0 && (c.state === 'wander' || c.state === 'explore' || c.state === 'forage')) {
    const soc = ph.sociability;
    wantVx += (c.kinVx - c.vx) * soc * 0.35 + (c.kinX - c.x) * soc * 0.04;
    wantVy += (c.kinVy - c.vy) * soc * 0.35 + (c.kinY - c.y) * soc * 0.03;
  }

  // separation from close neighbours
  near.length = 0;
  const sepR = r * 2.6 + 14;
  world.cgrid.query(world.creatures, c.x, c.y, sepR + 16, near);
  for (const idx of near) {
    const o = world.creatures[idx];
    if (o === c || o.dying > 0) continue;
    const dx = c.x - o.x;
    const dy = c.y - o.y;
    const d = Math.hypot(dx, dy) + 1e-6;
    const min = r + bodyRadius(o) + 6;
    if (d < min + 12) {
      const push = ((min + 12 - d) / (min + 12)) * speedCap * 0.9;
      if (o.id === c.partnerId && (c.state === 'court' || c.state === 'social')) continue;
      wantVx += (dx / d) * push;
      wantVy += (dy / d) * push;
    }
  }

  // lingering fear of a place where danger was seen
  if (c.fearT >= 0 && world.time - c.fearT < 20 && c.state !== 'flee' && c.state !== 'hunt') {
    const dx = c.x - c.fearX;
    const dy = c.y - c.fearY;
    const d = Math.hypot(dx, dy) + 1e-6;
    if (d < 160) {
      const k = (1 - d / 160) * speedCap * 0.3 * (0.5 + c.ph.timidity);
      wantVx += (dx / d) * k;
      wantVy += (dy / d) * k;
    }
  }

  // soft walls: sides, surface, floor
  const floor = world.groundAt(c.x);
  const margin = 50 + r;
  if (c.x < margin) wantVx += ((margin - c.x) / margin) * speedCap * 0.8;
  if (c.x > world.width - margin) wantVx -= ((c.x - (world.width - margin)) / margin) * speedCap * 0.8;
  if (c.y < margin) wantVy += ((margin - c.y) / margin) * speedCap * 0.8;
  const floorGap = floor - c.y;
  const lowTarget = c.state === 'forage' && c.targetKind !== 'point' && c.targetKind !== 'none';
  const floorMargin = c.state === 'rest' || c.state === 'eat' || lowTarget ? 8 + r : 34 + r;
  if (floorGap < floorMargin) wantVy -= ((floorMargin - floorGap) / floorMargin) * speedCap * 0.9;

  integrate(world, c, wantVx, wantVy, speedCap, dt);
}

function integrate(world: World, c: Creature, wantVx: number, wantVy: number, cap: number, dt: number): void {
  const ph = c.ph;
  const burst = (c.state === 'flee' || c.state === 'hunt') && c.stamina > 0.05;
  const limit = cap * (burst ? 1.18 : 1);
  let ax = wantVx - c.vx;
  let ay = wantVy - c.vy;
  const am = Math.hypot(ax, ay);
  const maxDv = ph.accel * dt * (burst ? 1.3 : 1);
  if (am > maxDv) {
    ax = (ax / am) * maxDv;
    ay = (ay / am) * maxDv;
  }
  c.vx += ax;
  c.vy += ay;
  const sp = Math.hypot(c.vx, c.vy);
  if (sp > limit) {
    c.vx = (c.vx / sp) * limit;
    c.vy = (c.vy / sp) * limit;
  }
  // water drag when idling
  if (Math.hypot(wantVx, wantVy) < 2) {
    const k = Math.exp(-1.6 * dt);
    c.vx *= k;
    c.vy *= k;
  }
  // currents carry small, light bodies more
  world.env.flowAt(c.x, c.y, flow);
  const coupling = 1 / (1 + c.ph.mass * c.growth * 0.25);
  const turb = world.env.turbulence;
  c.x += (c.vx + flow.x * coupling * (0.6 + turb)) * dt;
  c.y += (c.vy + flow.y * coupling * (0.6 + turb)) * dt;

  // hard bounds as a safety net
  const r = bodyRadius(c);
  if (c.x < r) {
    c.x = r;
    c.vx = Math.abs(c.vx) * 0.3;
  } else if (c.x > world.width - r) {
    c.x = world.width - r;
    c.vx = -Math.abs(c.vx) * 0.3;
  }
  if (c.y < r + 2) {
    c.y = r + 2;
    c.vy = Math.abs(c.vy) * 0.3;
  }
  const floor = world.groundAt(c.x) - r * 0.6;
  if (c.y > floor) {
    c.y = floor;
    c.vy = -Math.abs(c.vy) * 0.3;
  }

  // the body turns toward its motion at a limited rate
  const speed = Math.hypot(c.vx, c.vy);
  if (speed > 3) {
    const target = Math.atan2(c.vy, c.vx);
    const diff = angleDiff(c.heading, target);
    const maxTurn = ph.turnRate * dt * (0.5 + Math.min(1, speed / 30));
    c.heading += clamp(diff, -maxTurn, maxTurn);
  }
  if (c.state !== 'court' && c.state !== 'social') {
    const lx = Math.cos(c.heading);
    const ly = Math.sin(c.heading);
    c.lookX += (lx - c.lookX) * Math.min(1, dt * 4);
    c.lookY += (ly - c.lookY) * Math.min(1, dt * 4);
  }
  c.swim += dt * (1.6 + (speed / (r + 4)) * 1.6);
}

const tp = { x: 0, y: 0 };

/** Current target point for point-like intentions; refreshes moving targets. */
export function resolveTargetPoint(world: World, c: Creature): { x: number; y: number } {
  tp.x = c.tx;
  tp.y = c.ty;
  switch (c.targetKind) {
    case 'producer': {
      const p = world.producerMap.get(c.targetId);
      if (!p || p.biomass < 0.5) {
        c.thinkTimer = 0;
        break;
      }
      if (p.kind === 'algae') {
        tp.x = p.x;
        tp.y = p.y;
      } else if (p.kind === 'plant') {
        // aim for the nearest part of the stem; it shrinks as it is grazed
        const top = p.y - plantHeight(p);
        tp.x = p.x;
        tp.y = clamp(c.y, top + 8, p.y - 8);
      } else if (p.kind === 'fungus') {
        tp.x = p.x;
        tp.y = p.y - 6;
      }
      break;
    }
    case 'food': {
      const f = world.foodMap.get(c.targetId);
      if (!f) {
        c.thinkTimer = 0;
        break;
      }
      tp.x = f.x;
      tp.y = f.y;
      break;
    }
    case 'corpse': {
      const k = world.corpseMap.get(c.targetId);
      if (!k) {
        c.thinkTimer = 0;
        break;
      }
      tp.x = k.x;
      tp.y = k.y;
      break;
    }
    default:
      break;
  }
  c.tx = tp.x;
  c.ty = tp.y;
  return tp;
}
