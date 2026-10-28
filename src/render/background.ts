import { Rng } from '../sim/core/rng';
import { clamp01, fbm1D, smoothstep } from '../sim/core/math';
import { floorFormula } from '../sim/terrain';
import type { World } from '../sim/world';
import type { Camera } from './camera';
import type { TerrainRenderer } from './terrainRenderer';
import { mixRgb, rgb, WATER_DAY, WATER_DUSK, WATER_NIGHT, WATER_STORM, hexToRgb, type RGB } from './color';
import { makeCanvas } from './sprites';

interface Ray {
  x: number;
  width: number;
  slant: number;
  phase: number;
  speed: number;
}

const COLD: RGB = hexToRgb('#1f4f78');
const WARM: RGB = hexToRgb('#4f7a52');

/** Screen-space water: gradient, distant silhouettes, light shafts, caustics, vignette. */
export class Background {
  private far: HTMLCanvasElement | null = null;
  private backdrop: HTMLCanvasElement | null = null;
  private backdropAt = -1;
  private vignette: HTMLCanvasElement | null = null;
  private causticTile: HTMLCanvasElement;
  private causticLayer: HTMLCanvasElement;
  private causticPattern: CanvasPattern | null = null;
  private causticFrame = 0;
  private rays: Ray[] = [];
  private farKey = '';
  colors: RGB[] = WATER_DAY.map((c) => [...c] as RGB);

  constructor(seed: string) {
    const rng = new Rng('bg:' + seed);
    for (let i = 0; i < 6; i++) {
      this.rays.push({
        x: rng.range(0.05, 0.95),
        width: rng.range(0.04, 0.11),
        slant: rng.range(0.12, 0.28),
        phase: rng.range(0, Math.PI * 2),
        speed: rng.range(0.012, 0.03),
      });
    }
    this.causticTile = buildCausticTile(rng);
    this.causticLayer = makeCanvas(2, 2);
  }

  /** Water colors for the current light, weather and temperature. */
  updateColors(world: World): void {
    const env = world.env;
    const d = env.daylight;
    const dusk = smoothstep(0.05, 0.45, d) * (1 - smoothstep(0.55, 0.95, d));
    const storm = clamp01(env.turbulence * 1.2);
    const lightK = clamp01(0.55 + 0.45 * Math.min(1.3, env.lightSet) / 1.3);
    const t = env.temperature;
    for (let i = 0; i < this.colors.length; i++) {
      let c = mixRgb(WATER_NIGHT[i], WATER_DAY[i], d * lightK);
      c = mixRgb(c, WATER_DUSK[i], dusk * 0.45);
      c = mixRgb(c, WATER_STORM[i], storm * 0.55);
      if (t < 0.4) c = mixRgb(c, COLD, (0.4 - t) * 0.35);
      if (t > 0.6) c = mixRgb(c, WARM, (t - 0.6) * 0.3);
      this.colors[i] = c;
    }
  }

  /**
   * Water, distant haze and the floor. In the overview camera these are
   * composited into one cached layer refreshed about once a second (colors
   * drift slowly), so a frame pays for a single blit instead of many fills.
   */
  drawBackdrop(ctx: CanvasRenderingContext2D, cam: Camera, world: World, vt: number, terrain: TerrainRenderer): void {
    if (this.isOverview(cam)) {
      const w = Math.ceil(cam.cssW * cam.dpr);
      const h = Math.ceil(cam.cssH * cam.dpr);
      const stale = !this.backdrop || this.backdrop.width !== w || this.backdrop.height !== h || vt - this.backdropAt > 0.5 || vt < this.backdropAt;
      if (stale) {
        if (!this.backdrop || this.backdrop.width !== w || this.backdrop.height !== h) this.backdrop = makeCanvas(w, h);
        const g = this.backdrop.getContext('2d', { alpha: false })!;
        g.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
        this.paintWater(g, cam, world);
        g.save();
        cam.apply(g);
        terrain.paint(g, cam, world);
        g.restore();
        this.drawRays(g, cam, world, vt);
        this.drawVignette(g, cam);
        this.backdropAt = vt;
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.backdrop!, 0, 0);
      ctx.restore();
    } else {
      this.paintWater(ctx, cam, world);
      ctx.save();
      cam.apply(ctx);
      terrain.paint(ctx, cam, world);
      ctx.restore();
      this.drawRays(ctx, cam, world, vt);
    }
  }

