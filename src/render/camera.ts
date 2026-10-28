import { clamp } from '../sim/core/math';

/**
 * Maps world units to screen pixels. The whole world is always fitted inside
 * the window (the background fills the rest), so resizing never changes the
 * simulation — only this transform. A follow mode eases zoom and center.
 */
export class Camera {
  cssW = 1;
  cssH = 1;
  dpr = 1;
  baseScale = 1;
  zoom = 1;
  targetZoom = 1;
  cx: number;
  cy: number;
  targetCx: number;
  targetCy: number;

  constructor(
    readonly worldW: number,
    readonly worldH: number,
  ) {
    this.cx = this.targetCx = worldW / 2;
    this.cy = this.targetCy = worldH / 2;
  }

  get scale(): number {
    return this.baseScale * this.zoom;
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.dpr = dpr;
    const sx = this.cssW / this.worldW;
    const sy = this.cssH / this.worldH;
    // contain; when the screen is relatively taller, allow a small side crop
    this.baseScale = sx >= sy ? sy : Math.min(sy, sx * 1.12);
  }

  follow(x: number, y: number, zoom: number): void {
    this.targetZoom = zoom;
    this.targetCx = x;
    this.targetCy = y;
  }

  release(): void {
    this.targetZoom = 1;
    this.targetCx = this.worldW / 2;
    this.targetCy = this.worldH / 2;
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 2.2);
    this.zoom += (this.targetZoom - this.zoom) * k;
    // keep the view inside the world (with a soft margin) while zoomed
    const halfW = this.cssW / (2 * this.scale);
    const halfH = this.cssH / (2 * this.scale);
    let tx = this.targetCx;
    let ty = this.targetCy;
    if (halfW * 2 < this.worldW) tx = clamp(tx, halfW, this.worldW - halfW);
    else tx = this.worldW / 2;
    if (halfH * 2 < this.worldH) ty = clamp(ty, halfH, this.worldH - halfH);
    else ty = this.worldH / 2;
    this.cx += (tx - this.cx) * k;
    this.cy += (ty - this.cy) * k;
  }

  /** Apply world → device-pixel transform. */
  apply(ctx: CanvasRenderingContext2D): void {
    const s = this.scale * this.dpr;
    ctx.setTransform(s, 0, 0, s, this.dpr * (this.cssW / 2 - this.cx * this.scale), this.dpr * (this.cssH / 2 - this.cy * this.scale));
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.cx) * this.scale + this.cssW / 2, y: (y - this.cy) * this.scale + this.cssH / 2 };
  }

  screenToWorld(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.cssW / 2) / this.scale + this.cx, y: (y - this.cssH / 2) / this.scale + this.cy };
  }

  /** Visible world rectangle (for culling). */
  view(pad = 0): { x0: number; y0: number; x1: number; y1: number } {
    const halfW = this.cssW / (2 * this.scale);
    const halfH = this.cssH / (2 * this.scale);
    return { x0: this.cx - halfW - pad, y0: this.cy - halfH - pad, x1: this.cx + halfW + pad, y1: this.cy + halfH + pad };
  }
}
