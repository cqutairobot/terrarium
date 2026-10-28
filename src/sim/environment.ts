import { clamp, clamp01, smoothstep, TAU, wrap01 } from './core/math';
import type { Rng } from './core/rng';
import type { EcoConfig, EnvSettings } from './config';
import { groundY, type Terrain } from './terrain';

export type DisasterKind = 'storm' | 'coldwave' | 'heatwave' | 'meteor' | 'bloom';

export const DISASTER_LABELS: Record<DisasterKind, string> = {
  storm: '暴雨',
  coldwave: '寒潮',
  heatwave: '热浪',
  meteor: '流星',
  bloom: '生态繁荣',
};

export interface ImpactSnapshot {
  creatures: number;
  consumers: number;
  predators: number;
  plants: number;
  plantBiomass: number;
  algae: number;
}

export interface WeatherEvent {
  id: number;
  kind: DisasterKind;
  natural: boolean;
  start: number;
  duration: number;
  ramp: number;
  intensity: number;
  x: number;
  y: number;
  before: ImpactSnapshot;
  deaths: number;
  births: number;
  /** Deaths expected anyway over the event (from the recent death rate). */
  expectedDeaths: number;
  impactKills: number;
  /** Lowest plant biomass seen while the event was active. */
  minPlantBiomass: number;
  minPlants: number;
  /** Plant biomass trend before the event (per second), so the summary blames only the change beyond it. */
  plantTrend?: number;
  /** Deepest dip below that trend while the event lasted. */
  minPlantDev?: number;
  done: boolean;
}

export interface Wave {
  kx: number;
  ky: number;
  /** Unit direction of the wave vector (velocity is perpendicular to it). */
  ux: number;
  uy: number;
  w: number;
  p: number;
}

export interface Vec {
  x: number;
  y: number;
}

/** Envelope 0..1 of an event at time t. */
export function eventEnvelope(e: WeatherEvent, t: number): number {
  const local = t - e.start;
  if (local < 0 || local > e.duration) return 0;
  const inn = smoothstep(0, e.ramp, local);
  const out = 1 - smoothstep(e.duration - e.ramp, e.duration, local);
  return Math.min(inn, out) * e.intensity;
}

export class Environment {
  settings: EnvSettings;
  /** Eased copies of the settings the world actually uses. */
  lightSet: number;
  nutrientSet: number;
  tempSet: number;
  mutationSet: number;

  time = 0;
  dayPhase = 0;
  daylight = 1;
  light = 1;
  /** Slow average of surface light: rooted plants store the day's light and grow on through the night. */
  lightAvg = 0.7;
  temperature = 0.5;
  turbulence = 0;
  flowAmp = 2.6;
  growthBoost = 1;
  nutrientBoost = 1;
  lightWeather = 1;
  tempWeather = 0;
  seasonPhase: number;
  driftPhase: number;
  events: WeatherEvent[] = [];

  readonly cols: number;
  readonly rows: number;
  readonly cell: number;
  nutrient: Float64Array;
  detritus: Float64Array;
  stardust: Float64Array;
  /** Fungus biomass per cell (refreshed by the producer system). */
  fungus: Float64Array;
  /** 1 for water cells, 0 for cells under the floor. */
  water: Uint8Array;
  /** Row index of the lowest water cell per column. */
  bottomRow: Int16Array;
  waterCells: number;

  waves: Wave[];
  turbWaves: Wave[];

  constructor(
    readonly width: number,
    readonly height: number,
    readonly terrain: Terrain,
    private readonly cfg: EcoConfig,
    settings: EnvSettings,
    rng: Rng,
  ) {
    this.settings = { ...settings };
    this.lightSet = settings.light;
    this.nutrientSet = settings.nutrients;
    this.tempSet = settings.temperature;
    this.mutationSet = settings.mutation;
    this.cell = cfg.nutrientCell;
    this.cols = Math.ceil(width / this.cell);
    this.rows = Math.ceil(height / this.cell);
    const n = this.cols * this.rows;
    this.nutrient = new Float64Array(n);
    this.detritus = new Float64Array(n);
    this.stardust = new Float64Array(n);
    this.fungus = new Float64Array(n);
    this.water = new Uint8Array(n);
    this.bottomRow = new Int16Array(this.cols);
    this.waterCells = 0;
    for (let cx = 0; cx < this.cols; cx++) {
      const gx = Math.min(width, (cx + 0.5) * this.cell);
      const gy = groundY(terrain, gx);
      let bottom = 0;
      for (let cy = 0; cy < this.rows; cy++) {
        const top = cy * this.cell;
        const isWater = top + this.cell * 0.35 < gy ? 1 : 0;
        this.water[cy * this.cols + cx] = isWater;
        if (isWater) {
          bottom = cy;
          this.waterCells++;
        }
      }
      this.bottomRow[cx] = bottom;
    }
    this.seasonPhase = rng.next();
    this.driftPhase = rng.next() * TAU;
    this.waves = [];
    for (let i = 0; i < 5; i++) this.waves.push(makeWave(rng, 380, 1100, 6, 16));
    this.turbWaves = [];
    for (let i = 0; i < 3; i++) this.turbWaves.push(makeWave(rng, 110, 240, 20, 45));
  }

