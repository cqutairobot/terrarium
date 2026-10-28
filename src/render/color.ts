import { clamp01, wrap01 } from '../sim/core/math';

export type RGB = [number, number, number];

export function hsl(h: number, s: number, l: number, a = 1): string {
  const hh = Math.round(wrap01(h) * 3600) / 10;
  const ss = Math.round(clamp01(s) * 1000) / 10;
  const ll = Math.round(clamp01(l) * 1000) / 10;
  if (a >= 1) return `hsl(${hh} ${ss}% ${ll}%)`;
  return `hsl(${hh} ${ss}% ${ll}% / ${Math.round(clamp01(a) * 1000) / 1000})`;
}

export function hexToRgb(hex: string): RGB {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function rgb(c: RGB, a = 1): string {
  const r = Math.round(c[0]);
  const g = Math.round(c[1]);
  const b = Math.round(c[2]);
  return a >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${Math.round(clamp01(a) * 1000) / 1000})`;
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  h = wrap01(h);
  const k = (n: number) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Water palette keyframes, top → bottom. */
export const WATER_DAY: RGB[] = [
  hexToRgb('#4f9e96'),
  hexToRgb('#2b7377'),
  hexToRgb('#164b55'),
  hexToRgb('#0c3139'),
  hexToRgb('#092529'),
];
export const WATER_NIGHT: RGB[] = [
  hexToRgb('#1e4256'),
  hexToRgb('#132f42'),
  hexToRgb('#0c2134'),
  hexToRgb('#08182a'),
  hexToRgb('#061320'),
];
export const WATER_DUSK: RGB[] = [
  hexToRgb('#7d8f86'),
  hexToRgb('#3d6670'),
  hexToRgb('#1a4352'),
  hexToRgb('#0d2c38'),
  hexToRgb('#082129'),
];
export const WATER_STORM: RGB[] = [
  hexToRgb('#4c6670'),
  hexToRgb('#2f4f5a'),
  hexToRgb('#1a3a45'),
  hexToRgb('#0e2a33'),
  hexToRgb('#08202a'),
];
