import { clamp } from '../sim/core/math';
import type { Creature } from '../sim/entities/creature';
import { hsl } from './color';
import { drawForm } from './formsRenderer';
import { drawSprite, glowSprite, whiteSprite } from './sprites';

const SEGMENTS = 5;

/** Render-only state per creature: tentacle chains, blinking, etc. */
export interface CreatureVisual {
  id: number;
  tent: Float32Array;
  tentCount: number;
  ready: boolean;
  blinkT: number;
  blink: number;
  seen: number;
  prevSpeed: number;
  stretch: number;
  motes: number;
}

export function createVisual(c: Creature): CreatureVisual {
  const n = Math.max(0, c.ph.tentacleCount);
  return {
    id: c.id,
    tent: new Float32Array(Math.max(1, n) * (SEGMENTS + 1) * 2),
    tentCount: n,
    ready: false,
    blinkT: 1 + ((c.id * 0.618) % 1) * 5,
    blink: 0,
    seen: 0,
    prevSpeed: 0,
    stretch: 0,
    motes: 0,
  };
}

export interface DrawOpts {
  vt: number;
  dt: number;
  night: number;
  dyingTime: number;
  scale: number;
  detail: number;
}

export interface Colors {
  body: string;
  bodyDark: string;
  bodyLight: string;
  accent: string;
  accentLight: string;
  alpha: number;
}

function colorsFor(c: Creature, dyingP: number, night: number): Colors {
  const ph = c.ph;
  let h = ph.hue;
  let s = ph.sat;
  let l = ph.light;
  if (ph.rare.golden) {
    h = 0.12;
    s = 0.78;
    l = 0.6;
  }
  const ah = ph.accentHue;
  l *= 1 - 0.28 * night;
  s *= 1 - 0.7 * dyingP;
  l = l + (0.88 - l) * dyingP * 0.6;
  let alpha = 1 - dyingP;
  if (ph.rare.translucent) alpha *= 0.55;
  return {
    body: hsl(h, s, l),
    bodyDark: hsl(h, s * 1.05, l - 0.16),
    bodyLight: hsl(h, s * 0.8, Math.min(0.93, l + 0.17)),
    accent: hsl(ah, s * 1.1, l - 0.05, 0.9),
    accentLight: hsl(ah, s, Math.min(0.92, l + 0.15), 0.9),
    alpha,
  };
}

/**
 * Draw one creature at (x, y) facing `heading`. The body is a soft blob
 * whose proportions come straight from the genome; animation reads the
 * creature's behavior state.
 */
