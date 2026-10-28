import type { Corpse } from '../sim/entities/corpse';
import { FOOD_SPECS, type Food } from '../sim/entities/food';
import type { Seed } from '../sim/entities/producer';
import { hsl } from './color';
import { drawSprite, glowSprite } from './sprites';

export function drawFood(ctx: CanvasRenderingContext2D, f: Food, vt: number): void {
  const r = FOOD_SPECS[f.kind].radius * (0.7 + 0.3 * Math.min(1, f.energy / FOOD_SPECS[f.kind].energy));
  const fade = f.landed > 40 ? Math.max(0.2, 1 - (f.landed - 40) / 30) : 1;
  if (f.kind === 'spore') {
    const pulse = 0.7 + 0.3 * Math.sin(vt * 3 + f.id);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawSprite(ctx, glowSprite(0.48, 0.9, 0.72), f.x, f.y, r * 5 * pulse, 0.55 * fade);
    ctx.restore();
    ctx.globalAlpha = fade;
    ctx.fillStyle = hsl(0.48, 0.7, 0.85);
  } else if (f.kind === 'rich') {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawSprite(ctx, glowSprite(0.08, 0.8, 0.65), f.x, f.y, r * 3.2, 0.3 * fade);
    ctx.restore();
    ctx.globalAlpha = fade;
    ctx.fillStyle = hsl(0.07, 0.75, 0.66);
  } else {
    ctx.globalAlpha = fade;
    ctx.fillStyle = hsl(0.11, 0.55, 0.78);
  }
  ctx.beginPath();
  ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.arc(f.x - r * 0.35, f.y - r * 0.35, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function drawCorpse(ctx: CanvasRenderingContext2D, k: Corpse, vt: number): void {
  const left = Math.max(0, k.biomass / Math.max(1, k.initial));
  const a = 0.15 + 0.4 * left;
  ctx.fillStyle = hsl(k.hue, 0.15, 0.7, a);
  ctx.beginPath();
  ctx.ellipse(k.x, k.y, k.radius * (0.6 + 0.5 * left), k.radius * 0.5 * (0.6 + 0.5 * left), Math.sin(k.id) * 0.4, 0, Math.PI * 2);
  ctx.fill();
  if (left > 0.1) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawSprite(ctx, glowSprite(k.hue, 0.4, 0.7), k.x, k.y, k.radius * 2.2, 0.12 * left * (0.7 + 0.3 * Math.sin(vt + k.id)));
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

export function drawSeed(ctx: CanvasRenderingContext2D, s: Seed): void {
  ctx.fillStyle = hsl(0.3 + s.hue, 0.45, 0.7, 0.8);
  ctx.beginPath();
  ctx.ellipse(s.x, s.y, 1.8, 1.2, s.age, 0, Math.PI * 2);
  ctx.fill();
}
