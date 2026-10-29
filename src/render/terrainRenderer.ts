import { Rng } from '../sim/core/rng';
import { floorFormula, type Terrain } from '../sim/terrain';
import type { World } from '../sim/world';
import type { BiomeId } from '../sim/biomes';
import type { Camera } from './camera';
import { hsl } from './color';

/** Floor colours of each kind of water: back ridge, sand from top to depth, the light along its rim. */
const FLOORS: Record<BiomeId, { ridge: string; sand: [string, string, string, string]; rim: string; mossHue: (h: number) => number; mossSat: number }> = {
  shallows: { ridge: 'rgba(52, 96, 84, 0.35)', sand: ['#4d7a68', '#2f5649', '#183631', '#0c1f1c'], rim: 'rgba(170, 225, 196, 0.22)', mossHue: (h) => h, mossSat: 0.36 },
  abyss: { ridge: 'rgba(48, 62, 104, 0.35)', sand: ['#34405f', '#222c46', '#121a2e', '#070c18'], rim: 'rgba(150, 180, 235, 0.18)', mossHue: (h) => h + 0.12, mossSat: 0.3 },
  // the reef's mounds are corals
  reef: { ridge: 'rgba(132, 118, 90, 0.35)', sand: ['#a89a7c', '#7d6e56', '#4a4032', '#211c16'], rim: 'rgba(255, 236, 200, 0.25)', mossHue: (h) => (h - 0.27) * 3 + 0.94, mossSat: 0.5 },
};

interface Pebble {
  x: number;
  dy: number;
  rx: number;
  ry: number;
  shade: number;
}

/**
 * The tank floor: sand, moss mounds, rocks and pebbles. The background
 * caches it together with the water for the overview camera.
 */
export class TerrainRenderer {
  private pebbles: Pebble[] = [];

  constructor(private readonly terrain: Terrain, seed: string) {
    const rng = new Rng('pebbles:' + seed);
    const span = terrain.width * 1.8;
    for (let i = 0; i < 140; i++) {
      this.pebbles.push({
        x: -terrain.width * 0.4 + rng.next() * span,
        dy: rng.range(4, 40),
        rx: rng.range(1.5, 5),
        ry: rng.range(1, 3),
        shade: rng.next(),
      });
    }
  }

  /** Paint in world coordinates (camera transform already applied). */
  paint(g: CanvasRenderingContext2D, cam: Camera, world: World): void {
    const t = this.terrain;
    const view = cam.view(40);
    const x0 = Math.floor(view.x0 / 8) * 8;
    const x1 = view.x1;
    const bottom = Math.max(view.y1, world.height) + 20;
    const ground = (x: number) => floorFormula(x, t.height, t.noiseSeed);
    const groundIn = (x: number) => (x >= 0 && x <= t.width ? sampled(t, x) : ground(x));

    // back ridge (slightly lighter, gives depth)
    g.beginPath();
    g.moveTo(x0, bottom);
    for (let x = x0; x <= x1 + 8; x += 8) g.lineTo(x, groundIn(x) - 14 - 10 * Math.sin(x * 0.004));
    g.lineTo(x1 + 8, bottom);
    g.closePath();
    const floor = FLOORS[world.biome] ?? FLOORS.shallows;
    g.fillStyle = floor.ridge;
    g.fill();

    // sand body
    const top = t.height - 140;
    const sand = g.createLinearGradient(0, top, 0, t.height + 40);
    sand.addColorStop(0, floor.sand[0]);
    sand.addColorStop(0.28, floor.sand[1]);
    sand.addColorStop(0.62, floor.sand[2]);
    sand.addColorStop(1, floor.sand[3]);
    g.beginPath();
    g.moveTo(x0, bottom);
    for (let x = x0; x <= x1 + 8; x += 8) g.lineTo(x, groundIn(x));
    g.lineTo(x1 + 8, bottom);
    g.closePath();
    g.fillStyle = sand;
    g.fill();

    // light rim along the floor surface
    g.beginPath();
    for (let x = x0; x <= x1 + 8; x += 8) {
      const y = groundIn(x) + 1.5;
      if (x === x0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokeStyle = floor.rim;
    g.lineWidth = 2.5;
    g.stroke();

    // rocks
    for (const r of t.rocks) {
      if (r.x + r.r < view.x0 || r.x - r.r > view.x1) continue;
      const l = 0.16 + r.shade * 0.08;
      const grad = g.createLinearGradient(r.x, r.y - r.r, r.x, r.y + r.r);
      grad.addColorStop(0, hsl(0.47, 0.18, l + 0.1));
      grad.addColorStop(1, hsl(0.5, 0.25, l - 0.08));
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(r.x, r.y, r.r * 1.25, r.r * 0.85, 0, Math.PI, 0);
      g.closePath();
      g.fill();
      // moss cap
      g.fillStyle = hsl(0.33, 0.35, 0.3, 0.55);
      g.beginPath();
      g.ellipse(r.x - r.r * 0.1, r.y - r.r * 0.72, r.r * 0.75, r.r * 0.22, -0.08, 0, Math.PI * 2);
      g.fill();
    }

    // moss mounds
    for (const m of t.moss) {
      if (m.x + m.r * 2 < view.x0 || m.x - m.r * 2 > view.x1) continue;
      const y = sampled(t, Math.min(t.width, Math.max(0, m.x))) + 4;
      const mh = floor.mossHue(m.hue);
      for (let k = 0; k < 3; k++) {
        const ox = (k - 1) * m.r * 0.7;
        const rr = m.r * (k === 1 ? 1 : 0.7);
        g.fillStyle = hsl(mh, floor.mossSat, 0.25 + k * 0.035, 0.9);
        g.beginPath();
        g.ellipse(m.x + ox, y, rr, rr * 0.55, 0, Math.PI, 0);
        g.closePath();
        g.fill();
      }
      g.fillStyle = hsl(mh, floor.mossSat + 0.06, 0.44, 0.4);
      g.beginPath();
      g.ellipse(m.x, y - m.r * 0.42, m.r * 0.62, m.r * 0.16, 0, 0, Math.PI * 2);
      g.fill();
      // tiny moss tips
      g.fillStyle = hsl(mh + 0.03, floor.mossSat + 0.09, 0.52, 0.5);
      for (let k = 0; k < 6; k++) {
        const ox = (((k * 37 + m.x) % 100) / 100 - 0.5) * m.r * 1.6;
        g.beginPath();
        g.arc(m.x + ox, y - m.r * (0.3 + 0.25 * Math.abs(Math.sin(k + m.x))), 1, 0, Math.PI * 2);
        g.fill();
      }
    }

    // pebbles
    for (const p of this.pebbles) {
      if (p.x < view.x0 || p.x > view.x1) continue;
      const y = groundIn(p.x) + p.dy;
      g.fillStyle = hsl(0.42 + p.shade * 0.1, 0.12, 0.2 + p.shade * 0.12, 0.7);
      g.beginPath();
      g.ellipse(p.x, y, p.rx, p.ry, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function sampled(t: Terrain, x: number): number {
  const f = x / t.step;
  const i = Math.floor(f);
  const a = t.heights[Math.max(0, Math.min(i, t.heights.length - 1))];
  const b = t.heights[Math.max(0, Math.min(i + 1, t.heights.length - 1))];
  return a + (b - a) * (f - i);
}
