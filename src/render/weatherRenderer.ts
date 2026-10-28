import { eventEnvelope, type WeatherEvent } from '../sim/environment';
import { METEOR_FALL } from '../sim/systems/weather';
import type { World } from '../sim/world';
import type { Camera } from './camera';
import { drawSprite, glowSprite, whiteSprite } from './sprites';

interface Drop {
  x: number;
  y: number;
  len: number;
  speed: number;
}

interface Ripple {
  x: number;
  age: number;
  life: number;
  r: number;
}

interface Flake {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  phase: number;
}

/**
 * Visible weather: rain on the surface, ice crystals, warm haze, a falling
 * meteor and its glittering crater, pollen-like motes during a bloom. All of
 * it follows the real event envelopes from the simulation.
 */
export class WeatherRenderer {
  private drops: Drop[] = [];
  private ripples: Ripple[] = [];
  private flakes: Flake[] = [];

  update(world: World, dt: number): void {
    const storm = strength(world, 'storm');
    const cold = strength(world, 'coldwave');
    // rain drops near the surface
    const wantDrops = Math.floor(storm * 140);
    while (this.drops.length < wantDrops) {
      this.drops.push({ x: Math.random() * world.width, y: -Math.random() * 80, len: 6 + Math.random() * 10, speed: 260 + Math.random() * 160 });
    }
    if (this.drops.length > wantDrops) this.drops.length = wantDrops;
    for (const d of this.drops) {
      d.y += d.speed * dt;
      d.x += d.speed * dt * 0.12;
      if (d.y > 50 + Math.random() * 30) {
        if (Math.random() < 0.35 && this.ripples.length < 60) this.ripples.push({ x: d.x, age: 0, life: 1.2, r: 3 + Math.random() * 6 });
        d.y = -10 - Math.random() * 60;
        d.x = Math.random() * world.width;
      }
    }
    for (const r of this.ripples) r.age += dt;
    this.ripples = this.ripples.filter((r) => r.age < r.life);
    // ice crystals drifting down in a cold wave
    const wantFlakes = Math.floor(cold * 70);
    while (this.flakes.length < wantFlakes) {
      this.flakes.push({ x: Math.random() * world.width, y: Math.random() * world.height * 0.8, vx: (Math.random() - 0.5) * 6, vy: 4 + Math.random() * 8, size: 1 + Math.random() * 2, phase: Math.random() * 6.28 });
    }
    if (this.flakes.length > wantFlakes) this.flakes.length = wantFlakes;
    for (const f of this.flakes) {
      f.x += (f.vx + Math.sin(f.phase + f.y * 0.02) * 4) * dt;
      f.y += f.vy * dt;
      if (f.y > world.groundAt(Math.max(0, Math.min(world.width, f.x))) - 4) {
        f.y = -5;
        f.x = Math.random() * world.width;
      }
    }
  }

