import { RingBuffer } from '../core/ringBuffer';
import { DEATH_LABELS, type Creature } from '../entities/creature';
import { cloneGenome, express, G, N_GENES, type Genome } from '../genome';
import { colorWord } from '../names';
import { alleleCount, RARE_DEFS, rareKeyLabel, rareTraitKeys, type RareExpression } from '../rareTraits';
import { familyDepth } from '../registry';
import type { World } from '../world';
import { describeMutation, formatAge, formatDuration, mostVisible, type Importance, type StoryEvent, type StoryKind } from './narrator';
import { Series, type Sample, type SeriesSave } from './series';

export interface CodexEntry {
  key: string;
  label: string;
  firstT: number;
  firstW: number;
  firstId: number;
  firstName: string;
  firstGen: number;
  species: string;
  /** Genome of the first carrier (draws its portrait). */
  genome: Genome;
  total: number;
  living: number;
  peak: number;
  /** Sim time it last vanished (-1 while present). */
  vanishedAt: number;
  vanishCount: number;
  returnCount: number;
  alleleLost: boolean;
  spread: number[];
}

interface DriftState {
  baseline: number[];
  announced: Record<string, number>;
}

export interface HistorySave {
  nextId: number;
  log: StoryEvent[];
  chronicle: StoryEvent[];
  series: SeriesSave;
  flags: Record<string, number>;
  genMilestones: number[];
  dominantId: number;
  candidateId: number;
  candidateSince: number;
  longevity: { age: number; name: string; at: number };
  drift: Record<string, DriftState>;
  codex: CodexEntry[];
  acc: { births: number; deaths: number; ageSum: number; ageN: number };
  timers: { detect: number; sample: number; drift: number };
  throttle: Record<string, number>;
}

const CHRONICLE_CAP = 3000;
const GEN_MARKS = [5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750, 1000];
const POP_MARKS = [30, 60, 100, 150, 200, 260];
const FAMILY_MARKS = [10, 20, 30, 40, 50, 75, 100, 150, 200];
const SPREAD_MARKS = [5, 15, 30, 60];

/**
 * The world's memory: turns simulation facts into statistics, stories and
 * chronicle entries. It is part of the simulation state and saved with it.
 */
export class History {
  nextId = 1;
  log = new RingBuffer<StoryEvent>(300);
  chronicle: StoryEvent[] = [];
  series = new Series();
  codex = new Map<string, CodexEntry>();
  flags: Record<string, number> = {};
  private genMilestones: number[] = [];
  private dominantId = 0;
  private candidateId = 0;
  private candidateSince = 0;
  private longevity = { age: 0, name: '', at: 0 };
  private drift = new Map<number, DriftState>();
  private acc = { births: 0, deaths: 0, ageSum: 0, ageN: 0 };
  private timers = { detect: 0, sample: 0, drift: 0 };
  private throttle: Record<string, number> = {};

  constructor(private readonly world: World) {}

  /** Record a story. Major ones also enter the permanent chronicle. */
  add(k: StoryKind, i: Importance, p: Record<string, string | number> = {}): StoryEvent {
    const e: StoryEvent = { id: this.nextId++, t: this.world.time, w: this.world.clock(), k, i, p };
    this.log.push(e);
    if (i >= 2) {
      this.chronicle.push(e);
      if (this.chronicle.length > CHRONICLE_CAP) this.compactChronicle();
    }
    return e;
  }

  private compactChronicle(): void {
    // drop the oldest notable (tier 2) entries first; major ones stay
    let excess = this.chronicle.length - CHRONICLE_CAP;
    this.chronicle = this.chronicle.filter((e) => {
      if (excess > 0 && e.i < 3) {
        excess--;
        return false;
      }
      return true;
    });
    if (this.chronicle.length > CHRONICLE_CAP) this.chronicle.splice(0, this.chronicle.length - CHRONICLE_CAP);
  }

  private allow(key: string, seconds: number): boolean {
    const last = this.throttle[key] ?? -Infinity;
    if (this.world.time - last < seconds) return false;
    this.throttle[key] = this.world.time;
    return true;
  }

  /** Called once per simulation step, after all systems ran. */
  process(dt: number): void {
    const w = this.world;
    if (!this.flags.born) {
      this.flags.born = 1;
      this.add('worldBorn', 3, { world: w.name });
      for (const sp of w.species.values()) this.drift.set(sp.id, { baseline: sp.centroid.slice(), announced: {} });
    }
    for (const e of w.events) this.onEvent(e);
    this.timers.detect += dt;
    this.timers.sample += dt;
    this.timers.drift += dt;
    if (this.timers.detect >= 5) {
      this.timers.detect -= 5;
      this.detect();
    }
    if (this.timers.sample >= 10) {
      this.timers.sample -= 10;
      this.sample();
    }
    if (this.timers.drift >= 600) {
      this.timers.drift -= 600;
      this.detectDrift();
    }
  }

