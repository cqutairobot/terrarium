import { angleDiff, clamp } from '../sim/core/math';
import type { Creature } from '../sim/entities/creature';
import { hsl } from './color';
import type { Colors, CreatureVisual, DrawOpts } from './creatureRenderer';
import { drawSprite, whiteSprite } from './sprites';

/**
 * The other body plans: a pulsing bell, a curled little shrimp, a snail
 * under its shell. Proportions and colours still come from the genome; the
 * same rare traits show through (gold, glass, rainbow, two tails).
 */
export function drawForm(
  ctx: CanvasRenderingContext2D,
  c: Creature,
  x: number,
  y: number,
  heading: number,
  vis: CreatureVisual,
  o: DrawOpts,
  col: Colors,
  r: number,
  dyingP: number,
): void {
  const tiny = r * o.scale < 3.2 || o.detail < 0;
  ctx.save();
  ctx.globalAlpha = col.alpha;
  ctx.translate(x, y);
  if (c.ph.morph === 'jelly') drawJelly(ctx, c, vis, o, col, r, tiny, dyingP);
  else if (c.ph.morph === 'shrimp') drawShrimp(ctx, c, heading, vis, o, col, r, tiny, dyingP);
  else drawSnail(ctx, c, heading, vis, o, col, r, tiny, dyingP);
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** A body gradient, or the rainbow when the rare allele shows. */
function bodyFill(ctx: CanvasRenderingContext2D, c: Creature, col: Colors, x0: number, y0: number, x1: number, y1: number, vt: number): CanvasGradient {
  const gr = ctx.createLinearGradient(x0, y0, x1, y1);
  if (c.ph.rare.rainbow) {
    for (let i = 0; i <= 5; i++) gr.addColorStop(i / 5, hsl(c.ph.hue + i * 0.16 + vt * 0.02, 0.65, 0.66));
  } else {
    gr.addColorStop(0, col.bodyLight);
    gr.addColorStop(0.55, col.body);
    gr.addColorStop(1, col.bodyDark);
  }
  return gr;
}

/** Two small eyes; closed while asleep or blinking. */
function eyes(ctx: CanvasRenderingContext2D, c: Creature, vis: CreatureVisual, o: DrawOpts, pts: [number, number][], er: number, dyingP: number): void {
  const closed = dyingP > 0 || vis.blink > 0 || (c.state === 'rest' && (c.stateTime > 5 || o.night > 0.5));
  for (const [ex, ey] of pts) {
    if (closed) {
      ctx.strokeStyle = 'rgba(20, 35, 44, 0.8)';
      ctx.lineWidth = Math.max(0.5, er * 0.45);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(ex, ey - er * 0.2, er * 0.8, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = '#13232c';
    ctx.beginPath();
    ctx.arc(ex, ey, er, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ex - er * 0.3, ey - er * 0.35, Math.max(0.3, er * 0.38), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawJelly(ctx: CanvasRenderingContext2D, c: Creature, vis: CreatureVisual, o: DrawOpts, col: Colors, r: number, tiny: boolean, dyingP: number): void {
  const ph = c.ph;
  // the bell contracts in step with the pulses that move it
  const k = 0.5 + 0.5 * Math.sin(c.swim * 0.9);
  const w = r * (1.2 - 0.2 * k);
  const h = r * (0.82 + 0.22 * k);
  ctx.rotate(clamp((c.vx / Math.max(10, ph.maxSpeed)) * 0.35, -0.35, 0.35));
  if (tiny) {
    ctx.fillStyle = col.body;
    ctx.beginPath();
    ctx.ellipse(0, 0, w, h, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    return;
  }
  const alpha = col.alpha;
  // threads hang from the rim and trail behind the motion
  const n = Math.min(14, ph.tentacleCount);
  const len = r * (1.5 + 0.9 * ph.tentacleLen) * (1 - 0.35 * dyingP);
  ctx.strokeStyle = col.accentLight;
  ctx.lineWidth = Math.max(0.35, r * 0.05);
  ctx.lineCap = 'round';
  ctx.globalAlpha = alpha * 0.65;
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    const sx = -w * 0.85 + f * w * 1.7;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    for (let j = 1; j <= 7; j++) {
      const t = j / 7;
      const wave = Math.sin(o.vt * 2.1 - t * 4.2 + i * 1.7 + c.id) * r * 0.22 * t;
      const trail = -c.vx * 0.014 * len * t * t;
      ctx.lineTo(sx + wave + trail + (f - 0.5) * t * r * 0.35, t * len * (0.82 + 0.18 * k) - c.vy * 0.01 * len * t * t);
    }
    ctx.stroke();
  }
  // frilled oral arms in the middle
  ctx.strokeStyle = col.accent;
  ctx.lineWidth = Math.max(0.6, r * 0.13);
  ctx.globalAlpha = alpha * 0.55;
  for (let i = -1; i <= 1; i += 2) {
    ctx.beginPath();
    ctx.moveTo(i * w * 0.15, h * 0.05);
    for (let j = 1; j <= 5; j++) {
      const t = j / 5;
      ctx.lineTo(i * w * 0.15 + Math.sin(o.vt * 1.6 + t * 5 + i) * r * 0.18 - c.vx * 0.008 * len * t, t * len * 0.55);
    }
    ctx.stroke();
  }
  // the bell: domed, translucent, scalloped at the rim
  ctx.globalAlpha = alpha * (ph.rare.translucent ? 0.55 : 0.82);
  ctx.fillStyle = bodyFill(ctx, c, col, 0, -h, 0, h * 0.2, o.vt);
  ctx.beginPath();
  ctx.moveTo(-w, h * 0.08);
  ctx.bezierCurveTo(-w * 1.02, -h * 1.15, w * 1.02, -h * 1.15, w, h * 0.08);
  const scallops = 7;
  for (let s = 0; s < scallops; s++) {
    const x0 = w - (s / scallops) * w * 2;
    const x1 = w - ((s + 1) / scallops) * w * 2;
    ctx.quadraticCurveTo((x0 + x1) / 2, h * 0.22, x1, h * 0.08);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = col.accentLight;
  ctx.globalAlpha = alpha * 0.45;
  ctx.lineWidth = Math.max(0.5, r * 0.05);
  ctx.stroke();
  // four soft petals inside the bell
  ctx.fillStyle = col.accent;
  ctx.globalAlpha = alpha * 0.45;
  for (let q = 0; q < 4; q++) {
    const a = (q / 4) * Math.PI * 2 + Math.PI / 4;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * w * 0.3, -h * 0.5 + Math.sin(a) * h * 0.18, r * 0.17, r * 0.11, a, 0, Math.PI * 2);
    ctx.fill();
  }
  if (ph.rare.golden) {
    ctx.fillStyle = 'rgba(255, 236, 170, 0.6)';
    for (let i = 0; i < 3; i++) {
      const t = o.vt * 0.7 + i * 2.1 + c.id;
      ctx.beginPath();
      ctx.arc(Math.sin(t) * w * 0.5, -h * (0.4 + 0.25 * Math.cos(t * 1.3)), Math.max(0.4, r * 0.06), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  drawSprite(ctx, whiteSprite(), -w * 0.35, -h * 0.72, r * 0.65, 0.3 * alpha);
  ctx.globalAlpha = alpha;
  // a small sleepy face on the bell
  const er = Math.max(0.45, r * 0.085 * ph.eyeSize);
  eyes(ctx, c, vis, o, [
    [-w * 0.26, -h * 0.2],
    [w * 0.26, -h * 0.2],
  ], er, dyingP);
  ctx.fillStyle = 'rgba(255, 150, 170, 0.3)';
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(sx * w * 0.45, -h * 0.07, er * 1.4, er * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawShrimp(
  ctx: CanvasRenderingContext2D,
  c: Creature,
  heading: number,
  vis: CreatureVisual,
  o: DrawOpts,
  col: Colors,
  r: number,
  tiny: boolean,
  dyingP: number,
): void {
  const ph = c.ph;
  // a shrimp keeps level, tipping only a little as it climbs or dives
  const facing = Math.cos(heading) >= 0 ? 0 : Math.PI;
  ctx.rotate(facing + clamp(angleDiff(facing, heading), -0.45, 0.45));
  if (facing !== 0) ctx.scale(1, -1);
  const L = r * 2.5 * (0.85 + 0.15 * ph.elong);
  if (tiny) {
    ctx.fillStyle = col.body;
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.5, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const speedFrac = clamp(Math.hypot(c.vx, c.vy) / Math.max(1, ph.maxSpeed), 0, 1.2);
  // a curl along the back; a flick of the tail when it darts
  const bend = 0.22 + 0.14 * Math.sin(c.swim * 0.7) * speedFrac + (c.state === 'flee' ? 0.25 : 0);
  const at = (t: number) => ({ x: -L * 0.5 + t * L * 0.9, y: ((t - 0.5) * (t - 0.5) - 0.12) * L * 0.55 * bend });
  // antennae, long and wavering, behind everything
  ctx.strokeStyle = col.accentLight;
  ctx.lineWidth = Math.max(0.3, r * 0.04);
  ctx.lineCap = 'round';
  const head = at(1);
  for (const side of [-1, 1]) {
    const sway = Math.sin(o.vt * 1.7 + c.id + side) * r * 0.5;
    ctx.beginPath();
    ctx.moveTo(head.x, head.y - r * 0.15);
    ctx.quadraticCurveTo(head.x + r * 1.6, head.y - r * (0.9 + 0.3 * side) + sway, head.x + r * (2.6 + 0.4 * ph.antennaLen), head.y + r * (0.2 * side) + sway * 1.4);
    ctx.stroke();
  }
  // tail fan (two when the rare allele shows)
  const tail = at(0);
  ctx.fillStyle = col.accent;
  const fans = ph.rare.twinTail ? [-0.45, 0.45] : [0];
  for (const off of fans) {
    for (const lobe of [-0.5, 0, 0.5]) {
      const a = Math.PI + off + lobe * 0.7 + Math.sin(c.swim * 0.7) * 0.15;
      ctx.beginPath();
      ctx.ellipse(tail.x + Math.cos(a) * r * 0.45, tail.y + Math.sin(a) * r * 0.45, r * 0.5 * (0.6 + 0.3 * ph.tailLen), r * 0.2, a, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // little legs, paddling
  ctx.strokeStyle = col.bodyDark;
  ctx.lineWidth = Math.max(0.3, r * 0.06);
  for (let i = 0; i < 5; i++) {
    const p = at(0.35 + i * 0.12);
    const kick = Math.sin(c.swim * 1.8 + i * 0.9) * r * 0.18;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y + r * 0.25);
    ctx.lineTo(p.x - r * 0.1 + kick, p.y + r * 0.62);
    ctx.stroke();
  }
  // the body: shell segments from tail to head, each overlapping the last
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const t = i / (segs - 1);
    const p = at(t);
    const q = at(Math.min(1, t + 0.05));
    const ang = Math.atan2(q.y - p.y, q.x - p.x);
    const size = r * (0.26 + 0.3 * Math.sin(Math.min(1, t * 1.05) * Math.PI * 0.85));
    ctx.fillStyle = bodyFill(ctx, c, col, p.x, p.y - size, p.x, p.y + size, o.vt);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, size * (i === segs - 1 ? 1.25 : 0.8), size, ang, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(40, 18, 20, 0.22)';
    ctx.lineWidth = Math.max(0.4, r * 0.04);
    ctx.stroke();
  }
  // a little spike over the nose
  ctx.fillStyle = col.bodyDark;
  ctx.beginPath();
  ctx.moveTo(head.x + r * 0.25, head.y - r * 0.3);
  ctx.lineTo(head.x + r * 0.95, head.y - r * 0.42);
  ctx.lineTo(head.x + r * 0.3, head.y - r * 0.12);
  ctx.closePath();
  ctx.fill();
  if (ph.rare.golden) drawSprite(ctx, whiteSprite(), head.x - r * 0.2, head.y - r * 0.35, r * 0.5, 0.35 * col.alpha);
  drawSprite(ctx, whiteSprite(), head.x - r * 0.4, head.y - r * 0.35, r * 0.45, 0.25 * col.alpha);
  ctx.globalAlpha = col.alpha;
  // a stalked eye
  const er = Math.max(0.45, r * 0.13 * ph.eyeSize);
  ctx.strokeStyle = col.bodyDark;
  ctx.lineWidth = Math.max(0.35, r * 0.07);
  ctx.beginPath();
  ctx.moveTo(head.x + r * 0.1, head.y - r * 0.2);
  ctx.lineTo(head.x + r * 0.35, head.y - r * 0.55);
  ctx.stroke();
  eyes(ctx, c, vis, o, [[head.x + r * 0.38, head.y - r * 0.6]], er, dyingP);
}

function drawSnail(
  ctx: CanvasRenderingContext2D,
  c: Creature,
  heading: number,
  vis: CreatureVisual,
  o: DrawOpts,
  col: Colors,
  r: number,
  tiny: boolean,
  dyingP: number,
): void {
  const ph = c.ph;
  if (Math.cos(heading) < 0) ctx.scale(-1, 1);
  const shellR = r * 0.95;
  const sx = -r * 0.2;
  const sy = -r * 0.62;
  if (tiny) {
    ctx.fillStyle = col.body;
    ctx.beginPath();
    ctx.arc(sx, sy, shellR, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const moving = clamp(Math.abs(c.vx) / Math.max(1, ph.maxSpeed), 0, 1);
  const asleep = dyingP > 0 || (c.state === 'rest' && (c.stateTime > 5 || o.night > 0.5));
  const out = asleep ? 0.35 : 1;
  // the foot, rippling as it creeps
  const foot = hsl(ph.accentHue, ph.sat * 0.35, Math.min(0.85, ph.light + 0.12));
  ctx.fillStyle = foot;
  ctx.beginPath();
  ctx.moveTo(-r * 1.35, r * 0.42);
  const bumps = 5;
  for (let i = 0; i <= bumps; i++) {
    const t = i / bumps;
    const px = -r * 1.35 + t * r * (1.35 + 1.25 * out);
    const ripple = Math.sin(t * 9 - c.swim * 2.5) * r * 0.05 * moving;
    ctx.lineTo(px, r * 0.42 + ripple);
  }
  ctx.quadraticCurveTo(r * (0.05 + 1.35 * out), r * 0.05, r * (-0.1 + 0.9 * out), -r * 0.2);
  ctx.quadraticCurveTo(-r * 0.4, -r * 0.05, -r * 1.35, r * 0.42);
  ctx.closePath();
  ctx.fill();
  // eye stalks
  const stalk = r * (0.55 + 0.4 * ph.eyeSize) * out;
  const hx = r * (-0.05 + 0.95 * out);
  const hy = -r * 0.05;
  ctx.strokeStyle = foot;
  ctx.lineWidth = Math.max(0.5, r * 0.11);
  ctx.lineCap = 'round';
  const tips: [number, number][] = [];
  for (const k of [0, 1]) {
    const sway = Math.sin(o.vt * 1.3 + c.id + k * 1.7) * r * 0.1;
    const tx = hx + r * (0.18 + k * 0.28) + sway;
    const ty = hy - stalk * (1 - k * 0.12);
    ctx.beginPath();
    ctx.moveTo(hx + k * r * 0.1, hy);
    ctx.quadraticCurveTo(hx + r * 0.1 + k * r * 0.15, hy - stalk * 0.6, tx, ty);
    ctx.stroke();
    tips.push([tx, ty]);
  }
  // the shell, coiled
  const gr = ctx.createRadialGradient(sx - shellR * 0.35, sy - shellR * 0.4, shellR * 0.1, sx, sy, shellR);
  if (ph.rare.rainbow) {
    for (let i = 0; i <= 5; i++) gr.addColorStop(i / 5, hsl(ph.hue + i * 0.16 + o.vt * 0.02, 0.65, 0.66));
  } else {
    gr.addColorStop(0, col.bodyLight);
    gr.addColorStop(0.6, col.body);
    gr.addColorStop(1, col.bodyDark);
  }
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.arc(sx, sy, shellR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40, 24, 16, 0.35)';
  ctx.lineWidth = Math.max(0.5, r * 0.07);
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const a = t * Math.PI * 5.2;
    const rr = shellR * 0.9 * (1 - t * 0.9);
    const px = sx + Math.cos(a) * rr;
    const py = sy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  // bands of the accent colour along the coil
  ctx.strokeStyle = col.accent;
  ctx.globalAlpha = col.alpha * 0.5;
  ctx.lineWidth = Math.max(0.5, r * 0.12);
  ctx.beginPath();
  ctx.arc(sx, sy, shellR * 0.62, Math.PI * 0.9, Math.PI * 1.9);
  ctx.stroke();
  ctx.globalAlpha = col.alpha;
  if (ph.rare.golden) drawSprite(ctx, whiteSprite(), sx + shellR * 0.2, sy - shellR * 0.2, shellR * 0.6, 0.4 * col.alpha);
  drawSprite(ctx, whiteSprite(), sx - shellR * 0.35, sy - shellR * 0.45, shellR * 0.55, 0.32 * col.alpha);
  ctx.globalAlpha = col.alpha;
  if (out > 0.5) eyes(ctx, c, vis, o, tips, Math.max(0.45, r * 0.11 * ph.eyeSize), dyingP);
}
