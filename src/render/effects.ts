import type { FxEvent } from '../sim/world';
import { hsl } from './color';
import { drawSprite, glowSprite } from './sprites';

type Kind = 'ring' | 'mote' | 'spark' | 'bloom' | 'crumb' | 'shock';

interface Fx {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hue: number;
  size: number;
  age: number;
  life: number;
  active: boolean;
}

const POOL = 260;

/** Pooled, restrained visual feedback for births, deaths and other moments. */
export class Effects {
  private pool: Fx[] = [];
  private cursor = 0;
  budget = 1;

  constructor() {
    for (let i = 0; i < POOL; i++) {
      this.pool.push({ kind: 'ring', x: 0, y: 0, vx: 0, vy: 0, hue: 0, size: 0, age: 0, life: 0, active: false });
    }
  }

  private take(): Fx {
    for (let k = 0; k < POOL; k++) {
      const f = this.pool[(this.cursor + k) % POOL];
      if (!f.active) {
        this.cursor = (this.cursor + k + 1) % POOL;
        return f;
      }
    }
    // pool full: recycle the oldest slot in rotation
    const f = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % POOL;
    return f;
  }

  spawn(kind: Kind, x: number, y: number, hue: number, size: number, life: number, vx = 0, vy = 0): void {
    const f = this.take();
    f.kind = kind;
    f.x = x;
    f.y = y;
    f.vx = vx;
    f.vy = vy;
    f.hue = hue;
    f.size = size;
    f.age = 0;
    f.life = life;
    f.active = true;
  }

  /** Translate simulation events into visuals. */
  handle(e: FxEvent): void {
    switch (e.type) {
      case 'hatch':
      case 'birth':
        this.spawn('ring', e.x, e.y, e.hue, e.size * 2, 2.6);
        this.spawn('bloom', e.x, e.y, e.hue, e.size * 3, 1.8);
        break;
      case 'rareBirth':
        this.spawn('ring', e.x, e.y, 0.13, e.size * 3, 5);
        this.spawn('ring', e.x, e.y, 0.13, e.size * 2, 4);
        this.spawn('bloom', e.x, e.y, 0.13, e.size * 5, 4);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          this.spawn('spark', e.x, e.y, 0.12 + (i % 3) * 0.02, 1.6, 3.5, Math.cos(a) * 10, Math.sin(a) * 10 - 4);
        }
        break;
      case 'death':
        this.spawn('bloom', e.x, e.y, e.hue, e.size * 2.2, 2.4);
        break;
      case 'eat':
        if (this.budget > 0.5) this.spawn('crumb', e.x, e.y, e.hue, 0.9, 1.4, (Math.random() - 0.5) * 8, -2 - Math.random() * 4);
        break;
      case 'court':
        this.spawn('bloom', e.x, e.y, e.hue, e.size * 2.5, 2.2);
        break;
      case 'social':
        this.spawn('spark', e.x, e.y - e.size, e.hue, 1.3, 1.6, 0, -6);
        break;
      case 'bite':
        this.spawn('bloom', e.x, e.y, 0.98, e.size, 0.6);
        break;
      case 'impact':
        this.spawn('shock', e.x, e.y, 0.1, e.size, 3);
        this.spawn('bloom', e.x, e.y, 0.1, e.size * 0.6, 3);
        for (let i = 0; i < 24; i++) {
          const a = Math.random() * Math.PI * 2;
          const s = 20 + Math.random() * 60;
          this.spawn('spark', e.x, e.y, 0.1 + Math.random() * 0.06, 2, 4, Math.cos(a) * s, Math.sin(a) * s - 10);
        }
        break;
      case 'feed':
        this.spawn('ring', e.x, e.y, e.hue, 6, 1.2);
        break;
      case 'spore':
        this.spawn('spark', e.x, e.y, e.hue, 1.6, 2.5, 0, -8);
        break;
    }
  }

  /** Light motes rising from a fading creature. */
  dissolve(x: number, y: number, hue: number, r: number): void {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * r;
    this.spawn('mote', x + Math.cos(a) * d, y + Math.sin(a) * d, hue, 1 + Math.random() * 1.6, 3 + Math.random() * 3, (Math.random() - 0.5) * 6, -6 - Math.random() * 8);
  }

  update(dt: number): void {
    for (const f of this.pool) {
      if (!f.active) continue;
      f.age += dt;
      if (f.age >= f.life) {
        f.active = false;
        continue;
      }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.kind === 'spark' || f.kind === 'crumb') {
        f.vx *= Math.exp(-1.2 * dt);
        f.vy *= Math.exp(-1.2 * dt);
        if (f.kind === 'crumb') f.vy += 6 * dt;
      } else if (f.kind === 'mote') {
        f.vx += Math.sin(f.age * 2 + f.x * 0.05) * 3 * dt;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const f of this.pool) {
      if (!f.active) continue;
      const t = f.age / f.life;
      switch (f.kind) {
        case 'ring': {
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          const rr = f.size * (0.4 + t * 1.6);
          ctx.strokeStyle = hsl(f.hue, 0.6, 0.8, (1 - t) * 0.35);
          ctx.lineWidth = 1.2 * (1 - t) + 0.3;
          ctx.beginPath();
          ctx.arc(f.x, f.y, rr, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'shock': {
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          const rr = f.size * (0.2 + t * 1.4);
          ctx.strokeStyle = `rgba(255, 236, 200, ${((1 - t) * 0.5).toFixed(3)})`;
          ctx.lineWidth = 3 * (1 - t) + 0.5;
          ctx.beginPath();
          ctx.arc(f.x, f.y, rr, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'bloom':
          ctx.globalCompositeOperation = 'lighter';
          drawSprite(ctx, glowSprite(f.hue, 0.7, 0.72), f.x, f.y, f.size * (0.8 + t * 0.6), Math.sin(Math.PI * t) * 0.45);
          break;
        case 'mote':
        case 'spark': {
          ctx.globalCompositeOperation = 'lighter';
          const fade = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
          drawSprite(ctx, glowSprite(f.hue, 0.75, 0.78), f.x, f.y, f.size * 3, fade * 0.7);
          break;
        }
        case 'crumb':
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = (1 - t) * 0.7;
          ctx.fillStyle = hsl(f.hue, 0.45, 0.7);
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
          ctx.fill();
          break;
      }
    }
    ctx.restore();
  }
}