  private onEvent(e: World['events'][number]): void {
    const w = this.world;
    switch (e.t) {
      case 'birth': {
        this.acc.births++;
        const c = w.creatureMap.get(e.id);
        if (!c) return;
        if (e.parentA && !this.flags.firstBirth) {
          this.flags.firstBirth = 1;
          this.add('firstBirth', 3, { name: c.name, id: c.id, pa: nameOf(w, e.parentA), pb: nameOf(w, e.parentB) });
        }
        const visible = c.mutations.filter((m) => m < 100);
        if (visible.length > 0) {
          const code = mostVisible(visible);
          const desc = describeMutation(code % 50, code >= 50 ? -1 : 1, c.ph);
          if (!this.flags.firstMutation) {
            this.flags.firstMutation = 1;
            this.add('firstMutation', 3, { name: c.name, id: c.id, gen: c.generation, desc });
          } else if (this.allow('birthNotable', 45)) {
            // striking looks reach the chronicle; quieter changes stay in the log
            const striking = [G.hue, G.accentHue, G.size, G.tentacles].includes(code % 50);
            this.add('birthNotable', striking ? 2 : 1, { name: c.name, id: c.id, gen: c.generation, desc });
          }
        }
        if (e.rareMask) this.onRareBirth(c, c.ph.rare);
        if (e.newFamily) this.flags.families = (this.flags.families ?? 0) + 1;
        return;
      }
      case 'death': {
        this.acc.deaths++;
        if (e.age > 0) {
          this.acc.ageSum += e.age;
          this.acc.ageN++;
        }
        const c = w.creatureMap.get(e.id);
        if (!c) return;
        if (e.cause === 'age' && e.age > this.longevity.age) {
          const prev = this.longevity.age;
          this.longevity = { age: e.age, name: c.name, at: w.time };
          if (prev > 0 && e.age > prev * 1.05 && this.allow('longevity', 600)) {
            this.add('longevity', 2, { name: c.name, id: c.id, age: formatAge(e.age) });
          }
        }
        if (e.cause === 'age' && e.children >= 8 && this.allow('elderDeath', 90)) {
          this.add('elderDeath', 1, { name: c.name, id: c.id, age: formatAge(e.age), children: e.children });
        }
        return;
      }
      case 'eggs':
        if (e.count >= 2 && this.allow('twins', 120)) this.add('twins', 1, { pa: nameOf(w, e.parentA), pb: nameOf(w, e.parentB) });
        return;
      case 'escape':
        if (this.allow('escape', 150)) {
          const prey = w.creatureMap.get(e.id);
          const pred = w.creatureMap.get(e.predator);
          if (prey && pred) this.add('escape', 1, { name: prey.name, id: prey.id, predator: w.species.get(pred.speciesId)?.name ?? '掠食者' });
        }
        return;
      case 'speciation': {
        const sp = w.species.get(e.species);
        const parent = w.species.get(e.parent);
        if (!sp) return;
        this.drift.set(sp.id, { baseline: sp.centroid.slice(), announced: {} });
        this.add('speciation', 3, { species: sp.name, parent: parent?.name ?? '', color: colorWord(sp.hue), n: e.members });
        return;
      }
      case 'speciesExtinct': {
        const sp = w.species.get(e.species);
        if (!sp) return;
        if (!this.flags.firstExtinction) {
          this.flags.firstExtinction = 1;
          this.add('firstExtinction', 3, { species: sp.name });
        } else this.add('speciesExtinct', 3, { species: sp.name });
        return;
      }
      case 'familyExtinct': {
        const f = w.families.get(e.family);
        if (!f) return;
        const depth = familyDepth(f);
        if (depth >= 15 && this.allow('familyEnd', 300)) this.add('familyEnd', depth >= 25 ? 3 : 2, { family: f.name, n: depth });
        return;
      }
      case 'allGone':
        if (e.kind === 'consumer') this.add('allGone', 3, { kind: e.kind });
        else this.add('predatorsGone', 2, {});
        return;
      case 'respawn':
        if (e.kind === 'consumer') this.add('revival', 3, { count: e.count, fromBank: e.fromBank ? 1 : 0 });
        else if (e.kind === 'predator') this.add('predatorArrive', 3, { count: e.count, fromBank: e.fromBank ? 1 : 0 });
        return;
      default:
        return;
    }
  }