  /** In the overview the vignette is baked into the backdrop; zoomed views draw it on top. */
  isOverview(cam: Camera): boolean {
    return Math.abs(cam.zoom - 1) < 0.01;
  }

  private paintWater(ctx: CanvasRenderingContext2D, cam: Camera, world: World): void {
    const top = cam.worldToScreen(0, 0).y;
    const bottom = cam.worldToScreen(0, world.height).y;
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    const n = this.colors.length;
    for (let i = 0; i < n; i++) g.addColorStop(i / (n - 1), rgb(this.colors[i]));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cam.cssW, cam.cssH);
    if (top > 0) {
      ctx.fillStyle = rgb(this.colors[0]);
      ctx.fillRect(0, 0, cam.cssW, top);
    }
    this.drawFar(ctx, cam, world);
  }

  private drawFar(ctx: CanvasRenderingContext2D, cam: Camera, world: World): void {
    const key = `${cam.cssW}x${cam.cssH}:${cam.baseScale.toFixed(4)}`;
    if (key !== this.farKey || !this.far) {
      this.farKey = key;
      this.far = buildFarLayer(cam, world);
    }
    const par = 0.35;
    const z = 1 + (cam.zoom - 1) * par;
    const ox = (cam.cx - world.width / 2) * cam.scale * par;
    const oy = (cam.cy - world.height / 2) * cam.scale * par;
    ctx.save();
    ctx.globalAlpha = 0.55 + 0.25 * world.env.daylight;
    ctx.translate(cam.cssW / 2 - ox, cam.cssH / 2 - oy);
    ctx.scale(z, z);
    ctx.drawImage(this.far, -cam.cssW / 2, -cam.cssH / 2, cam.cssW, cam.cssH);
    ctx.restore();
  }

  private drawRays(ctx: CanvasRenderingContext2D, cam: Camera, world: World, vt: number): void {
    const env = world.env;
    const day = env.daylight;
    const strength = (0.025 + 0.1 * day) * Math.min(1.4, env.lightSet) * (1 - 0.6 * env.turbulence);
    if (strength < 0.01) return;
    const top = cam.worldToScreen(0, 0).y;
    const depth = cam.cssH * 0.85;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const warm = smoothstep(0.05, 0.45, day) * (1 - smoothstep(0.55, 0.95, day));
    for (const r of this.rays) {
      const sway = Math.sin(vt * r.speed * 3 + r.phase) * 0.025;
      const x = (r.x + sway) * cam.cssW;
      const w = r.width * cam.cssW;
      const breathe = 0.65 + 0.35 * Math.sin(vt * r.speed * 4 + r.phase * 2);
      const a = strength * breathe;
      const g = ctx.createLinearGradient(0, top, 0, top + depth);
      const col = day > 0.25 ? (warm > 0.3 ? '255 226 190' : '210 255 238') : '170 200 255';
      g.addColorStop(0, `rgb(${col} / ${a.toFixed(3)})`);
      g.addColorStop(0.55, `rgb(${col} / ${(a * 0.35).toFixed(3)})`);
      g.addColorStop(1, `rgb(${col} / 0)`);
      ctx.fillStyle = g;
      const dx = r.slant * depth;
      ctx.beginPath();
      ctx.moveTo(x - w * 0.25, top);
      ctx.lineTo(x + w * 0.25, top);
      ctx.lineTo(x + w * 0.9 + dx, top + depth);
      ctx.lineTo(x - w * 0.9 + dx, top + depth);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** Dancing caustic light near the surface. */
  drawCaustics(ctx: CanvasRenderingContext2D, cam: Camera, world: World, vt: number, quality: number): void {
    const env = world.env;
    const k = (0.04 + 0.15 * env.daylight) * Math.min(1.3, env.lightSet) * (1 - 0.7 * env.turbulence);
    if (k < 0.02 || quality < 1) return;
    const top = Math.max(0, cam.worldToScreen(0, 0).y);
    const h = Math.min(cam.cssH, cam.cssH * 0.5);
    const lw = Math.ceil(cam.cssW / 2);
    const lh = Math.ceil(h / 2);
    if (this.causticLayer.width !== lw || this.causticLayer.height !== lh) {
      this.causticLayer.width = lw;
      this.causticLayer.height = lh;
      this.causticPattern = null;
    }
    const g = this.causticLayer.getContext('2d')!;
    if (!this.causticPattern) this.causticPattern = g.createPattern(this.causticTile, 'repeat');
    const pat = this.causticPattern;
    if (!pat) return;
    // the pattern drifts slowly; refreshing it every other frame is invisible
    if (this.causticFrame++ % 2 === 0) {
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, lw, lh);
      const s = 1.4 * cam.zoom;
      const m1 = new DOMMatrix().translateSelf((vt * 7) % 512, (vt * 3) % 512).scaleSelf(s, s * 0.7);
      pat.setTransform(m1);
      g.globalAlpha = 0.9;
      g.fillStyle = pat;
      g.fillRect(0, 0, lw, lh);
      g.globalCompositeOperation = 'lighter';
      const m2 = new DOMMatrix().translateSelf((-vt * 5) % 512, (vt * 4) % 512).scaleSelf(s * 1.3, s * 0.9);
      pat.setTransform(m2);
      g.globalAlpha = 0.6;
      g.fillRect(0, 0, lw, lh);
      g.globalCompositeOperation = 'destination-in';
      const mask = g.createLinearGradient(0, 0, 0, lh);
      mask.addColorStop(0, 'rgba(0,0,0,1)');
      mask.addColorStop(0.35, 'rgba(0,0,0,0.45)');
      mask.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 1;
      g.fillStyle = mask;
      g.fillRect(0, 0, lw, lh);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = k;
    ctx.drawImage(this.causticLayer, 0, top, cam.cssW, h);
    ctx.restore();
  }

  /** Bright, slowly wavering band right under the water surface. */
  drawSurface(ctx: CanvasRenderingContext2D, cam: Camera, world: World, vt: number): void {
    const y = cam.worldToScreen(0, 0).y;
    if (y < -30) return;
    const day = world.env.daylight;
    const a = 0.1 + 0.14 * day;
    const g = ctx.createLinearGradient(0, y, 0, y + 40);
    g.addColorStop(0, `rgba(215, 255, 245, ${a.toFixed(3)})`);
    g.addColorStop(1, 'rgba(215, 255, 245, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, cam.cssW, 40);
    ctx.save();
    ctx.strokeStyle = `rgba(230, 255, 250, ${(a * 0.9).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= cam.cssW; x += 12) {
      const yy = y + 2 + Math.sin(x * 0.012 + vt * 0.8) * 1.6 + Math.sin(x * 0.031 - vt * 1.3) * 0.9;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawVignette(ctx: CanvasRenderingContext2D, cam: Camera): void {
    if (!this.vignette || this.vignette.width !== Math.ceil(cam.cssW / 4) || this.vignette.height !== Math.ceil(cam.cssH / 4)) {
      const w = Math.ceil(cam.cssW / 4);
      const h = Math.ceil(cam.cssH / 4);
      const c = makeCanvas(w, h);
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.25, w / 2, h / 2, Math.hypot(w, h) * 0.62);
      grad.addColorStop(0, 'rgba(2, 10, 14, 0)');
      grad.addColorStop(0.65, 'rgba(2, 10, 14, 0.18)');
      grad.addColorStop(1, 'rgba(2, 8, 12, 0.62)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      this.vignette = c;
    }
    ctx.drawImage(this.vignette, 0, 0, cam.cssW, cam.cssH);
  }
}

function buildCausticTile(rng: Rng): HTMLCanvasElement {
  const S = 256;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d')!;
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.filter = 'blur(2.2px)';
  for (let i = 0; i < 30; i++) {
    const cx = rng.range(0, S);
    const cy = rng.range(0, S);
    const rad = rng.range(12, 34);
    const pts = 6;
    const px: number[] = [];
    const py: number[] = [];
    for (let k = 0; k < pts; k++) {
      const a = (k / pts) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const rr = rad * rng.range(0.6, 1.25);
      px.push(Math.cos(a) * rr);
      py.push(Math.sin(a) * rr);
    }
    g.strokeStyle = `rgba(255,255,255,${rng.range(0.16, 0.32).toFixed(2)})`;
    g.lineWidth = rng.range(1.4, 3);
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        g.beginPath();
        const x0 = cx + ox + (px[pts - 1] + px[0]) / 2;
        const y0 = cy + oy + (py[pts - 1] + py[0]) / 2;
        g.moveTo(x0, y0);
        for (let k = 0; k < pts; k++) {
          const n = (k + 1) % pts;
          g.quadraticCurveTo(cx + ox + px[k], cy + oy + py[k], cx + ox + (px[k] + px[n]) / 2, cy + oy + (py[k] + py[n]) / 2);
        }
        g.closePath();
        g.stroke();
      }
    }
  }
  return c;
}

/** Hazy distant plants and hills, rendered once per window size. */
function buildFarLayer(cam: Camera, world: World): HTMLCanvasElement {
  const w = Math.ceil(cam.cssW / 2);
  const h = Math.ceil(cam.cssH / 2);
  const c = makeCanvas(w, h);
  const g = c.getContext('2d')!;
  const rng = new Rng('far:' + world.seed);
  const toScreenY = (wy: number) => cam.worldToScreen(0, wy).y / 2;
  const toScreenX = (wx: number) => cam.worldToScreen(wx, 0).x / 2;
  const seed = world.terrain.noiseSeed + 99;
  const x0 = cam.screenToWorld(0, 0).x;
  const x1 = cam.screenToWorld(cam.cssW, 0).x;
  g.filter = 'blur(5px)';
  // far hills
  for (let layer = 0; layer < 2; layer++) {
    g.fillStyle = layer === 0 ? 'rgba(120, 190, 180, 0.07)' : 'rgba(60, 130, 125, 0.09)';
    g.beginPath();
    g.moveTo(0, h);
    for (let sx = 0; sx <= w; sx += 6) {
      const wx = x0 + ((x1 - x0) * sx) / w;
      const base = floorFormula(wx * 0.7 + layer * 300, world.height, seed + layer) - 90 - layer * 40;
      const y = toScreenY(base - 60 * fbm1D(wx / 300 + layer, seed + 5, 2));
      g.lineTo(sx, y);
    }
    g.lineTo(w, h);
    g.closePath();
    g.fill();
  }
  // distant kelp silhouettes
  g.lineCap = 'round';
  const strands = 26;
  for (let i = 0; i < strands; i++) {
    const wx = x0 + rng.next() * (x1 - x0);
    const baseY = toScreenY(floorFormula(wx, world.height, seed) - 70);
    const height = rng.range(0.25, 0.6) * h;
    g.strokeStyle = `rgba(110, 185, 170, ${rng.range(0.05, 0.11).toFixed(3)})`;
    g.lineWidth = rng.range(2, 5);
    g.beginPath();
    const sx = toScreenX(wx);
    g.moveTo(sx, baseY);
    const bend = rng.range(-30, 30);
    g.bezierCurveTo(sx + bend, baseY - height * 0.4, sx - bend, baseY - height * 0.7, sx + bend * 0.5, baseY - height);
    g.stroke();
  }
  return c;
}
