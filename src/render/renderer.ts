import { lerpAngle } from '../sim/core/math';
import type { Creature } from '../sim/entities/creature';
import type { World } from '../sim/world';
import { Background } from './background';
import { Camera } from './camera';
import { createVisual, drawCreature, drawEgg, type CreatureVisual, type DrawOpts } from './creatureRenderer';
import { Effects } from './effects';
import { drawCorpse, drawFood, drawSeed } from './itemsRenderer';
import { Ambience } from './particles';
import { drawAlgae, drawFungus, drawPlant } from './producersRenderer';
import { drawSprite, glowSprite } from './sprites';
import { TerrainRenderer } from './terrainRenderer';

/** 0 = low, 1 = medium, 2 = high. */
export type Quality = 0 | 1 | 2;

const MAX_DPR: Record<Quality, number> = { 0: 1, 1: 1.5, 2: 2 };

/**
 * Draws the world each animation frame. Reads simulation state only; all
 * render-only state (tentacles, blinking, motes) lives here.
 */
export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  cam!: Camera;
  quality: Quality = 2;
  selectedId = 0;
  followId = 0;
  effects = new Effects();
  private bg!: Background;
  private terrain!: TerrainRenderer;
  private ambience!: Ambience;
  private visuals = new Map<number, CreatureVisual>();
  private frame = 0;
  private world!: World;
  private drawOrder: Creature[] = [];
  private opts: DrawOpts = { vt: 0, dt: 0, night: 0, dyingTime: 3, scale: 1, detail: 2 };

  constructor(readonly canvas: HTMLCanvasElement, world: World) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.setWorld(world);
  }

  setWorld(world: World): void {
    this.world = world;
    this.cam = new Camera(world.width, world.height);
    this.bg = new Background(world.seed);
    this.terrain = new TerrainRenderer(world.terrain, world.seed);
    this.ambience = new Ambience(world);
    this.visuals.clear();
    this.effects = new Effects();
    this.selectedId = 0;
    this.followId = 0;
    this.resize();
  }

  resize(): void {
    const cssW = this.canvas.clientWidth || window.innerWidth;
    const cssH = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR[this.quality]);
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.cam.resize(cssW, cssH, dpr);
  }

  /** Creature under a screen point (CSS px), if any. */
  pick(sx: number, sy: number): Creature | null {
    const p = this.cam.screenToWorld(sx, sy);
    let best: Creature | null = null;
    let bd = 1e9;
    const tol = 10 / this.cam.scale;
    for (const c of this.world.creatures) {
      if (c.dying > 0) continue;
      const r = c.stage === 'egg' ? c.ph.radius * 0.5 + 2 : c.ph.radius * c.growth * 1.4;
      const d = Math.hypot(c.x - p.x, c.y - p.y) - r;
      if (d < tol && d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  render(alpha: number, dt: number, vt: number): void {
    const world = this.world;
    const ctx = this.ctx;
    const cam = this.cam;
    this.frame++;
    const desiredDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR[this.quality]);
    if (Math.abs(desiredDpr - cam.dpr) > 0.01) this.resize();

    // camera follow
    const followed = this.followId ? world.creatureMap.get(this.followId) : undefined;
    if (followed) {
      const fx = followed.px + (followed.x - followed.px) * alpha;
      const fy = followed.py + (followed.y - followed.py) * alpha;
      cam.follow(fx, fy, 1.8);
    } else if (this.followId) {
      cam.release();
      this.followId = 0;
    }
    cam.update(dt);

    const env = world.env;
    const o = this.opts;
    o.vt = vt;
    o.dt = Math.min(0.1, dt);
    o.night = 1 - env.daylight;
    o.dyingTime = world.cfg.dyingTime;
    o.scale = cam.scale;
    o.detail = this.quality;

    // screen space background
    ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.bg.updateColors(world);
    this.bg.drawBackdrop(ctx, cam, world, vt, this.terrain);
    this.bg.drawCaustics(ctx, cam, world, vt, this.quality);

    // world space
    cam.apply(ctx);
    this.ambience.update(o.dt);
    this.ambience.draw(ctx, cam, this.quality, 'back');

    const view = cam.view(80);
    const inView = (x: number, y: number, pad = 0) => x > view.x0 - pad && x < view.x1 + pad && y > view.y0 - pad && y < view.y1 + pad;

    for (const p of world.producers) {
      if (p.kind === 'fungus' && inView(p.x, p.y)) drawFungus(ctx, world, p, vt);
    }
    for (const p of world.producers) {
      if (p.kind === 'plant' && inView(p.x, p.y - 100, 260)) drawPlant(ctx, world, p, vt, this.quality);
    }
    for (const k of world.corpses) if (inView(k.x, k.y)) drawCorpse(ctx, k, vt);
    for (const p of world.producers) {
      if (p.kind === 'algae' && inView(p.x, p.y)) drawAlgae(ctx, world, p, p.x, p.y, vt);
    }
    for (const s of world.seeds) if (inView(s.x, s.y)) drawSeed(ctx, s);
    for (const f of world.foods) if (inView(f.x, f.y)) drawFood(ctx, f, vt);

    // creatures: eggs first, then big bodies behind small ones
    const order = this.drawOrder;
    order.length = 0;
    for (const c of world.creatures) order.push(c);
    order.sort((a, b) => (a.stage === 'egg' ? -1 : 0) - (b.stage === 'egg' ? -1 : 0) || b.ph.radius - a.ph.radius);
    for (const c of order) {
      const x = c.px + (c.x - c.px) * alpha;
      const y = c.py + (c.y - c.py) * alpha;
      if (!inView(x, y, 40)) continue;
      let vis = this.visuals.get(c.id);
      if (!vis) {
        vis = createVisual(c);
        this.visuals.set(c.id, vis);
      }
      vis.seen = this.frame;
      if (c.stage === 'egg') {
        drawEgg(ctx, c, x, y, vt, world.cfg.hatchTime);
        continue;
      }
      const heading = lerpAngle(c.ph0, c.heading, alpha);
      drawCreature(ctx, c, x, y, heading, vis, o);
      if (c.dying > 0) {
        vis.motes += o.dt * 7;
        while (vis.motes >= 1) {
          vis.motes -= 1;
          this.effects.dissolve(x, y, c.ph.rare.golden ? 0.13 : c.ph.hue, c.ph.radius * c.growth);
        }
      }
    }

    // selection halo
    const sel = this.selectedId ? world.creatureMap.get(this.selectedId) : undefined;
    if (sel) {
      const x = sel.px + (sel.x - sel.px) * alpha;
      const y = sel.py + (sel.y - sel.py) * alpha;
      const r = (sel.stage === 'egg' ? sel.ph.radius * 0.5 + 2 : sel.ph.radius * sel.growth) * 1.9 + 8;
      const pulse = 0.5 + 0.5 * Math.sin(vt * 2.2);
      ctx.save();
      ctx.strokeStyle = `rgba(200, 255, 240, ${(0.35 + 0.25 * pulse).toFixed(3)})`;
      ctx.lineWidth = 1.2 / Math.max(0.6, cam.zoom * 0.8);
      ctx.setLineDash([5, 6]);
      ctx.lineDashOffset = -vt * 6;
      ctx.beginPath();
      ctx.arc(x, y, r + pulse * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalCompositeOperation = 'lighter';
      drawSprite(ctx, glowSprite(0.47, 0.6, 0.75), x, y, r * 1.6, 0.12 + 0.06 * pulse);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    this.effects.budget = this.quality === 0 ? 0.3 : 1;
    this.effects.update(o.dt);
    this.effects.draw(ctx);
    this.ambience.draw(ctx, cam, this.quality, 'front');

    // screen-space overlays
    ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.bg.drawSurface(ctx, cam, world, vt);
    if (!this.bg.isOverview(cam)) this.bg.drawVignette(ctx, cam);

    if (this.frame % 120 === 0) {
      for (const [id, v] of this.visuals) if (this.frame - v.seen > 240) this.visuals.delete(id);
    }
  }
}