  private onRareBirth(c: Creature, expr: RareExpression): void {
    const keys = rareTraitKeys(expr);
    const combo = keys.length >= 2 ? [keys.join('+')] : [];
    for (const key of [...keys, ...combo]) {
      let entry = this.codex.get(key);
      if (!entry) {
        entry = {
          key,
          label: rareKeyLabel(key),
          firstT: this.world.time,
          firstW: this.world.clock(),
          firstId: c.id,
          firstName: c.name,
          firstGen: c.generation,
          species: this.world.species.get(c.speciesId)?.name ?? '',
          genome: cloneGenome(c.genome),
          total: 0,
          living: 0,
          peak: 0,
          vanishedAt: -1,
          vanishCount: 0,
          returnCount: 0,
          alleleLost: false,
          spread: [],
        };
        this.codex.set(key, entry);
        this.add('rareFirst', 3, { trait: entry.label, name: c.name, id: c.id, gen: c.generation, key });
      } else if (entry.vanishedAt >= 0) {
        const gap = this.world.time - entry.vanishedAt;
        entry.returnCount++;
        entry.vanishedAt = -1;
        if (gap >= 600) this.add('rareReturn', 3, { trait: entry.label, gap: formatDuration(gap), name: c.name, id: c.id, key });
      }
      entry.total++;
    }
  }

  /** State-based detectors, every 5 simulated seconds. */
  private detect(): void {
    const w = this.world;
    // population milestones and dominance
    const counts = new Map<number, number>();
    let consumers = 0;
    let maxGen = 0;
    for (const c of w.creatures) {
      if (c.dying > 0 || c.stage === 'egg') continue;
      counts.set(c.speciesId, (counts.get(c.speciesId) ?? 0) + 1);
      if (c.ph.trophic !== 'carnivore') consumers++;
      if (c.generation > maxGen) maxGen = c.generation;
    }
    let top = 0;
    let topN = 0;
    for (const [id, n] of counts) {
      const sp = w.species.get(id);
      if (!sp) continue;
      for (const m of POP_MARKS) {
        if (n >= m && !sp.milestones.includes(m)) {
          sp.milestones.push(m);
          if (m >= 30) this.add('popMilestone', m >= 100 ? 3 : 2, { species: sp.name, n: m });
        }
      }
      if (sp.trophic !== 'carnivore' && n > topN) {
        top = id;
        topN = n;
      }
    }
    if (consumers >= 30 && topN / consumers > 0.5) {
      if (top !== this.candidateId) {
        this.candidateId = top;
        this.candidateSince = w.time;
      } else if (top !== this.dominantId && w.time - this.candidateSince > 300) {
        const first = this.dominantId === 0;
        this.dominantId = top;
        const sp = w.species.get(top);
        if (sp && !(first && w.time < 1800)) this.add('dominance', 3, { species: sp.name });
      }
    }
    // generations
    for (const m of GEN_MARKS) {
      if (maxGen >= m && !this.genMilestones.includes(m)) {
        this.genMilestones.push(m);
        this.add('generation', m === 10 || m === 50 || m >= 100 ? 3 : 2, { n: m });
      }
    }
    // families: each depth mark is told once, by the oldest living family that reaches it
    let oldest: { name: string; depth: number } | null = null;
    for (const f of w.families.values()) {
      if (f.living <= 0) continue;
      const depth = familyDepth(f);
      if (!oldest || depth > oldest.depth) oldest = { name: f.name, depth };
    }
    if (oldest) {
      for (const m of FAMILY_MARKS) {
        if (oldest.depth >= m && !this.genMilestones.includes(-m)) {
          this.genMilestones.push(-m);
          this.add(m >= 20 ? 'oldestFamily' : 'familyDepth', m >= 20 ? 3 : 2, { family: oldest.name, n: m });
        }
      }
    }
    this.detectRare();
  }

