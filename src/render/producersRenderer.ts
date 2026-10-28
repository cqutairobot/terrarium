import { hash32 } from '../sim/core/rng';
import type { Vec } from '../sim/environment';
import { plantHeight, type Producer } from '../sim/entities/producer';
import type { World } from '../sim/world';
import { hsl } from './color';
import { drawSprite, glowSprite } from './sprites';

const flow: Vec = { x: 0, y: 0 };
const xs: number[] = [];
const ys: number[] = [];

/**
 * Seaweed in three growth habits picked by the plant's variant gene:
 * fine grass tufts, broad ribbon kelp and round-leaved stems. Colors are
 * muted teal-greens that dim at night; height follows biomass.
 */
export function drawPlant(ctx: CanvasRenderingContext2D, world: World, p: Producer, vt: number, detail: number): void {
  const env = world.env;
  const h = plantHeight(p);
  const fill = Math.sqrt(Math.max(0, p.biomass) / p.maxBiomass);
  env.flowAt(p.x, p.y - h * 0.6, flow);
  const night = 1 - env.daylight;
  const depth = hash32(p.id * 3 + 1); // 0 = far (darker), 1 = near
  const hue = 0.37 + p.hue + (hash32(p.id) - 0.5) * 0.06;
  const dim = (1 - 0.42 * night) * (0.78 + 0.22 * depth);
  const rustle = p.grazed < 1.5 ? (1.5 - p.grazed) * 2.5 : 0;
  const style = p.variant < 0.42 ? 'grass' : p.variant < 0.78 ? 'ribbon' : 'round';
  const strands = style === 'grass' ? 4 + Math.floor(hash32(p.id * 7) * 4) : style === 'ribbon' ? 1 + Math.floor(hash32(p.id * 7) * 2) : 1 + Math.floor(hash32(p.id * 7) * 2);
  const segs = detail > 1 ? 8 : 5;

  for (let s = 0; s < strands; s++) {
    const r0 = hash32(p.id * 31 + s * 5);
    const r1 = hash32(p.id * 17 + s * 11);
    const sh = h * (style === 'grass' ? 0.45 + 0.5 * r0 : 0.7 + 0.3 * r0);
    const baseX = p.x + (s - (strands - 1) / 2) * (style === 'grass' ? 3 + 2 * r1 : 7 + 4 * r1);
    const width =
      style === 'grass' ? (1.6 + 1.4 * r1) * (0.7 + 0.4 * fill) : style === 'ribbon' ? (6 + 5 * r1) * (0.6 + 0.5 * fill) : 2.2 + r1;
    const phase = r1 * 6.28 + p.x * 0.01;
    const amp = (style === 'ribbon' ? 9 : 6) + sh * 0.05 + rustle;
    xs.length = 0;
    ys.length = 0;
    for (let j = 0; j <= segs; j++) {
      const f = j / segs;
      const sway =
        Math.sin(vt * 0.5 + phase + j * 0.45) * amp * f * f +
        Math.sin(vt * 1.2 + phase * 2 + j * 0.8) * (style === 'ribbon' ? 2.2 : 1.1) * f +
        flow.x * 1.8 * f * f;
      xs.push(baseX + sway);
      ys.push(p.y - sh * f);
    }
    const light0 = (0.17 + 0.04 * r0) * dim;
    const light1 = (0.36 + 0.1 * r0 + 0.06 * fill) * dim;
    const sat = 0.34 + 0.12 * fill;
    const g = ctx.createLinearGradient(0, p.y, 0, p.y - sh);
    g.addColorStop(0, hsl(hue - 0.02, sat, light0, 0.95));
    g.addColorStop(1, hsl(hue + 0.03 + r0 * 0.03, sat + 0.06, light1, 0.9));
    ctx.fillStyle = g;
    ribbon(ctx, width, segs, style === 'ribbon');
    ctx.fill();
    if (style === 'ribbon' && detail > 0) {
      // midrib
      ctx.strokeStyle = hsl(hue + 0.04, sat, light1 + 0.08, 0.35);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(xs[0], ys[0]);
      for (let j = 1; j <= segs; j++) ctx.lineTo(xs[j], ys[j]);
      ctx.stroke();
    }
    if (style === 'round' && detail > 0) {
      const leafCol = hsl(hue + 0.05, sat + 0.08, light1 + 0.04, 0.9);
      ctx.fillStyle = leafCol;
      for (let j = 1; j <= segs; j++) {
        if (hash32(p.id * 13 + s * 7 + j) > 0.45 + 0.5 * fill) continue;
        const side = j % 2 === 0 ? 1 : -1;
        const lr = (2.6 + 2.4 * fill) * (1 - (j / segs) * 0.35);
        const wob = Math.sin(vt * 0.9 + j + phase) * 0.25;
        const lx = xs[j] + side * (lr * 1.1 + Math.cos(wob) * 1.5);
        const ly = ys[j] + Math.sin(wob) * 2;
        ctx.beginPath();
        ctx.ellipse(lx, ly, lr * 1.15, lr * 0.75, side * 0.4 + wob, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (style === 'grass' && detail > 1 && hash32(p.id + s) > 0.7) {
      // a few tiny seed heads catch the light
      ctx.fillStyle = hsl(hue + 0.08, 0.35, light1 + 0.18, 0.7);
      ctx.beginPath();
      ctx.arc(xs[segs], ys[segs], 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // stardust shimmer from a meteor crater
  if (p.stardust > 0.05) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawSprite(ctx, glowSprite(0.13, 0.9, 0.75), xs[xs.length - 1], ys[ys.length - 1], 8 + 6 * p.stardust, 0.28 * p.stardust * (0.6 + 0.4 * Math.sin(vt * 2 + p.id)));
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

/** Build a tapered ribbon path along xs/ys. */
function ribbon(ctx: CanvasRenderingContext2D, width: number, segs: number, wavyEdge: boolean): void {
  ctx.beginPath();
  for (let j = 0; j <= segs; j++) {
    const f = j / segs;
    const w = width * (wavyEdge ? (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, f * 1.2 + 0.15))) * (1 - f * 0.55) : 1 - f * 0.88);
    const nx = j < segs ? ys[j + 1] - ys[j] : ys[j] - ys[j - 1];
    const ny = j < segs ? xs[j] - xs[j + 1] : xs[j - 1] - xs[j];
    const nl = Math.hypot(nx, ny) || 1;
    const px = xs[j] + (nx / nl) * w * 0.5;
    const py = ys[j] + (ny / nl) * w * 0.5;
    if (j === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  for (let j = segs; j >= 0; j--) {
    const f = j / segs;
    const w = width * (wavyEdge ? (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, f * 1.2 + 0.15))) * (1 - f * 0.55) : 1 - f * 0.88);
    const nx = j < segs ? ys[j + 1] - ys[j] : ys[j] - ys[j - 1];
    const ny = j < segs ? xs[j] - xs[j + 1] : xs[j - 1] - xs[j];
    const nl = Math.hypot(nx, ny) || 1;
    ctx.lineTo(xs[j] - (nx / nl) * w * 0.5, ys[j] - (ny / nl) * w * 0.5);
  }
  ctx.closePath();
}

/** Algae colony: soft translucent beads or short filaments, slowly turning. */
export function drawAlgae(ctx: CanvasRenderingContext2D, world: World, p: Producer, x: number, y: number, vt: number): void {
  const fill = Math.sqrt(Math.max(0, p.biomass) / p.maxBiomass);
  const night = 1 - world.env.daylight;
  const hue = 0.25 + p.hue + p.variant * 0.08;
  const light = (0.5 + 0.12 * fill) * (1 - 0.35 * night);
  const rot = vt * (0.12 + p.variant * 0.15) + p.id;
  if (p.variant > 0.62) {
    // filament
    const len = 6 + 12 * fill;
    ctx.strokeStyle = hsl(hue, 0.45, light, 0.45);
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
      const f = i / 5 - 0.5;
      const px = x + Math.cos(rot) * f * len + Math.sin(vt * 1.5 + i + p.id) * 1.2;
      const py = y + Math.sin(rot) * f * len * 0.6 + Math.cos(vt * 1.2 + i) * 1.2;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    return;
  }
  const n = 3 + Math.floor(fill * 4);
  const spread = 2.5 + 5 * fill;
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    const rr = spread * (0.45 + 0.55 * hash32(p.id * 3 + i));
    const bx = x + Math.cos(a) * rr;
    const by = y + Math.sin(a) * rr * 0.8;
    const size = 1 + 1.6 * fill * (0.5 + hash32(p.id + i * 7));
    ctx.fillStyle = hsl(hue + i * 0.008, 0.5, light, 0.42);
    ctx.beginPath();
    ctx.arc(bx, by, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Glowing fungus: small caps on the floor that brighten at night. */
export function drawFungus(ctx: CanvasRenderingContext2D, world: World, p: Producer, vt: number): void {
  const fill = Math.sqrt(Math.max(0, p.biomass) / p.maxBiomass);
  const night = 1 - world.env.daylight;
  const caps = 1 + Math.floor(hash32(p.id * 3) * 3);
  const hue = 0.47 + p.hue * 0.4; // cyan → violet
  for (let i = 0; i < caps; i++) {
    const r0 = hash32(p.id * 11 + i);
    const cx = p.x + (i - (caps - 1) / 2) * 6 + (r0 - 0.5) * 4;
    const stem = (5 + 9 * r0) * (0.5 + 0.5 * fill);
    const cap = (2.5 + 3 * r0) * (0.6 + 0.4 * fill);
    const top = p.y - stem;
    ctx.strokeStyle = hsl(hue, 0.25, 0.7, 0.6);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(cx, p.y);
    ctx.quadraticCurveTo(cx + Math.sin(vt * 0.7 + r0 * 6) * 1.2, p.y - stem * 0.5, cx, top);
    ctx.stroke();
    ctx.fillStyle = hsl(hue, 0.55, 0.62 + 0.18 * night, 0.85);
    ctx.beginPath();
    ctx.ellipse(cx, top, cap, cap * 0.62, 0, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    const pulse = 0.75 + 0.25 * Math.sin(vt * 1.4 + r0 * 9);
    const glow = (0.12 + 0.55 * night) * fill * pulse;
    if (glow > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawSprite(ctx, glowSprite(hue, 0.85, 0.65), cx, top, cap * 5, glow);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }
}
