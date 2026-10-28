/**
 * Multi-resolution time series. Every sample carries both the simulated
 * time and the wall-clock time, so charts stay correct at any speed and can
 * be drawn against either axis.
 */
export interface Sample {
  /** Simulated seconds. */
  t: number;
  /** Wall clock (ms since epoch). */
  w: number;
  cons: number;
  pred: number;
  eggs: number;
  plants: number;
  algae: number;
  fungi: number;
  plantMass: number;
  coverage: number;
  births: number;
  deaths: number;
  /** Mean age at death (s) for deaths in the interval, 0 if none. */
  lifespan: number;
  size: number;
  speed: number;
  sense: number;
  metab: number;
  maxGen: number;
  temp: number;
  light: number;
  nutrient: number;
  /** Top species by population: [id, count]. */
  species: [number, number][];
}

export interface Level {
  /** Seconds of simulated time per sample. */
  span: number;
  cap: number;
  /** How many samples of the finer level make one of this level. */
  merge: number;
  samples: Sample[];
  /** Finer samples waiting to be merged into this level. */
  pending: Sample[];
}

export interface SeriesSave {
  levels: { samples: Sample[]; pending: Sample[] }[];
}

const LEVEL_DEFS: { span: number; cap: number; merge: number }[] = [
  { span: 10, cap: 360, merge: 1 }, // 1 hour of 10 s samples
  { span: 120, cap: 720, merge: 12 }, // 24 hours of 2 min samples
  { span: 960, cap: 630, merge: 8 }, // 7 days of 16 min samples
  { span: 11520, cap: 500, merge: 12 }, // ~66 days of 3.2 h samples
];

const AVG_KEYS = [
  'cons',
  'pred',
  'eggs',
  'plants',
  'algae',
  'fungi',
  'plantMass',
  'coverage',
  'size',
  'speed',
  'sense',
  'metab',
  'temp',
  'light',
  'nutrient',
] as const;

function round(v: number, d = 3): number {
  const p = 10 ** d;
  return Math.round(v * p) / p;
}

export function tidy(s: Sample): Sample {
  for (const k of AVG_KEYS) s[k] = round(s[k]);
  s.lifespan = round(s.lifespan, 1);
  s.t = round(s.t, 2);
  return s;
}

function mergeSamples(list: Sample[]): Sample {
  const n = list.length;
  const last = list[n - 1];
  const out: Sample = { ...last, species: last.species.slice() };
  for (const k of AVG_KEYS) out[k] = list.reduce((a, s) => a + s[k], 0) / n;
  out.births = list.reduce((a, s) => a + s.births, 0);
  out.deaths = list.reduce((a, s) => a + s.deaths, 0);
  const lifeN = list.filter((s) => s.lifespan > 0);
  out.lifespan = lifeN.length ? lifeN.reduce((a, s) => a + s.lifespan, 0) / lifeN.length : 0;
  out.maxGen = Math.max(...list.map((s) => s.maxGen));
  return tidy(out);
}

export class Series {
  levels: Level[];

  constructor() {
    this.levels = LEVEL_DEFS.map((d) => ({ ...d, samples: [], pending: [] }));
  }

  /** Add a finest-level sample; coarser levels are rolled up automatically. */
  add(sample: Sample): void {
    const s = tidy(sample);
    push(this.levels[0], s);
    let carry: Sample | null = s;
    for (let i = 1; i < this.levels.length && carry; i++) {
      const lv = this.levels[i];
      lv.pending.push(carry);
      if (lv.pending.length >= lv.merge) {
        carry = mergeSamples(lv.pending);
        lv.pending = [];
        push(lv, carry);
      } else carry = null;
    }
  }

  /** Samples covering the last `seconds` (simulated), from the finest adequate level. */
  window(seconds: number, axis: 'sim' | 'real', nowSim: number, nowWall: number): Sample[] {
    const lv =
      seconds <= 3600 ? this.levels[0] : seconds <= 86400 ? this.levels[1] : seconds <= 7 * 86400 ? this.levels[2] : this.levels[3];
    // fall back to a finer level when the coarse one has too little data yet
    let pick = lv;
    for (let i = this.levels.indexOf(lv); i >= 0; i--) {
      if (this.levels[i].samples.length >= 3 || i === 0) {
        pick = this.levels[i];
        if (this.levels[i].samples.length >= 3) break;
      }
    }
    if (axis === 'sim') return pick.samples.filter((s) => s.t >= nowSim - seconds);
    return pick.samples.filter((s) => s.w >= nowWall - seconds * 1000);
  }

  latest(): Sample | undefined {
    const l0 = this.levels[0].samples;
    return l0[l0.length - 1];
  }

  save(): SeriesSave {
    return { levels: this.levels.map((l) => ({ samples: l.samples, pending: l.pending })) };
  }

  load(data: SeriesSave | undefined): void {
    if (!data?.levels) return;
    data.levels.forEach((l, i) => {
      if (!this.levels[i]) return;
      this.levels[i].samples = (l.samples ?? []).slice(-this.levels[i].cap);
      this.levels[i].pending = l.pending ?? [];
    });
  }
}

function push(lv: Level, s: Sample): void {
  lv.samples.push(s);
  if (lv.samples.length > lv.cap) lv.samples.splice(0, lv.samples.length - lv.cap);
}