  /** Rare traits: how many are alive, spreading, vanished, lost from the gene pool. */
  private detectRare(): void {
    if (this.codex.size === 0) return;
    const w = this.world;
    const living = new Map<string, number>();
    for (const c of w.creatures) {
      if (c.dying > 0 || c.stage === 'egg' || c.ph.rare.mask === 0) continue;
      const keys = rareTraitKeys(c.ph.rare);
      for (const k of keys) living.set(k, (living.get(k) ?? 0) + 1);
      if (keys.length >= 2) {
        const combo = keys.join('+');
        living.set(combo, (living.get(combo) ?? 0) + 1);
      }
    }
    for (const entry of this.codex.values()) {
      const n = living.get(entry.key) ?? 0;
      const before = entry.living;
      entry.living = n;
      if (n > entry.peak) entry.peak = n;
      for (const m of SPREAD_MARKS) {
        if (n >= m && !entry.spread.includes(m)) {
          entry.spread.push(m);
          this.add('rareSpread', m >= 15 ? 3 : 2, { trait: entry.label, n: m, key: entry.key });
        }
      }
      if (n === 0 && before > 0 && entry.vanishedAt < 0) {
        entry.vanishedAt = w.time;
        entry.vanishCount++;
        if (!entry.key.includes('+')) this.add('rareVanished', 2, { trait: entry.label, key: entry.key });
      }
      if (n === 0 && !entry.alleleLost && !entry.key.includes('+')) {
        const locus = locusOfKey(entry.key);
        if (locus >= 0) {
          let carriers = 0;
          for (const c of w.creatures) if (c.dying === 0 && alleleCount(c.genome.rare, locus) > 0) carriers++;
          if (carriers === 0) {
            entry.alleleLost = true;
            this.add('rareLost', 3, { trait: entry.label, key: entry.key });
          }
        }
      }
      if (n > 0 && entry.alleleLost) entry.alleleLost = false;
    }
  }

  /** Long-term change against the founding ancestors (every 10 minutes). */
  private detectDrift(): void {
    const w = this.world;
    for (const sp of w.species.values()) {
      if (sp.extinctAt !== null || sp.population < 15) continue;
      let st = this.drift.get(sp.id);
      if (!st) {
        st = { baseline: sp.centroid.slice(), announced: {} };
        this.drift.set(sp.id, st);
        continue;
      }
      if (st.baseline.length !== N_GENES || sp.centroid.length !== N_GENES) continue;
      const base = express({ g: st.baseline, rare: [] });
      const now = express({ g: sp.centroid, rare: [] });
      const checks: [string, number, string, string][] = [
        ['size', pct(now.radius, base.radius), '平均体型大了', '平均体型小了'],
        ['speed', pct(now.maxSpeed, base.maxSpeed), '游得快了', '游得慢了'],
        ['sense', pct(now.senseRadius, base.senseRadius), '感知范围远了', '感知范围近了'],
        ['life', pct(now.lifespan, base.lifespan), '寿命长了', '寿命短了'],
      ];
      for (const [key, change, up, down] of checks) {
        const level = [15, 30, 50, 80].filter((l) => Math.abs(change) >= l).pop() ?? 0;
        const prev = st.announced[key] ?? 0;
        if (level > prev) {
          st.announced[key] = level;
          this.add('traitDrift', level >= 30 ? 3 : 2, { species: sp.name, phrase: `${change > 0 ? up : down} ${Math.round(Math.abs(change))}%` });
        }
      }
      const shifts: [string, number, string, string][] = [
        ['night', sp.centroid[G.nocturnality] - st.baseline[G.nocturnality], '在夜里活动', '在白天活动'],
        ['social', sp.centroid[G.sociability] - st.baseline[G.sociability], '成群结队', '独来独往'],
      ];
      for (const [key, d, up, down] of shifts) {
        const level = Math.abs(d) >= 0.25 ? 2 : Math.abs(d) >= 0.15 ? 1 : 0;
        if (level > (st.announced[key] ?? 0)) {
          st.announced[key] = level;
          const habit = d > 0 ? up : down;
          this.add('traitDrift', level >= 2 ? 3 : 2, { species: sp.name, phrase: level >= 2 ? `已经很习惯${habit}了` : `渐渐更爱${habit}了` });
        }
      }
      const c0 = colorWord(st.baseline[G.hue]);
      const c1 = colorWord(sp.centroid[G.hue]);
      if (c0 !== c1 && st.announced.color !== hashString(c1)) {
        st.announced.color = hashString(c1);
        this.add('traitDrift', 3, { species: sp.name, phrase: `的颜色从${c0}慢慢变成了${c1}` });
      }
    }
  }

