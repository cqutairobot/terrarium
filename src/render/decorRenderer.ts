import { hash32 } from '../sim/core/rng';
import type { Decor } from '../sim/decor';
import { hsl } from './color';
import { drawSprite, glowSprite, whiteSprite } from './sprites';

/** The decoration itself, drawn behind the creatures. */
export function drawDecor(ctx: CanvasRenderingContext2D, d: Decor, vt: number, night: number): void {
  ctx.save();
  ctx.translate(d.x, d.y);
  if (d.kind === 'shelter') drawShelter(ctx, d, night);
  else if (d.kind === 'lamp') drawLamp(ctx, d, vt);
  else drawStone(ctx, d, vt, night);
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Light and warmth, added over the scene after the creatures. */
export function drawDecorGlow(ctx: CanvasRenderingContext2D, d: Decor, vt: number, night: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (d.kind === 'lamp') {
    const flicker = 0.92 + 0.08 * Math.sin(vt * 2.3 + d.id);
    drawSprite(ctx, glowSprite(0.13, 0.7, 0.72), d.x, d.y - 62, 120, (0.22 + 0.4 * night) * flicker);
    drawSprite(ctx, glowSprite(0.12, 0.8, 0.8), d.x, d.y - 62, 26, 0.7 * flicker);
  } else if (d.kind === 'warmStone') {
    const pulse = 0.8 + 0.2 * Math.sin(vt * 1.1 + d.id);
    drawSprite(ctx, glowSprite(0.06, 0.85, 0.6), d.x, d.y - 12, 90, (0.16 + 0.12 * night) * pulse);
  } else if (d.kind === 'coolStone') {
    const pulse = 0.8 + 0.2 * Math.sin(vt * 0.9 + d.id);
    drawSprite(ctx, glowSprite(0.53, 0.6, 0.7), d.x, d.y - 12, 80, (0.1 + 0.1 * night) * pulse);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawShelter(ctx: CanvasRenderingContext2D, d: Decor, night: number): void {
  const w = 64;
  const h = 56;
  const dim = 1 - 0.3 * night;
  // an irregular dome of stone, the same for the same rock every time
  ctx.beginPath();
  ctx.moveTo(-w, 6);
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = Math.PI + t * Math.PI;
    const j = 0.86 + 0.22 * hash32(d.id * 31 + i);
    ctx.lineTo(Math.cos(a) * w * j, Math.sin(a) * h * j);
  }
  ctx.lineTo(w, 6);
  ctx.closePath();
  const gr = ctx.createLinearGradient(0, -h, 0, 6);
  gr.addColorStop(0, hsl(0.38, 0.12, 0.42 * dim));
  gr.addColorStop(1, hsl(0.42, 0.14, 0.2 * dim));
  ctx.fillStyle = gr;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 12, 14, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // the way in
  ctx.fillStyle = 'rgba(2, 12, 14, 0.82)';
  ctx.beginPath();
  ctx.ellipse(0, 4, w * 0.42, h * 0.5, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  // moss on top
  ctx.fillStyle = hsl(0.3, 0.45, 0.4 * dim, 0.8);
  for (let i = 0; i < 7; i++) {
    const t = (i + 0.5) / 7;
    const a = Math.PI + t * Math.PI;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * w * 0.82, Math.sin(a) * h * 0.86, 3 + 3 * hash32(d.id * 7 + i), 0, Math.PI * 2);
    ctx.fill();
  }
  drawSprite(ctx, whiteSprite(), -w * 0.35, -h * 0.65, 22, 0.12 * dim);
}

function drawStone(ctx: CanvasRenderingContext2D, d: Decor, vt: number, night: number): void {
  const warm = d.kind === 'warmStone';
  const dim = 1 - 0.25 * night;
  const hue = warm ? 0.05 : 0.55;
  const gr = ctx.createRadialGradient(-6, -14, 2, 0, -8, 28);
  gr.addColorStop(0, hsl(hue, warm ? 0.35 : 0.3, 0.55 * dim));
  gr.addColorStop(1, hsl(hue, warm ? 0.3 : 0.25, 0.26 * dim));
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.ellipse(0, -9, 26, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  if (warm) {
    // glowing seams
    const glow = 0.6 + 0.4 * Math.sin(vt * 1.1 + d.id);
    ctx.strokeStyle = hsl(0.07, 0.95, 0.6, 0.55 + 0.35 * glow);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-14, -12);
    ctx.lineTo(-4, -8);
    ctx.lineTo(2, -14);
    ctx.lineTo(12, -9);
    ctx.stroke();
    // warm water rising
    ctx.fillStyle = 'rgba(255, 210, 160, 0.35)';
    for (let i = 0; i < 4; i++) {
      const t = (vt * 0.35 + i / 4 + hash32(d.id + i)) % 1;
      ctx.beginPath();
      ctx.arc(Math.sin(t * 9 + i) * 8, -22 - t * 60, 1.4 * (1 - t), 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // frost glints
    for (let i = 0; i < 5; i++) {
      const tw = 0.5 + 0.5 * Math.sin(vt * 2 + i * 1.9 + d.id);
      drawSprite(ctx, whiteSprite(), -16 + i * 8, -14 + (i % 2) * 6, 4 + 2 * tw, 0.35 * tw);
    }
  }
  ctx.globalAlpha = 1;
  drawSprite(ctx, whiteSprite(), -8, -16, 10, 0.2 * dim);
}

function drawLamp(ctx: CanvasRenderingContext2D, d: Decor, vt: number): void {
  const sway = Math.sin(vt * 0.8 + d.id) * 3;
  // a slender stalk rising from a little stone
  ctx.strokeStyle = hsl(0.36, 0.25, 0.32);
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -4);
  ctx.quadraticCurveTo(sway * 0.4, -34, sway, -58);
  ctx.stroke();
  ctx.fillStyle = hsl(0.4, 0.12, 0.3);
  ctx.beginPath();
  ctx.ellipse(0, -2, 9, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // the lamp: a soft globe with a warm heart
  ctx.fillStyle = hsl(0.13, 0.75, 0.82, 0.92);
  ctx.beginPath();
  ctx.arc(sway, -62, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hsl(0.11, 0.9, 0.62);
  ctx.beginPath();
  ctx.arc(sway, -62, 3, 0, Math.PI * 2);
  ctx.fill();
}