  cellIndex(x: number, y: number): number {
    let cx = Math.floor(x / this.cell);
    let cy = Math.floor(y / this.cell);
    if (cx < 0) cx = 0;
    else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.rows) cy = this.rows - 1;
    let i = cy * this.cols + cx;
    if (!this.water[i]) i = this.bottomRow[cx] * this.cols + cx;
    return i;
  }

  /** Surface light attenuated by depth. */
  lightAt(y: number): number {
    return this.light * Math.exp((-this.cfg.lightAttenuation * clamp(y, 0, this.height)) / this.height);
  }

  /** Day-averaged light at depth (what a rooted plant effectively lives on). */
  storedLightAt(y: number): number {
    return this.lightAvg * Math.exp((-this.cfg.lightAttenuation * clamp(y, 0, this.height)) / this.height);
  }

  /** Q10-style metabolic temperature factor (1 at 0.5). */
  q10(): number {
    return Math.pow(2, (this.temperature - 0.5) * 1.6);
  }

  /** Water current at a point, written into `out` (u/s). */
  flowAt(x: number, y: number, out: Vec): Vec {
    const t = this.time;
    let u = 0;
    let v = 0;
    for (const w of this.waves) {
      const c = Math.cos(w.kx * x + w.ky * y + w.w * t + w.p);
      u += c * w.uy;
      v -= c * w.ux;
    }
    u *= this.flowAmp;
    v *= this.flowAmp * 0.6;
    if (this.turbulence > 0.01) {
      let tu = 0;
      let tv = 0;
      for (const w of this.turbWaves) {
        const c = Math.cos(w.kx * x + w.ky * y + w.w * t + w.p);
        tu += c * w.uy;
        tv -= c * w.ux;
      }
      u += tu * this.turbulence * 16;
      v += tv * this.turbulence * 12;
    }
    u += 2.4 * Math.sin(t / 310 + this.driftPhase) * (1 + this.turbulence * 3);
    const floor = groundY(this.terrain, x);
    const damp = smoothstep(0, 90, floor - y) * (0.72 + 0.28 * smoothstep(0, 70, y));
    out.x = u * damp;
    out.y = v * damp;
    return out;
  }

  /** Advance light, temperature and weather modifiers. */
  update(dt: number): void {
    this.time += dt;
    const ease = 1 - Math.exp(-dt / 6);
    const s = this.settings;
    this.lightSet += (s.light - this.lightSet) * ease;
    this.nutrientSet += (s.nutrients - this.nutrientSet) * ease;
    this.tempSet += (s.temperature - this.tempSet) * ease;
    this.mutationSet += (s.mutation - this.mutationSet) * ease;

    let lightW = 1;
    let tempW = 0;
    let turb = 0;
    let growth = 1;
    let nutrientB = 1;
    for (const e of this.events) {
      const k = eventEnvelope(e, this.time);
      if (k <= 0) continue;
      switch (e.kind) {
        case 'storm':
          lightW *= 1 - 0.5 * k;
          tempW -= 0.05 * k;
          turb = Math.max(turb, k);
          nutrientB += 0.6 * k;
          break;
        case 'coldwave':
          tempW -= 0.34 * k;
          growth *= 1 - 0.25 * k;
          break;
        case 'heatwave':
          tempW += 0.32 * k;
          break;
        case 'bloom':
          growth *= 1 + 1.5 * k;
          nutrientB += 1.2 * k;
          lightW *= 1 + 0.15 * k;
          break;
        case 'meteor':
          turb = Math.max(turb, 0.6 * k);
          break;
      }
    }
    const wEase = 1 - Math.exp(-dt / 3);
    this.lightWeather += (lightW - this.lightWeather) * wEase;
    this.tempWeather += (tempW - this.tempWeather) * wEase;
    this.turbulence += (turb - this.turbulence) * wEase;
    this.growthBoost += (growth - this.growthBoost) * wEase;
    this.nutrientBoost += (nutrientB - this.nutrientBoost) * wEase;

    this.dayPhase = wrap01(this.time / this.cfg.dayLength + 0.06);
    const sun = Math.sin(TAU * this.dayPhase);
    this.daylight = smoothstep(-0.38, 0.22, sun);
    this.light = this.lightSet * (0.25 + 0.75 * this.daylight) * this.lightWeather;
    this.lightAvg += (this.light - this.lightAvg) * (1 - Math.exp(-dt / 420));
    const season = Math.sin(TAU * (this.time / this.cfg.seasonLength + this.seasonPhase));
    this.temperature = clamp01(this.tempSet + 0.07 * season + 0.025 * (this.daylight - 0.5) + this.tempWeather);
    this.flowAmp = 2.6 * (1 + 2.2 * this.turbulence);
  }

  /** Diffusion, sinking, mixing and decomposition on the nutrient grid. */
  /** Returns the matter actually exchanged with the sediment. */
  updateGrid(dt: number, inflow: number): number {
    const { cols, rows, nutrient, detritus, water, cfg } = this;
    const q = this.q10();
    // decomposition: detritus → nutrients, faster where fungus grows
    for (let i = 0; i < nutrient.length; i++) {
      if (!water[i]) continue;
      const d = detritus[i];
      if (d > 1e-6) {
        const k = cfg.decomposition * q * (1 + Math.min(4, this.fungus[i] / 12));
        const amt = d * Math.min(1, k * dt);
        detritus[i] = d - amt;
        nutrient[i] += amt;
      }
      this.stardust[i] *= Math.exp(-dt / 900);
    }
    // diffusion (vertical diffusion boosted by turbulence → storms stir nutrients up)
    const dh = cfg.diffusion * dt;
    const dv = (cfg.diffusion + 0.5 * this.turbulence) * dt;
    const next = new Float64Array(nutrient.length);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const i = cy * cols + cx;
        if (!water[i]) continue;
        const n = nutrient[i];
        let delta = 0;
        if (cx > 0 && water[i - 1]) delta += (nutrient[i - 1] - n) * dh;
        if (cx < cols - 1 && water[i + 1]) delta += (nutrient[i + 1] - n) * dh;
        if (cy > 0 && water[i - cols]) delta += (nutrient[i - cols] - n) * dv;
        if (cy < rows - 1 && water[i + cols]) delta += (nutrient[i + cols] - n) * dv;
        next[i] = n + delta * 0.25;
      }
    }
    // sinking toward the floor (suppressed by turbulence)
    const sink = cfg.sinking * dt * (1 - 0.8 * this.turbulence);
    for (let cy = rows - 2; cy >= 0; cy--) {
      for (let cx = 0; cx < cols; cx++) {
        const i = cy * cols + cx;
        const below = i + cols;
        if (!water[i] || !water[below]) continue;
        const m = next[i] * sink;
        next[i] -= m;
        next[below] += m;
      }
    }
    this.nutrient = next;
    // slow exchange with the sediment keeps total matter near the richness target
    return inflow !== 0 ? this.applyInflow(inflow) : 0;
  }

  private applyInflow(amount: number): number {
    const { cols, nutrient, detritus } = this;
    if (amount > 0) {
      const per = amount / cols;
      for (let cx = 0; cx < cols; cx++) nutrient[this.bottomRow[cx] * cols + cx] += per;
      return amount;
    }
    let pool = 0;
    for (let cx = 0; cx < cols; cx++) {
      const i = this.bottomRow[cx] * cols + cx;
      pool += nutrient[i] + detritus[i];
    }
    if (pool <= 0) return 0;
    const f = Math.min(1, -amount / pool);
    let removed = 0;
    for (let cx = 0; cx < cols; cx++) {
      const i = this.bottomRow[cx] * cols + cx;
      removed += (nutrient[i] + detritus[i]) * f;
      nutrient[i] *= 1 - f;
      detritus[i] *= 1 - f;
    }
    return -removed;
  }

  totalNutrient(): number {
    let s = 0;
    for (let i = 0; i < this.nutrient.length; i++) s += this.nutrient[i];
    return s;
  }

  totalDetritus(): number {
    let s = 0;
    for (let i = 0; i < this.detritus.length; i++) s += this.detritus[i];
    return s;
  }

  addNutrient(x: number, y: number, amount: number): void {
    if (amount > 0) this.nutrient[this.cellIndex(x, y)] += amount;
  }

  addDetritus(x: number, y: number, amount: number): void {
    if (amount > 0) this.detritus[this.cellIndex(x, y)] += amount;
  }

  /** Take up to `amount` nutrients from the cell at (x, y). */
  takeNutrient(x: number, y: number, amount: number): number {
    const i = this.cellIndex(x, y);
    const got = Math.min(amount, this.nutrient[i]);
    this.nutrient[i] -= got;
    return got;
  }

  nutrientAt(x: number, y: number): number {
    return this.nutrient[this.cellIndex(x, y)];
  }
}

function makeWave(rng: Rng, minL: number, maxL: number, minC: number, maxC: number): Wave {
  const lambda = rng.range(minL, maxL);
  const k = TAU / lambda;
  const ang = rng.next() * TAU;
  const c = rng.range(minC, maxC);
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  return { kx: ux * k, ky: uy * k, ux, uy, w: k * c * 0.2, p: rng.next() * TAU };
}