export function drawCreature(
  ctx: CanvasRenderingContext2D,
  c: Creature,
  x: number,
  y: number,
  heading: number,
  vis: CreatureVisual,
  o: DrawOpts,
): void {
  const ph = c.ph;
  const g = c.growth;
  const r = ph.radius * g;
  const dyingP = c.dying > 0 ? clamp(c.dying / o.dyingTime, 0, 1) : 0;
  const speed = Math.hypot(c.vx, c.vy);
  const speedFrac = clamp(speed / Math.max(1, ph.maxSpeed), 0, 1.3);
  const pred = ph.diet > 0.6;
  const col = colorsFor(c, dyingP, o.night);
  if (col.alpha <= 0.01) return;

  // squash & stretch from acceleration, breathing at rest
  const accel = (speed - vis.prevSpeed) / Math.max(0.001, o.dt);
  vis.prevSpeed = speed;
  vis.stretch += (clamp(accel / 120, -0.6, 1) * 0.08 - vis.stretch) * Math.min(1, o.dt * 6);
  const breathe = c.state === 'rest' ? Math.sin(o.vt * 1.7 + c.id) * 0.035 : 0;
  const a = r * (0.75 + 0.42 * ph.elong) * (1 + 0.05 * speedFrac + vis.stretch);
  const b = r * (1.05 - 0.18 * (ph.elong - 0.8)) * (1 - 0.03 * speedFrac - vis.stretch * 0.5 + breathe);

  // blinking
  vis.blinkT -= o.dt;
  if (vis.blinkT <= 0) {
    vis.blink = 0.14;
    vis.blinkT = 2 + ((c.id * 0.37 + o.vt * 0.13) % 1) * 5;
  }
  if (vis.blink > 0) vis.blink -= o.dt;

  const screenR = r * o.scale;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const flip = cos < 0 ? -1 : 1;

  // bioluminescent halo (behind)
  const glowAmt =
    (c.glowT > 0 ? Math.min(1, c.glowT / 10) * 0.6 : 0) +
    (ph.rare.fluorescent ? 0.25 + 0.45 * o.night : 0) +
    (pred ? 0.1 * o.night : 0);
  if (glowAmt > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawSprite(ctx, glowSprite(ph.rare.golden ? 0.13 : ph.accentHue, 0.85, 0.65), x, y, r * 3.4, glowAmt * col.alpha * 0.55);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  if (ph.morph !== 'fish') {
    drawForm(ctx, c, x, y, heading, vis, o, col, r, dyingP);
    return;
  }

  if (screenR < 3.2 || o.detail < 0) {
    // distant / tiny: simple silhouette
    ctx.globalAlpha = col.alpha;
    ctx.fillStyle = col.body;
    ctx.beginPath();
    ctx.ellipse(x, y, a, b, heading, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = col.accent;
    ctx.beginPath();
    ctx.moveTo(x - cos * a * 0.9, y - sin * a * 0.9);
    ctx.lineTo(x - cos * a * 1.6 - sin * b * 0.5, y - sin * a * 1.6 + cos * b * 0.5);
    ctx.lineTo(x - cos * a * 1.6 + sin * b * 0.5, y - sin * a * 1.6 - cos * b * 0.5);
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }

  // tentacles live in world space (they trail behind with inertia)
  if (vis.tentCount > 0 && o.detail > 0) updateTentacles(c, vis, x, y, cos, sin, flip, a, b, r, o);

  ctx.save();
  ctx.globalAlpha = col.alpha;
  if (vis.tentCount > 0 && o.detail > 0) drawTentacles(ctx, c, vis, r, col, o);

  ctx.translate(x, y);
  ctx.rotate(heading);
  if (flip < 0) ctx.scale(1, -1);

  if (pred) drawPredatorFins(ctx, c, a, b, r, col, o);
  drawTail(ctx, c, a, b, r, col, speedFrac, o);
  if (!pred) drawDorsal(ctx, c, a, b, col);

  // body
  ctx.beginPath();
  bodyPath(ctx, a, b, c.swim, speedFrac);
  if (ph.rare.rainbow) {
    const gr = ctx.createLinearGradient(-a, 0, a, 0);
    for (let i = 0; i <= 5; i++) gr.addColorStop(i / 5, hsl(ph.hue + i * 0.16 + o.vt * 0.02, 0.65, 0.66));
    ctx.fillStyle = gr;
  } else {
    const gr = ctx.createLinearGradient(0, -b, 0, b);
    gr.addColorStop(0, col.bodyDark);
    gr.addColorStop(0.45, col.body);
    gr.addColorStop(1, col.bodyLight);
    ctx.fillStyle = gr;
  }
  ctx.fill();
  ctx.lineWidth = Math.max(0.6, r * 0.06);
  ctx.strokeStyle = 'rgba(8, 24, 30, 0.22)';
  ctx.stroke();

  // belly glow
  ctx.fillStyle = col.bodyLight;
  ctx.globalAlpha = col.alpha * 0.45;
  ctx.beginPath();
  ctx.ellipse(a * 0.08, b * 0.32, a * 0.66, b * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = col.alpha;

  if (ph.rare.translucent) {
    // a visible little heart-core
    ctx.fillStyle = hsl(ph.accentHue, 0.6, 0.7, 0.75);
    ctx.beginPath();
    ctx.arc(-a * 0.05, b * 0.05, r * 0.28 * (1 + 0.08 * Math.sin(o.vt * 3 + c.id)), 0, Math.PI * 2);
    ctx.fill();
  }
  if (ph.rare.fluorescent) drawFluorescent(ctx, c, a, b, o);
  if (ph.rare.golden) drawGoldenGlints(ctx, c, a, b, r, o);
  if (pred) {
    // soft markings along the back
    ctx.fillStyle = hsl(ph.accentHue, 0.5, 0.6, 0.35);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(-a * 0.35 + i * a * 0.3, -b * 0.42, r * 0.13, r * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // specular highlight
  drawSprite(ctx, whiteSprite(), a * 0.28, -b * 0.45, r * 0.55, 0.28 * col.alpha);
  ctx.globalAlpha = col.alpha;

  drawPectoral(ctx, c, a, b, r, col);
  drawFace(ctx, c, a, b, r, vis, heading, flip, dyingP, pred, o);
  if (pred) drawLure(ctx, c, a, b, r, o, col.alpha);
  else if (ph.antennaLen > 0.35) drawAntenna(ctx, c, a, b, r, o, col);

  ctx.restore();
  ctx.globalAlpha = 1;
}

function bodyPath(ctx: CanvasRenderingContext2D, a: number, b: number, swim: number, speedFrac: number): void {
  const N = 12;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let k = 0; k < N; k++) {
    const t = (k / N) * Math.PI * 2;
    const ct = Math.cos(t);
    let px = ct * a;
    let py = Math.sin(t) * b;
    if (ct < 0) py *= 1 - 0.24 * -ct; // taper to the tail
    else px *= 1 + 0.04 * ct; // round head
    py += Math.sin(swim - ct * 2) * 0.035 * b * speedFrac;
    xs.push(px);
    ys.push(py);
  }
  const mx = (xs[N - 1] + xs[0]) / 2;
  const my = (ys[N - 1] + ys[0]) / 2;
  ctx.moveTo(mx, my);
  for (let k = 0; k < N; k++) {
    const n = (k + 1) % N;
    ctx.quadraticCurveTo(xs[k], ys[k], (xs[k] + xs[n]) / 2, (ys[k] + ys[n]) / 2);
  }
  ctx.closePath();
}

function drawTail(
  ctx: CanvasRenderingContext2D,
  c: Creature,
  a: number,
  b: number,
  r: number,
  col: Colors,
  speedFrac: number,
  o: DrawOpts,
): void {
  const ph = c.ph;
  const len = r * ph.tailLen * (ph.diet > 0.6 ? 1.3 : 1);
  const wag = Math.sin(c.swim) * (0.28 + 0.3 * Math.min(1, speedFrac)) + (c.state === 'rest' ? Math.sin(o.vt * 0.8 + c.id) * 0.1 : 0);
  const tails = ph.rare.twinTail ? [-0.32, 0.32] : [0];
  ctx.fillStyle = col.accent;
  for (const off of tails) {
    const ang = Math.PI + wag + off;
    const rootX = -a * 0.86;
    const tipX = rootX + Math.cos(ang) * len;
    const tipY = Math.sin(ang) * len;
    const px = -Math.sin(ang);
    const py = Math.cos(ang);
    const spread = len * 0.42;
    ctx.beginPath();
    ctx.moveTo(rootX + a * 0.06, -b * 0.24);
    ctx.quadraticCurveTo(rootX + Math.cos(ang) * len * 0.5 + px * spread * 0.4, Math.sin(ang) * len * 0.5 + py * spread * 0.4, tipX + px * spread, tipY + py * spread);
    ctx.quadraticCurveTo(tipX - Math.cos(ang) * len * 0.22, tipY - Math.sin(ang) * len * 0.22, tipX - px * spread, tipY - py * spread);
    ctx.quadraticCurveTo(rootX + Math.cos(ang) * len * 0.5 - px * spread * 0.4, Math.sin(ang) * len * 0.5 - py * spread * 0.4, rootX + a * 0.06, b * 0.24);
    ctx.closePath();
    ctx.fill();
    // fin ray
    ctx.strokeStyle = col.accentLight;
    ctx.lineWidth = Math.max(0.5, r * 0.05);
    ctx.beginPath();
    ctx.moveTo(rootX, 0);
    ctx.lineTo(tipX - Math.cos(ang) * len * 0.15, tipY - Math.sin(ang) * len * 0.15);
    ctx.stroke();
  }
}

function drawDorsal(ctx: CanvasRenderingContext2D, c: Creature, a: number, b: number, col: Colors): void {
  const fin = c.ph.finSize;
  if (fin < 0.45) return;
  const h = b * (0.25 + 0.4 * fin);
  const flap = Math.sin(c.swim * 0.8) * 0.08;
  ctx.fillStyle = col.accent;
  ctx.beginPath();
  ctx.moveTo(-a * 0.35, -b * 0.82);
  ctx.quadraticCurveTo(-a * 0.2, -b * 0.9 - h * (1.4 + flap), a * 0.15, -b * 0.88);
  ctx.closePath();
  ctx.fill();
}

function drawPectoral(ctx: CanvasRenderingContext2D, c: Creature, a: number, b: number, r: number, col: Colors): void {
  const size = r * 0.42 * c.ph.finSize * (c.ph.diet > 0.6 ? 0.6 : 1);
  if (size < 0.8) return;
  const flap = 0.5 + Math.sin(c.swim * 1.3) * 0.45;
  ctx.save();
  ctx.translate(a * 0.02, b * 0.42);
  ctx.rotate(flap);
  ctx.fillStyle = col.accentLight;
  ctx.beginPath();
  ctx.ellipse(-size * 0.55, 0, size, size * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPredatorFins(ctx: CanvasRenderingContext2D, c: Creature, a: number, b: number, r: number, col: Colors, o: DrawOpts): void {
  const flap = Math.sin(c.swim * 0.55) * 0.3;
  const span = b * (1.1 + 0.7 * c.ph.finSize);
  ctx.fillStyle = col.accent;
  ctx.globalAlpha *= 0.75;
  for (const side of [-1, 1]) {
    const tip = span * (1 + side * flap);
    ctx.beginPath();
    ctx.moveTo(a * 0.25, side * b * 0.6);
    ctx.quadraticCurveTo(-a * 0.05, side * (b + tip), -a * 0.55, side * (b * 0.5 + tip * 0.85));
    ctx.quadraticCurveTo(-a * 0.35, side * b * 0.9, -a * 0.45, side * b * 0.3);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha /= 0.75;
  // ribbon tail
  ctx.strokeStyle = col.accentLight;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.8, r * 0.12);
  ctx.beginPath();
  const len = r * (2 + c.ph.tailLen);
  for (let i = 0; i <= 8; i++) {
    const f = i / 8;
    const px = -a * 0.9 - f * len;
    const py = Math.sin(c.swim * 0.9 - f * 4 + o.vt * 0.3) * r * 0.35 * f;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  c: Creature,
  a: number,
  b: number,
  r: number,
  vis: CreatureVisual,
  heading: number,
  flip: number,
  dyingP: number,
  pred: boolean,
  o: DrawOpts,
): void {
  const ph = c.ph;
  const neoteny = 1 + (1 - c.growth) * 0.9;
  let eyeR = Math.min(b * 0.56, r * (pred ? 0.22 : 0.34) * ph.eyeSize * neoteny);
  const ex = a * (pred ? 0.6 : 0.48);
  const ey = -b * (pred ? 0.12 : 0.2);
  const sleeping = dyingP > 0 || (c.state === 'rest' && (c.stateTime > 5 || o.night > 0.5));
  const happy = c.state === 'social' || c.state === 'court';
  const scared = c.state === 'flee';
  const closed = sleeping || vis.blink > 0;

  // blush for the young and the bright
  if (!pred && (c.stage === 'juvenile' || ph.sat > 0.62)) {
    ctx.fillStyle = 'rgba(255, 150, 170, 0.32)';
    ctx.beginPath();
    ctx.ellipse(ex - eyeR * 0.4, ey + eyeR * 1.45, eyeR * 0.65, eyeR * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const eyes: [number, number, number][] = [[ex, ey, eyeR]];
  if (ph.rare.eyeType === 2) {
    eyes.push([ex - eyeR * 1.5, ey - eyeR * 0.9, eyeR * 0.62]);
    eyes.push([ex + eyeR * 0.3, ey - eyeR * 1.6, eyeR * 0.55]);
  }
  if (scared) eyeR *= 1.12;

  // look direction in body space
  const cs = Math.cos(heading);
  const sn = Math.sin(heading);
  const lx = c.lookX * cs + c.lookY * sn;
  const ly = (-c.lookX * sn + c.lookY * cs) * flip;

  for (const [x0, y0, er0] of eyes) {
    const er = scared ? er0 * 1.12 : er0;
    if (closed || happy) {
      ctx.strokeStyle = 'rgba(20, 35, 44, 0.85)';
      ctx.lineWidth = Math.max(0.6, er * 0.32);
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (happy && !closed) ctx.arc(x0, y0 + er * 0.35, er * 0.7, Math.PI * 1.15, Math.PI * 1.85);
      else ctx.arc(x0, y0 - er * 0.1, er * 0.75, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = '#f5fbff';
    ctx.beginPath();
    ctx.arc(x0, y0, er, 0, Math.PI * 2);
    ctx.fill();
    const pr = er * (scared ? 0.42 : 0.6);
    const px = x0 + lx * er * 0.3;
    const py = y0 + ly * er * 0.3;
    const type = ph.rare.eyeType;
    if (type === 4) {
      ctx.fillStyle = hsl(ph.accentHue, 0.7, 0.55);
      ctx.beginPath();
      ctx.arc(px, py, pr * 1.18, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#13232c';
    if (type === 1) {
      starPath(ctx, px, py, pr * 1.1, pr * 0.45, 5, o.vt * 0.2);
      ctx.fill();
    } else if (type === 3) {
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f5fbff';
      ctx.beginPath();
      ctx.arc(px + pr * 0.45, py - pr * 0.1, pr * 0.85, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px - pr * 0.35, py - pr * 0.4, Math.max(0.35, pr * 0.32), 0, Math.PI * 2);
    ctx.fill();
  }

  // mouth
  const mx = a * 0.9;
  const my = b * 0.18;
  if (c.munch > 0) {
    const open = (0.5 + 0.5 * Math.sin(o.vt * 22)) * r * 0.13;
    ctx.fillStyle = 'rgba(40, 20, 30, 0.7)';
    ctx.beginPath();
    ctx.ellipse(mx - r * 0.05, my, r * 0.09, Math.max(0.3, open), 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (r > 5) {
    ctx.strokeStyle = 'rgba(25, 40, 48, 0.45)';
    ctx.lineWidth = Math.max(0.5, r * 0.05);
    ctx.beginPath();
    ctx.arc(mx - r * 0.12, my - r * 0.08, r * 0.1, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();
  }
}

function starPath(ctx: CanvasRenderingContext2D, x: number, y: number, r1: number, r2: number, n: number, rot: number): void {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i / (n * 2)) * Math.PI * 2;
    const rr = i % 2 === 0 ? r1 : r2;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawAntenna(ctx: CanvasRenderingContext2D, c: Creature, a: number, b: number, r: number, o: DrawOpts, col: Colors): void {
  const ant = c.ph.antennaLen;
  const sway = Math.sin(o.vt * 1.8 + c.id) * 0.12;
  const bx = a * 0.3;
  const by = -b * 0.85;
  const tx = a * (0.55 + 0.45 * ant) + sway * r;
  const ty = -b * (1.35 + 0.9 * ant);
  ctx.strokeStyle = col.accentLight;
  ctx.lineWidth = Math.max(0.45, r * 0.06);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.quadraticCurveTo(a * 0.3 + sway * r, ty * 1.05, tx, ty);
  ctx.stroke();
  ctx.fillStyle = col.accentLight;
  ctx.beginPath();
  ctx.arc(tx, ty, Math.max(0.6, r * 0.11), 0, Math.PI * 2);
  ctx.fill();
  if (o.night > 0.3) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawSprite(ctx, glowSprite(c.ph.accentHue, 0.8, 0.7), tx, ty, r * 0.9, 0.35 * o.night * col.alpha);
    ctx.restore();
  }
}

function drawLure(ctx: CanvasRenderingContext2D, c: Creature, a: number, b: number, r: number, o: DrawOpts, alpha: number): void {
  const sway = Math.sin(o.vt * 1.1 + c.id) * 0.1;
  const tx = a * (1.3 + sway);
  const ty = -b * 0.05 + Math.sin(o.vt * 1.6 + c.id) * r * 0.08;
  ctx.strokeStyle = hsl(c.ph.accentHue, 0.4, 0.65, 0.7);
  ctx.lineWidth = Math.max(0.6, r * 0.05);
  ctx.beginPath();
  ctx.moveTo(a * 0.55, -b * 0.75);
  ctx.quadraticCurveTo(a * 1.05, -b * 1.25, tx, ty);
  ctx.stroke();
  const pulse = 0.75 + 0.25 * Math.sin(o.vt * 2.2 + c.id);
  ctx.fillStyle = hsl(c.ph.accentHue, 0.85, 0.75);
  ctx.beginPath();
  ctx.arc(tx, ty, Math.max(0.8, r * 0.12), 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  drawSprite(ctx, glowSprite(c.ph.accentHue, 0.9, 0.7), tx, ty, r * 1.3 * pulse, (0.3 + 0.55 * o.night) * alpha);
  ctx.restore();
}

function drawFluorescent(ctx: CanvasRenderingContext2D, c: Creature, a: number, b: number, o: DrawOpts): void {
  const pulse = 0.55 + 0.45 * Math.sin(o.vt * 1.5 + c.id);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = hsl(c.ph.accentHue, 0.9, 0.7, 0.35 + 0.4 * pulse * (0.5 + 0.5 * o.night));
  ctx.lineWidth = Math.max(0.5, b * 0.1);
  ctx.lineCap = 'round';
  for (const fx of [-0.45, -0.1, 0.25]) {
    const half = b * 0.78 * Math.sqrt(Math.max(0, 1 - fx * fx));
    ctx.beginPath();
    ctx.moveTo(a * fx - b * 0.08, -half);
    ctx.quadraticCurveTo(a * fx + b * 0.12, 0, a * fx - b * 0.05, half);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGoldenGlints(ctx: CanvasRenderingContext2D, c: Creature, a: number, b: number, r: number, o: DrawOpts): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const t = o.vt * 0.9 + i * 2.1 + c.id;
    const tw = Math.max(0, Math.sin(t));
    if (tw < 0.2) continue;
    const gx = Math.sin(i * 2.3 + c.id) * a * 0.55;
    const gy = Math.cos(i * 1.7 + c.id) * b * 0.45;
    drawSprite(ctx, glowSprite(0.13, 0.9, 0.85), gx, gy, r * 0.45 * tw, 0.7 * tw);
  }
  ctx.restore();
}

function updateTentacles(
  c: Creature,
  vis: CreatureVisual,
  x: number,
  y: number,
  cos: number,
  sin: number,
  flip: number,
  a: number,
  b: number,
  r: number,
  o: DrawOpts,
): void {
  const n = vis.tentCount;
  const K = SEGMENTS;
  const total = r * (0.9 + 0.8 * c.ph.tentacleLen);
  const seg = total / K;
  // rest direction: backward and a little down in world space
  let rx = -cos * 0.75;
  let ry = -sin * 0.75 + 0.65;
  const rl = Math.hypot(rx, ry) || 1;
  rx /= rl;
  ry /= rl;
  const t = vis.tent;
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1);
    const lx = a * (0.15 - 0.75 * f);
    const ly = b * 0.72 * flip;
    const ax = x + lx * cos - ly * sin;
    const ay = y + lx * sin + ly * cos;
    const base = i * (K + 1) * 2;
    if (!vis.ready || Math.hypot(t[base] - ax, t[base + 1] - ay) > r * 6) {
      for (let j = 0; j <= K; j++) {
        t[base + j * 2] = ax + rx * seg * j;
        t[base + j * 2 + 1] = ay + ry * seg * j;
      }
    }
    t[base] = ax;
    t[base + 1] = ay;
    for (let j = 1; j <= K; j++) {
      const k = base + j * 2;
      t[k] += rx * 14 * o.dt;
      t[k + 1] += ry * 14 * o.dt;
      const dx = t[k] - t[k - 2];
      const dy = t[k + 1] - t[k - 1];
      const d = Math.hypot(dx, dy) || 1;
      t[k] = t[k - 2] + (dx / d) * seg;
      t[k + 1] = t[k - 1] + (dy / d) * seg;
    }
  }
  vis.ready = true;
}

function drawTentacles(ctx: CanvasRenderingContext2D, c: Creature, vis: CreatureVisual, r: number, col: Colors, o: DrawOpts): void {
  const K = SEGMENTS;
  const t = vis.tent;
  ctx.strokeStyle = col.accent;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(0.5, r * 0.13);
  for (let i = 0; i < vis.tentCount; i++) {
    const base = i * (K + 1) * 2;
    ctx.beginPath();
    ctx.moveTo(t[base], t[base + 1]);
    for (let j = 1; j <= K; j++) {
      const k = base + j * 2;
      const wave = Math.sin(o.vt * 2.4 + j * 0.9 + i * 1.7 + c.id) * (j / K) * r * 0.16;
      const dx = t[k] - t[k - 2];
      const dy = t[k + 1] - t[k - 1];
      const d = Math.hypot(dx, dy) || 1;
      const px = t[k] - (dy / d) * wave;
      const py = t[k + 1] + (dx / d) * wave;
      if (j < K) {
        const nx = (px + t[k + 2]) / 2;
        const ny = (py + t[k + 3]) / 2;
        ctx.quadraticCurveTo(px, py, nx, ny);
      } else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // tip
    const tip = base + K * 2;
    ctx.fillStyle = col.accentLight;
    ctx.beginPath();
    ctx.arc(t[tip], t[tip + 1], Math.max(0.4, r * 0.08), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A floating, softly pulsing egg with a tiny embryo inside. */
export function drawEgg(ctx: CanvasRenderingContext2D, c: Creature, x: number, y: number, vt: number, hatchTime: number): void {
  const progress = 1 - clamp(c.eggTimer / hatchTime, 0, 1);
  const r = c.ph.radius * 0.5 + 1.5;
  const pulse = 1 + Math.sin(vt * 3 + c.id) * 0.05;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  drawSprite(ctx, glowSprite(c.ph.hue, 0.6, 0.7), x, y, r * 3.2, 0.18 + 0.1 * Math.sin(vt * 2 + c.id));
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.fillStyle = hsl(c.ph.hue, 0.45, 0.78, 0.32);
  ctx.strokeStyle = hsl(c.ph.hue, 0.5, 0.85, 0.55);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(x, y, r * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // embryo grows and wiggles
  const er = r * (0.25 + 0.35 * progress);
  const wig = Math.sin(vt * (4 + progress * 6) + c.id) * r * 0.12 * progress;
  ctx.fillStyle = hsl(c.ph.hue, 0.55, 0.55, 0.85);
  ctx.beginPath();
  ctx.ellipse(x + wig, y + r * 0.1, er * 1.2, er, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#13232c';
  ctx.beginPath();
  ctx.arc(x + wig + er * 0.5, y, Math.max(0.4, er * 0.28), 0, Math.PI * 2);
  ctx.fill();
  drawSprite(ctx, whiteSprite(), x - r * 0.35, y - r * 0.4, r * 0.5, 0.45);
  ctx.globalAlpha = 1;
}
