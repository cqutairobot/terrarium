import type { Creature } from '../sim/entities/creature';
import { express, type Genome } from '../sim/genome';
import { createVisual, drawCreature, type CreatureVisual, type DrawOpts } from './creatureRenderer';

let scratch: CanvasRenderingContext2D | null = null;

/** A calm, adult pose for a creature known only by its genes. */
function poseOf(genome: Genome, id: number): Creature {
  const ph = express(genome);
  return {
    id,
    ph,
    growth: 1,
    dying: 0,
    vx: ph.maxSpeed * 0.2,
    vy: 0,
    state: 'wander',
    stateTime: 0,
    stage: 'adult',
    glowT: 0,
    swim: 0.9,
    lookX: 1,
    lookY: 0.15,
    munch: 0,
    eggTimer: 0,
  } as unknown as Creature;
}

/**
 * Draw a creature from its genome alone (for the codex, the archive and the
 * 'then and now' comparison), facing right and scaled to fit the canvas.
 */
export function drawPortrait(canvas: HTMLCanvasElement, genome: Genome, opts: { id?: number; night?: number } = {}): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const c = poseOf(genome, opts.id ?? 7);
  const ph = c.ph;
  const r = ph.radius;
  const body = r * (0.75 + 0.42 * ph.elong);
  const pred = ph.diet > 0.6;
  const back = body + r * (pred ? 2 + ph.tailLen : 0.9 + 1.1 * ph.tailLen);
  const front = body + (pred ? r * 0.9 : ph.antennaLen > 0.35 ? r * 0.8 * ph.antennaLen : r * 0.15);
  const up = r * (pred ? 1.9 + 0.7 * ph.finSize : 1.35);
  const down = r * 1.2 + (ph.tentacleCount > 0 ? r * (0.9 + 0.8 * ph.tentacleLen) : 0);
  const scale = Math.min((w * 0.86) / (front + back), (h * 0.84) / (up + down), 7);
  const cx = (back - front) / 2;
  const cy = (up - down) / 2;
  const o: DrawOpts = { vt: 1.3, dt: 1 / 30, night: opts.night ?? 0, dyingTime: 3.2, scale, detail: 2 };
  const vis: CreatureVisual = createVisual(c);
  // let trailing tentacles settle before the picture is taken
  if (vis.tentCount > 0) {
    if (!scratch) scratch = document.createElement('canvas').getContext('2d');
    if (scratch) for (let i = 0; i < 40; i++) drawCreature(scratch, c, cx, cy, 0, vis, o);
  }
  vis.blinkT = 99;
  vis.blink = 0;
  vis.prevSpeed = Math.hypot(c.vx, c.vy);
  vis.stretch = 0;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, (dpr * w) / 2, (dpr * h) / 2);
  drawCreature(ctx, c, cx, cy, 0, vis, o);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
