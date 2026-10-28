import { hsl } from './color';

/**
 * Pre-rendered soft radial glows. Drawing a cached sprite with drawImage is
 * far cheaper than building a radial gradient for every glowing thing.
 */
const SIZE = 64;
const cache = new Map<string, HTMLCanvasElement>();

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function glowSprite(hue: number, sat = 0.8, light = 0.7): HTMLCanvasElement {
  const hb = Math.round(((hue % 1) + 1) % 1 * 48) % 48;
  const sb = Math.round(sat * 4);
  const lb = Math.round(light * 6);
  const key = `${hb}:${sb}:${lb}`;
  let c = cache.get(key);
  if (!c) {
    c = makeCanvas(SIZE, SIZE);
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE / 2);
    const h = hb / 48;
    const s = sb / 4;
    const l = lb / 6;
    grad.addColorStop(0, hsl(h, s, Math.min(1, l + 0.15), 0.95));
    grad.addColorStop(0.22, hsl(h, s, l, 0.55));
    grad.addColorStop(0.55, hsl(h, s, l, 0.16));
    grad.addColorStop(1, hsl(h, s, l, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, SIZE, SIZE);
    cache.set(key, c);
  }
  return c;
}

let white: HTMLCanvasElement | null = null;

/** Soft white highlight (for speculars, motes). */
export function whiteSprite(): HTMLCanvasElement {
  if (!white) {
    white = makeCanvas(SIZE, SIZE);
    const g = white.getContext('2d')!;
    const grad = g.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, SIZE, SIZE);
  }
  return white;
}

export function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement,
  x: number,
  y: number,
  radius: number,
  alpha: number,
): void {
  if (alpha <= 0.003 || radius <= 0) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
}

export { makeCanvas };
