import { Rng } from '../sim/core/rng';
import type { Vec } from '../sim/environment';
import type { World } from '../sim/world';
import type { Camera } from './camera';
import { drawSprite, glowSprite, whiteSprite } from './sprites';

interface Mote {
  x: number;
  y: number;
  depth: number;
  size: number;
  alpha: number;
  phase: number;
  hue: number;
  glow: boolean;
}

interface Bubble {
  x: number;
  y: number;
  r: number;
  vy: number;
  phase: number;
  alive: boolean;
}

const flow: Vec = { x: 0, y: 0 };

/**
 * Purely visual ambience: drifting motes and spores in three depth layers,
 * and bubble streams rising from vents. Never touches the simulation.
 */
export class Ambience {
  private motes: Mote[] = [];
  private bubbles: Bubble[] = [];
  private ventTimers: number[] = [];
  private rng: Rng;

  constructor(private readonly world: World) {
    this.rng = new Rng('ambience:' + world.seed);
    for (let i = 0; i < 160; i++) this.motes.push(this.spawnMote(true));
    this.ventTimers = world.terrain.vents.map(() => this.rng.range(0, 4));
  }

  private spawnMote(anywhere: boolean): Mote {
    const r = this.rng;
    const w = this.world;
    const depth = r.next();
    return {
      x: r.range(-w.width * 0.25, w.width * 1.25),
      y: anywhere ? r.range(0, w.height) : r.chance(0.5) ? -5 : w.height + 5,
      depth,
      size: 0.6 + depth * 1.6 + (r.chance(0.08) ? 2.5 : 0),
      alpha: 0.12 + depth * 0.22,
      phase: r.next() * Math.PI * 2,
      hue: r.chance(0.15) ? r.range(0.42, 0.55) : -1,
      glow: r.chance(0.12),
    };
  }

  update(dt: number): void {
    const w = this.world;
    const env = w.env;
    for (const m of this.motes) {
      env.flowAt(Math.max(0, Math.min(w.width, m.x)), m.y, flow);
      const k = 0.35 + m.depth * 0.65;
      m.x += (flow.x * k + Math.sin(m.phase + env.time * 0.2) * 1.5) * dt;
      m.y += (flow.y * k + 1.8 - m.depth * 1.2 + Math.cos(m.phase * 1.3 + env.time * 0.17) * 1.2) * dt;
      if (m.y > w.height + 10 || m.y < -10 || m.x < -w.width * 0.3 || m.x > w.width * 1.3) {
        Object.assign(m, this.spawnMote(false));
        m.y = this.rng.range(-5, 30);
      }
    }
    // bubbles from vents
    const vents = w.terrain.vents;
    for (let i = 0; i < vents.length; i++) {
      this.ventTimers[i] -= dt;
      if (this.ventTimers[i] <= 0) {
        this.ventTimers[i] = this.rng.range(2.5, 9);
        const count = 2 + this.rng.int(5);
        for (let k = 0; k < count; k++) {
          const b = this.bubbles.find((x) => !x.alive) ?? (this.bubbles.length < 60 ? ({} as Bubble) : null);
          if (!b) break;
          if (!this.bubbles.includes(b)) this.bubbles.push(b);
          b.x = vents[i] + this.rng.range(-4, 4);
          b.y = w.groundAt(vents[i]) - 4 + k * 9;
          b.r = this.rng.range(1.2, 3.4);
          b.vy = -this.rng.range(16, 30);
          b.phase = this.rng.next() * 6.28;
          b.alive = true;
        }
      }
    }
    for (const b of this.bubbles) {
      if (!b.alive) continue;
      b.y += b.vy * dt;
      b.vy -= dt * 4;
      b.x += Math.sin(b.phase + b.y * 0.05) * 6 * dt;
      if (b.y < 4) b.alive = false;
    }
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera, quality: number, layer: 'back' | 'front'): void {
    const night = 1 - this.world.env.daylight;
    const white = whiteSprite();
    const view = cam.view(20);
    const limit = quality >= 2 ? 1 : quality === 1 ? 0.6 : 0.3;
    const n = Math.floor(this.motes.length * limit);
    ctx.save();
    for (let i = 0; i < n; i++) {
      const m = this.motes[i];
      if ((layer === 'front') !== m.depth > 0.82) continue;
      if (m.x < view.x0 || m.x > view.x1 || m.y < view.y0 || m.y > view.y1) continue;
      const tw = 0.7 + 0.3 * Math.sin(m.phase + this.world.env.time * 0.6);
      if (m.glow || m.hue >= 0) {
        ctx.globalCompositeOperation = 'lighter';
        const hue = m.hue >= 0 ? m.hue : 0.47;
        drawSprite(ctx, glowSprite(hue, 0.7, 0.75), m.x, m.y, m.size * 3.2, m.alpha * tw * (0.5 + 0.8 * night));
        ctx.globalCompositeOperation = 'source-over';
      } else {
        drawSprite(ctx, white, m.x, m.y, m.size * 1.6, m.alpha * tw * 0.7);
      }
    }
    if (layer === 'back') {
      ctx.globalAlpha = 1;
      for (const b of this.bubbles) {
        if (!b.alive) continue;
        ctx.strokeStyle = 'rgba(210, 250, 245, 0.45)';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(230, 255, 250, 0.5)';
        ctx.beginPath();
        ctx.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