  private sample(): void {
    const w = this.world;
    const k = w.counts();
    let plantMass = 0;
    const bins = new Float64Array(64);
    for (const p of w.producers) {
      if (p.kind !== 'plant') continue;
      plantMass += p.biomass;
      bins[Math.min(63, Math.floor((p.x / w.width) * 64))] += p.biomass;
    }
    let covered = 0;
    for (const b of bins) if (b > 30) covered++;
    let n = 0;
    let size = 0;
    let speed = 0;
    let sense = 0;
    let metab = 0;
    let maxGen = 0;
    const perSpecies = new Map<number, number>();
    for (const c of w.creatures) {
      if (c.dying > 0 || c.stage === 'egg') continue;
      perSpecies.set(c.speciesId, (perSpecies.get(c.speciesId) ?? 0) + 1);
      if (c.generation > maxGen) maxGen = c.generation;
      if (c.ph.trophic === 'carnivore') continue;
      n++;
      size += c.ph.radius;
      speed += c.ph.maxSpeed;
      sense += c.ph.senseRadius;
      metab += c.ph.metabolismMult;
    }
    const species = [...perSpecies.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const s: Sample = {
      t: w.time,
      w: w.clock(),
      cons: k.consumers,
      pred: k.predators,
      eggs: k.eggs,
      plants: k.plants,
      algae: k.algae,
      fungi: k.fungi,
      plantMass,
      coverage: covered / 64,
      births: this.acc.births,
      deaths: this.acc.deaths,
      lifespan: this.acc.ageN ? this.acc.ageSum / this.acc.ageN : 0,
      size: n ? size / n : 0,
      speed: n ? speed / n : 0,
      sense: n ? sense / n : 0,
      metab: n ? metab / n : 0,
      maxGen,
      temp: w.env.temperature,
      light: w.env.light,
      nutrient: w.env.totalNutrient(),
      species,
    };
    this.series.add(s);
    this.acc = { births: 0, deaths: 0, ageSum: 0, ageN: 0 };
  }

  /** Mean age at death over roughly the last `seconds`. */
  meanLifespan(seconds = 1800): number {
    const xs = this.series.window(seconds, 'sim', this.world.time, this.world.clock()).filter((s) => s.lifespan > 0 && s.deaths > 0);
    const deaths = xs.reduce((a, s) => a + s.deaths, 0);
    return deaths ? xs.reduce((a, s) => a + s.lifespan * s.deaths, 0) / deaths : 0;
  }

  longevityRecord(): { age: number; name: string } {
    return this.longevity;
  }

  causeLabel(cause: keyof typeof DEATH_LABELS): string {
    return DEATH_LABELS[cause];
  }

  save(): HistorySave {
    return {
      nextId: this.nextId,
      log: this.log.toArray(),
      chronicle: this.chronicle,
      series: this.series.save(),
      flags: { ...this.flags },
      genMilestones: this.genMilestones.slice(),
      dominantId: this.dominantId,
      candidateId: this.candidateId,
      candidateSince: this.candidateSince,
      longevity: { ...this.longevity },
      drift: Object.fromEntries([...this.drift.entries()].map(([k, v]) => [String(k), { baseline: v.baseline.slice(), announced: { ...v.announced } }])),
      codex: [...this.codex.values()].map((e) => ({ ...e, genome: cloneGenome(e.genome), spread: e.spread.slice() })),
      acc: { ...this.acc },
      timers: { ...this.timers },
      throttle: { ...this.throttle },
    };
  }

  load(data: unknown): void {
    const d = data as Partial<HistorySave> | undefined;
    if (!d || typeof d !== 'object') return;
    this.nextId = d.nextId ?? 1;
    this.log = new RingBuffer<StoryEvent>(300, d.log ?? []);
    this.chronicle = d.chronicle ?? [];
    this.series.load(d.series);
    this.flags = { ...(d.flags ?? {}) };
    this.genMilestones = d.genMilestones ?? [];
    this.dominantId = d.dominantId ?? 0;
    this.candidateId = d.candidateId ?? 0;
    this.candidateSince = d.candidateSince ?? 0;
    this.longevity = d.longevity ?? { age: 0, name: '', at: 0 };
    this.drift = new Map(Object.entries(d.drift ?? {}).map(([k, v]) => [Number(k), v]));
    this.codex = new Map((d.codex ?? []).map((e) => [e.key, e]));
    this.acc = d.acc ?? { births: 0, deaths: 0, ageSum: 0, ageN: 0 };
    this.timers = d.timers ?? { detect: 0, sample: 0, drift: 0 };
    this.throttle = d.throttle ?? {};
  }
}

function nameOf(w: World, id: number): string {
  const c = w.creatureMap.get(id);
  return c ? c.customName || c.name : '无名者';
}

function pct(now: number, base: number): number {
  return base > 0 ? ((now - base) / base) * 100 : 0;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function locusOfKey(key: string): number {
  if (key.startsWith('eyes')) return 5;
  if (key.startsWith('multiTentacle')) return 3;
  return RARE_DEFS.findIndex((d) => d.key === key);
}