  /** World-space layer (between the scene and the front particles). */
  drawWorld(ctx: CanvasRenderingContext2D, world: World, vt: number): void {
    const env = world.env;
    // rain streaks and rings on the surface
    if (this.drops.length > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(210, 240, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of this.drops) {
        if (d.y < 0) continue;
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.len * 0.12, d.y - d.len);
      }
      ctx.stroke();
      for (const r of this.ripples) {
        const t = r.age / r.life;
        ctx.strokeStyle = `rgba(220, 245, 255, ${(0.35 * (1 - t)).toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(r.x, 4, r.r * (0.5 + t * 2), r.r * 0.35 * (0.5 + t * 2), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    // ice crystals
    if (this.flakes.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const white = whiteSprite();
      for (const f of this.flakes) drawSprite(ctx, white, f.x, f.y, f.size * 2.4, 0.35 + 0.25 * Math.sin(vt * 2 + f.phase));
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    // meteors falling, and their glittering craters
    for (const e of env.events) {
      if (e.kind === 'meteor') this.drawMeteor(ctx, world, e, vt);
    }
    this.drawStardust(ctx, world, vt);
    // pollen-like motes rising during a bloom
    const bloom = strength(world, 'bloom');
    if (bloom > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 40; i++) {
        const x = (i * 97.13 + vt * 6 * (1 + (i % 3))) % world.width;
        const base = world.groundAt(x) - 20;
        const y = base - ((vt * (8 + (i % 5) * 3) + i * 53) % 420);
        drawSprite(ctx, glowSprite(0.16 + (i % 4) * 0.05, 0.8, 0.75), x, y, 4, 0.45 * bloom * (0.5 + 0.5 * Math.sin(vt * 2 + i)));
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  private drawMeteor(ctx: CanvasRenderingContext2D, world: World, e: WeatherEvent, vt: number): void {
    const local = world.time - e.start;
    if (local < 0 || local > METEOR_FALL) return;
    const t = local / METEOR_FALL;
    const sx = e.x - 380;
    const sy = -260;
    const x = sx + (e.x - sx) * t * t;
    const y = sy + (e.y - sy) * t * t;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const tail = 140;
    const dx = e.x - sx;
    const dy = e.y - sy;
    const dl = Math.hypot(dx, dy);
    const g = ctx.createLinearGradient(x, y, x - (dx / dl) * tail, y - (dy / dl) * tail);
    g.addColorStop(0, 'rgba(255, 240, 210, 0.9)');
    g.addColorStop(1, 'rgba(255, 180, 120, 0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - (dx / dl) * tail, y - (dy / dl) * tail);
    ctx.stroke();
    drawSprite(ctx, glowSprite(0.1, 0.9, 0.8), x, y, 26 + 6 * Math.sin(vt * 30), 0.9);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private drawStardust(ctx: CanvasRenderingContext2D, world: World, vt: number): void {
    const env = world.env;
    let any = false;
    for (let i = 0; i < env.stardust.length; i++) {
      if (env.stardust[i] > 0.05) {
        any = true;
        break;
      }
    }
    if (!any) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < env.stardust.length; i++) {
      const s = env.stardust[i];
      if (s <= 0.05) continue;
      const cx = (i % env.cols) * env.cell;
      const cy = Math.floor(i / env.cols) * env.cell;
      for (let k = 0; k < 3; k++) {
        const h = (i * 31 + k * 17) % 100;
        const x = cx + (h / 100) * env.cell;
        const floor = world.groundAt(x);
        const y = Math.min(floor - 3, cy + ((h * 7) % 100) / 100 * env.cell);
        const tw = Math.max(0, Math.sin(vt * (1.5 + k) + h));
        drawSprite(ctx, glowSprite(0.12 + k * 0.03, 0.9, 0.8), x, y, 3 + 2 * Math.min(1, s), 0.6 * tw * Math.min(1, s));
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** Screen-space tint for cold and heat (very gentle). */
  drawTint(ctx: CanvasRenderingContext2D, world: World, cam: Camera, vt: number): void {
    const cold = strength(world, 'coldwave');
    const heat = strength(world, 'heatwave');
    if (cold > 0.02) {
      ctx.fillStyle = `rgba(150, 200, 255, ${(0.07 * cold).toFixed(3)})`;
      ctx.fillRect(0, 0, cam.cssW, cam.cssH);
    }
    if (heat > 0.02) {
      ctx.fillStyle = `rgba(255, 190, 120, ${(0.06 * heat * (0.85 + 0.15 * Math.sin(vt * 0.8))).toFixed(3)})`;
      ctx.fillRect(0, 0, cam.cssW, cam.cssH);
    }
  }
}

function strength(world: World, kind: WeatherEvent['kind']): number {
  let s = 0;
  for (const e of world.env.events) if (e.kind === kind) s = Math.max(s, eventEnvelope(e, world.time));
  return s;
}
