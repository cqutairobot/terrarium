import { RingBuffer } from '../core/ringBuffer';
import { DEATH_LABELS, DEATH_PHRASES, type Creature } from '../entities/creature';
import { cloneGenome, express, G, N_GENES, type Genome } from '../genome';
import { colorWord } from '../names';
import { alleleCount, RARE_DEFS, rareKeyLabel, rareTraitKeys, type RareExpression } from '../rareTraits';
import { familyDepth } from '../registry';
import type { World } from '../world';
import { describeMutation, formatAge, formatDuration, mostVisible, type Importance, type StoryEvent, type StoryKind } from './narrator';
import { Series, type Sample, type SeriesSave } from './series';
import { Lineage, type LineageNode } from './lineage';
import { newStory, placeOf, pushStory, RECORD_LABELS, type LifeStory, type StoryEntry } from './stories';

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
  timers: { detect: number; sample: number; drift: number; prune?: number };
  throttle: Record<string, number>;
  lineage?: { nodes: LineageNode[]; pinned: number[] };
  stories?: LifeStory[];
  maxChildren?: number;
  disasterKinds?: Record<string, [string, number]>;
}

const DEPTH_MARKS = [1, 3, 5, 10, 20, 30, 50, 75, 100, 150, 200];
const CHILD_MARKS = [3, 5, 10, 20, 30, 50];
const MAX_WATCHED = 200;
const MAX_AUTO = 60;

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
  private timers = { detect: 0, sample: 0, drift: 0, prune: 0 };
  private throttle: Record<string, number> = {};
  lineage = new Lineage();
  stories = new Map<number, LifeStory>();
  private maxChildren = 0;
  /** Disaster id → [label, mood] (0 harsh, 1 mild weather, 2 a good time). */
  private disasterKinds: Record<string, [string, number]> = {};

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
      for (const c of w.creatures) this.lineage.ensure(c);
    }
    for (const e of w.events) this.onEvent(e);
    this.timers.detect += dt;
    this.timers.sample += dt;
    this.timers.drift += dt;
    this.timers.prune += dt;
    if (this.timers.prune >= 60) {
      this.timers.prune -= 60;
      this.lineage.prune(w);
    }
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
        this.lineage.ensure(c);
        if (e.parentA && !this.flags.firstBirth) {
          this.flags.firstBirth = 1;
          this.add('firstBirth', 3, { name: c.name, id: c.id, pa: nameOf(w, e.parentA), pb: nameOf(w, e.parentB) });
          this.keepRecord(c, 'first');
        }
        for (const tag of c.tags) this.onDescendant(tag, c);
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
        this.lineage.markDeath(c.id, w.time);
        this.onStoryDeath(c, e.cause, e.age, e.children);
        if (e.cause === 'age' && e.age > this.longevity.age) {
          const prev = this.longevity.age;
          this.longevity = { age: e.age, name: c.name, at: w.time };
          if (prev > 0 && e.age > prev * 1.05 && this.allow('longevity', 600)) {
            this.add('longevity', 2, { name: c.name, id: c.id, age: formatAge(e.age) });
            this.keepRecord(c, 'longevity');
          }
        }
        if (e.children > this.maxChildren) {
          this.maxChildren = e.children;
          if (e.children >= 12) this.keepRecord(c, 'children');
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
        {
          const s = this.stories.get(e.id);
          const pred = w.creatureMap.get(e.predator);
          if (s && s.watched && s.diedT < 0) {
            s.escapes++;
            const predator = (pred && w.species.get(pred.speciesId)?.name) || '掠食者';
            const prev = s.events[s.events.length - 1];
            if (prev && prev.k === 'escape' && prev.p.predator === predator) prev.p.n = Number(prev.p.n ?? 1) + 1;
            else this.story(s, 'escape', { predator, n: 1 });
            if (this.allow('watchEscape' + s.id, 120)) this.add('watchEscape', 2, { name: s.custom || s.name, id: s.id });
          }
        }
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
        const last = w.creatureMap.get(e.lastId);
        if (last) this.keepRecord(last, 'last');
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
    this.updateBloodlines();
    this.pollWatched();
  }

  /** Count who still carries each watched bloodline; notice when one ends. */
  private updateBloodlines(): void {
    const w = this.world;
    const living = new Map<number, number>();
    for (const c of w.creatures) {
      if (c.dying > 0) continue;
      for (const t of c.tags) if (t !== c.id) living.set(t, (living.get(t) ?? 0) + 1);
    }
    for (const s of this.stories.values()) {
      if (!s.watched) continue;
      s.living = living.get(s.id) ?? 0;
      if (s.living === 0 && s.diedT >= 0 && s.descendants > 0 && s.lineEnd < 0) {
        s.lineEnd = w.time;
        this.story(s, 'lineEnd', { n: s.maxDepth });
        this.add('watchLineEnd', 2, { name: s.custom || s.name, n: s.maxDepth });
      }
    }
  }

  /** A story as it would read if this creature were watched (not stored). */
  previewStory(c: Creature): LifeStory {
    const s = newStory(this.world, c, null);
    s.watched = false;
    this.backfill(s, c);
    return s;
  }

  /** The ancestral genes a species is measured against (for 'then and now'). */
  baselineOf(speciesId: number): number[] | undefined {
    return this.drift.get(speciesId)?.baseline;
  }

  // ------------------------------------------------------------ life stories

  private story(s: LifeStory, k: StoryEntry['k'], p: StoryEntry['p'] = {}, t = this.world.time): void {
    const w = this.world.clock() - Math.max(0, this.world.time - t) * 1000;
    pushStory(s, { t, w, k, p });
  }

  /** Add a line to a life's story, if that life has one. */
  note(id: number, k: StoryEntry['k'], p: StoryEntry['p'] = {}): void {
    const s = this.stories.get(id);
    if (s && s.diedT < 0) this.story(s, k, p);
  }

  isWatched(id: number): boolean {
    return this.stories.get(id)?.watched ?? false;
  }

  /** Begin following a creature's life (and, from now on, its bloodline). */
  watch(c: Creature): LifeStory {
    const w = this.world;
    let s = this.stories.get(c.id);
    if (s && s.watched) return s;
    const watchedCount = [...this.stories.values()].filter((x) => x.watched).length;
    if (watchedCount >= MAX_WATCHED) {
      const oldest = [...this.stories.values()].filter((x) => x.watched && x.diedT >= 0).sort((a, b) => a.diedT - b.diedT)[0];
      if (oldest) this.stories.delete(oldest.id);
    }
    if (!s) {
      s = newStory(w, c, null);
      this.stories.set(c.id, s);
      this.backfill(s, c);
    } else {
      s.watched = true;
      s.watchedT = w.time;
    }
    this.story(s, 'watched');
    this.lineage.ensure(c);
    this.lineage.tagLineage(w, c);
    // descendants already swimming count from the start
    if (s.lineEnd < 0) {
      const kin = this.lineage.livingDescendants(w, c.id);
      s.living = kin.length;
      s.descendants = Math.max(s.descendants, kin.length);
      for (const k of kin) s.maxDepth = Math.max(s.maxDepth, k.generation - s.generation);
    }
    return s;
  }

  unwatch(id: number): void {
    const s = this.stories.get(id);
    if (!s) return;
    if (s.auto) s.watched = false;
    else {
      this.stories.delete(id);
      this.lineage.pinned.delete(id);
    }
    for (const c of this.world.creatures) {
      const i = c.tags.indexOf(id);
      if (i >= 0) c.tags.splice(i, 1);
    }
  }

  rename(c: Creature, name: string): void {
    const clean = name.trim().slice(0, 12);
    c.customName = clean || null;
    const s = this.watch(c);
    s.custom = c.customName;
    this.lineage.rename(c.id, c.customName || c.name);
    if (clean) this.story(s, 'named', { name: clean });
  }

  /** What an observer would have seen of this life so far, from its milestones. */
  private backfill(s: LifeStory, c: Creature): void {
    const w = this.world;
    const [pa, paName, pb, pbName] = s.parents;
    this.story(s, 'born', { place: s.place, pa: pa ? paName : '', pb: pb ? pbName : '' }, c.bornT);
    if (c.firstMealT >= 0) this.story(s, 'firstMeal', {}, c.firstMealT);
    if (c.firstReproT >= 0) this.story(s, 'parent', { mate: this.mateOf(c) }, c.firstReproT);
    const mark = CHILD_MARKS.filter((m) => c.children >= m).pop();
    if (mark) this.story(s, 'children', { n: mark });
    for (const id of c.disasters) {
      const d = this.disasterKinds[String(id)];
      const ongoing = w.env.events.some((e) => e.id === id && !e.done);
      if (d && !ongoing) this.story(s, 'disaster', { kind: d[0], mood: d[1] });
    }
    if (c.escapes > 0) this.story(s, 'escape', { predator: '掠食者', n: c.escapes });
    if (c.stage === 'elder') this.story(s, 'elder');
    s.events.sort((a, b) => a.t - b.t);
  }

  /** Watched lives: notice their milestones as they happen. */
  private pollWatched(): void {
    const w = this.world;
    for (const s of this.stories.values()) {
      if (!s.watched || s.diedT >= 0) continue;
      const c = w.creatureMap.get(s.id);
      if (!c || c.dying > 0) continue;
      const has = (k: StoryEntry['k']) => s.events.some((e) => e.k === k);
      const name = c.customName || c.name;
      if (c.firstMealT >= 0 && !has('firstMeal')) {
        this.story(s, 'firstMeal', {}, c.firstMealT);
        this.add('watchFirstMeal', 2, { name, id: c.id });
      }
      if (c.firstReproT >= 0 && !has('parent')) {
        this.story(s, 'parent', { mate: this.mateOf(c) }, c.firstReproT);
        this.add('watchParent', 2, { name, id: c.id });
      }
      if (c.children > s.children) {
        for (const m of CHILD_MARKS) {
          if (s.children < m && c.children >= m) {
            this.story(s, 'children', { n: m });
            if (m >= 5) this.add('watchChildren', 2, { name, id: c.id, n: m });
          }
        }
        s.children = c.children;
      }
      if (c.stage === 'elder' && !has('elder')) {
        this.story(s, 'elder');
        this.add('watchElder', 1, { name, id: c.id });
      }
    }
  }

  /** The partner of a creature's first brood, by name. */
  private mateOf(c: Creature): string {
    for (const kid of c.kids) {
      const k = this.world.creatureMap.get(kid);
      const n = this.lineage.nodes.get(kid);
      const pa = k ? k.parentA : n ? n.pa : 0;
      const pb = k ? k.parentB : n ? n.pb : 0;
      const mate = pa === c.id ? pb : pb === c.id ? pa : 0;
      if (mate) return nameOf(this.world, mate);
    }
    return '伴侣';
  }

  private onDescendant(tag: number, c: Creature): void {
    const s = this.stories.get(tag);
    if (!s || !s.watched) return;
    s.descendants++;
    const depth = c.generation - s.generation;
    if (depth > s.maxDepth) {
      for (const m of DEPTH_MARKS) {
        if (s.maxDepth < m && depth >= m && m >= 3) {
          this.story(s, 'descendants', { n: m });
          this.add('watchDescendants', 2, { name: s.custom || s.name, id: c.id, n: m });
        }
      }
      s.maxDepth = depth;
    }
  }

  private onStoryDeath(c: Creature, cause: keyof typeof DEATH_LABELS, age: number, children: number): void {
    const s = this.stories.get(c.id);
    if (!s || s.diedT >= 0) return;
    s.diedT = this.world.time;
    s.diedW = this.world.clock();
    s.cause = DEATH_LABELS[cause];
    s.age = age;
    s.children = children;
    s.genome = cloneGenome(c.genome);
    const how = DEATH_PHRASES[cause];
    this.story(s, 'death', { cause: s.cause, how, age: formatAge(age), children });
    if (s.watched) this.add('watchDeath', 2, { name: s.custom || s.name, cause: s.cause, how, age: formatAge(age), children });
  }

  /** Keep a remarkable life in the archive even if nobody was watching. */
  private keepRecord(c: Creature, reason: keyof typeof RECORD_LABELS): void {
    let s = this.stories.get(c.id);
    if (!s) {
      s = newStory(this.world, c, reason);
      this.backfill(s, c);
      this.stories.set(c.id, s);
      this.lineage.pinned.add(c.id);
      const autos = [...this.stories.values()].filter((x) => x.auto && !x.watched);
      if (autos.length > MAX_AUTO) {
        const victim = autos.sort((a, b) => a.watchedT - b.watchedT)[0];
        this.stories.delete(victim.id);
        this.lineage.pinned.delete(victim.id);
      }
    } else if (!s.auto) s.auto = reason;
    this.story(s, 'record', { text: `被记入档案：${RECORD_LABELS[reason]}。` });
    if (c.dying > 0 && s.diedT < 0) this.onStoryDeath(c, c.deathCause ?? 'age', c.age, c.children);
  }

  /** A disaster began (so lives can later remember living through it). */
  noteDisaster(id: number, label: string, mood: number): void {
    this.disasterKinds[String(id)] = [label, mood];
    const keys = Object.keys(this.disasterKinds);
    if (keys.length > 200) delete this.disasterKinds[keys[0]];
  }

  /** A disaster ended: the watched who lived through it remember. */
  disasterSurvived(id: number): void {
    const d = this.disasterKinds[String(id)];
    if (!d) return;
    for (const s of this.stories.values()) {
      if (!s.watched || s.diedT >= 0) continue;
      const c = this.world.creatureMap.get(s.id);
      if (!c || c.dying > 0 || !c.disasters.includes(id)) continue;
      this.story(s, 'disaster', { kind: d[0], mood: d[1] });
      if (d[1] === 0) this.add('watchDisaster', 2, { name: c.customName || c.name, id: c.id, kind: d[0] });
    }
  }

  /** The place a creature lives now, in words (for the card). */
  placeNow(c: Creature): string {
    return placeOf(this.world, c.x, c.y);
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
      lineage: this.lineage.save(),
      stories: [...this.stories.values()].map((s) => structuredClone(s)),
      maxChildren: this.maxChildren,
      disasterKinds: { ...this.disasterKinds },
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
    this.timers = { detect: 0, sample: 0, drift: 0, prune: 0, ...(d.timers ?? {}) };
    this.throttle = d.throttle ?? {};
    this.lineage.load(d.lineage);
    this.stories = new Map((d.stories ?? []).map((s) => [s.id, s]));
    this.maxChildren = d.maxChildren ?? 0;
    this.disasterKinds = d.disasterKinds ?? {};
  }
}

function nameOf(w: World, id: number): string {
  const c = w.creatureMap.get(id);
  if (c) return c.customName || c.name;
  return w.history.lineage.nodes.get(id)?.name ?? '无名者';
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
