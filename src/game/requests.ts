import { Rng } from '../sim/core/rng';
import type { Creature } from '../sim/entities/creature';
import { express, G, type Genome } from '../sim/genome';
import { COLOR_BANDS } from '../sim/names';
import { alleleCount, RARE_DEFS, rareTraitKeys } from '../sim/rareTraits';
import type { World } from '../sim/world';
import {
  describeCondition,
  describeSpec,
  evaluate,
  matchesSpec,
  MEASURES,
  newTracker,
  plantCoverage,
  shownHue,
  type Condition,
  type CreatureSpec,
  type Measure,
  type Tracker,
} from './conditions';

/**
 * 委托: small wishes from people around the tank. Delivery requests ask for a
 * creature that looks or behaves a certain way (it leaves the tank to them);
 * ecology requests ask for the tank itself to reach a state. Every request is
 * drawn from the tank's real population, so it can be done.
 */

export interface Request {
  id: string;
  kind: 'deliver' | 'ecology';
  from: string;
  /** A line of flavor from the requester. */
  text: string;
  /** What is asked, in plain words. */
  goal: string;
  spec?: CreatureSpec;
  cond?: Condition;
  reward: number;
  difficulty: 1 | 2 | 3;
  daily?: boolean;
  createdAt: number;
  /** A matching creature has been noticed (announced once). */
  ready?: boolean;
}

export interface RequestBoard {
  open: Request[];
  nextId: number;
  /** Local date (YYYY-MM-DD) of the current daily request. */
  dailyDate: string;
  completed: number;
  trackers: Record<string, Tracker>;
}

export const OPEN_REQUESTS = 3;

export function newBoard(): RequestBoard {
  return { open: [], nextId: 1, dailyDate: '', completed: 0, trackers: {} };
}

const PEOPLE = ['画画的小满', '水族馆的阿青', '研究浮游生物的老周', '喜欢夜晚的阿岚', '收集颜色的珀珀', '隔壁的孩子小禾', '写诗的雾生', '灯塔守望人'];

const LOOK_LINES = ['想把它画进新的画里。', '说它的样子在梦里出现过。', '想让自己的小水缸也热闹一点。', '想送给一位老朋友。'];
const ABILITY_LINES = ['想看看它到底有多厉害。', '要带它去参加一场小小的展览。', '在写一篇关于它们的观察笔记。'];
const RARE_LINES = ['听说这种生命极少见，想亲眼看一看。', '已经找了很久很久了。'];
const ECO_LINES = ['想知道这片水能不能做到。', '在记录不同水缸的样子。', '相信你的水缸可以。'];

/** How strong a quality can get, for this creature's body, if its gene were maxed. */
const GENE_OF: Partial<Record<Measure, number>> = {
  size: G.size,
  speed: G.speed,
  sense: G.perception,
  lifespan: G.longevity,
  tentacles: G.tentacles,
  tail: G.tailLength,
  eyes: G.eyeSize,
  warmth: G.thermalPref,
};

function geneExtreme(c: Creature, m: Measure, to: 0 | 1): number {
  const gi = GENE_OF[m];
  if (gi === undefined) return MEASURES[m].get(c);
  const g: Genome = { g: c.genome.g.slice(), rare: c.genome.rare };
  g.g[gi] = to;
  return MEASURES[m].get({ ph: express(g) } as Creature);
}

function quantile(sorted: number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

/** Round a threshold to a readable step, always toward the harder side (so rounding never makes it easier). */
function round(m: Measure, v: number, up: boolean): number {
  const step = m === 'size' || m === 'warmth' ? 0.5 : m === 'tail' || m === 'eyes' ? 0.01 : 1;
  const r = (up ? Math.ceil(v / step - 1e-9) : Math.floor(v / step + 1e-9)) * step;
  return Math.round(r * 100) / 100;
}

const REWARD: Record<1 | 2 | 3, [number, number]> = { 1: [25, 40], 2: [60, 90], 3: [120, 180] };

function consumers(world: World): Creature[] {
  return world.creatures.filter((c) => c.dying === 0 && c.stage !== 'egg' && c.ph.trophic !== 'carnivore');
}

/**
 * A creature-shaped wish. Easy: a few grown-ups already come close. Medium
 * and hard: past anyone alive today (part or most of the way to what the
 * genes allow), so it takes breeding to get there.
 */
function specRequest(world: World, rng: Rng, difficulty: 1 | 2 | 3): { spec: CreatureSpec; line: string } | null {
  const pool = consumers(world).filter((c) => c.stage === 'adult' || c.stage === 'elder');
  if (pool.length < 6) return null;
  const measures: Measure[] = ['size', 'speed', 'sense', 'tentacles', 'tail', 'eyes', 'warmth', 'lifespan'];
  const m = measures[rng.int(measures.length)];
  const values = pool.map((c) => MEASURES[m].get(c)).sort((a, b) => a - b);
  const reach = difficulty === 2 ? 0.3 : 0.6;
  const spec: CreatureSpec = { adult: true, grazer: true };
  if (m === 'warmth' && rng.chance(0.5)) {
    // a cool-water lover
    let hi = quantile(values, 0.05);
    if (difficulty > 1) {
      const coldest = pool.reduce((a, c) => (MEASURES[m].get(c) < MEASURES[m].get(a) ? c : a), pool[0]);
      const floor = geneExtreme(coldest, m, 0);
      // no colder water left to breed toward: ask for something else
      if (values[0] - floor < 0.5) return null;
      hi = values[0] - (values[0] - floor) * reach;
    }
    spec.ranges = { warmth: [null, round(m, hi, false)] };
  } else {
    let lo = quantile(values, 0.95);
    if (difficulty > 1) {
      const best = pool.reduce((a, c) => (MEASURES[m].get(c) > MEASURES[m].get(a) ? c : a), pool[0]);
      const cap = geneExtreme(best, m, 1);
      const top = values[values.length - 1];
      // the best are already at what the genes allow: ask for something else
      if (cap - top <= Math.abs(top) * 0.02) return null;
      lo = top + (cap - top) * reach;
      if (m === 'tentacles') {
        lo = Math.max(lo, top + 1);
        if (lo > cap) return null;
      }
    }
    lo = round(m, lo, true);
    if (m === 'tentacles' && lo < 1) lo = 1;
    if (difficulty === 1) {
      // ties (whole tentacles, common values) can make "easy" free: step up until only a few qualify
      const step = m === 'size' ? 0.5 : m === 'tail' || m === 'eyes' ? 0.01 : 1;
      const top = values[values.length - 1];
      const few = Math.max(2, values.length * 0.12);
      while (values.filter((v) => v >= lo).length > few && lo + step <= top) lo = Math.round((lo + step) * 100) / 100;
      // most of them are already at the top (say, everyone has six feelers): not worth asking
      if (values.filter((v) => v >= lo).length > few) return null;
    }
    spec.ranges = { [m]: [lo, null] };
  }
  if (difficulty >= 2 && rng.chance(0.6)) {
    // and a color that some of them already wear
    const c = pool[rng.int(pool.length)];
    const band = COLOR_BANDS.find((b) => (b.from < 0 ? shownHue(c) >= b.from + 1 || shownHue(c) < b.to : shownHue(c) >= b.from && shownHue(c) < b.to));
    if (band) spec.hue = { from: band.from, to: band.to, word: band.word };
  }
  const line = m === 'speed' || m === 'sense' || m === 'lifespan' ? ABILITY_LINES : LOOK_LINES;
  return { spec, line: line[rng.int(line.length)] };
}

/** A rare trait someone has heard of: only when the tank carries its alleles. */
function rareRequest(world: World, rng: Rng): { spec: CreatureSpec; line: string } | null {
  const alive = world.creatures.filter((c) => c.dying === 0 && c.stage !== 'egg');
  const candidates: string[] = [];
  RARE_DEFS.forEach((d, i) => {
    if (d.key === 'specialEyes' || d.key === 'multiTentacle') return;
    if (alive.some((c) => alleleCount(c.genome.rare, i) > 0)) candidates.push(d.key);
  });
  for (const c of alive) for (const k of rareTraitKeys(c.ph.rare)) if (!candidates.includes(k)) candidates.push(k);
  if (!candidates.length) return null;
  const key = candidates[rng.int(candidates.length)];
  return { spec: { rare: [key] }, line: RARE_LINES[rng.int(RARE_LINES.length)] };
}

function ecologyRequest(world: World, rng: Rng, difficulty: 1 | 2 | 3): Condition {
  const pool = consumers(world);
  const species = new Set(world.creatures.filter((c) => c.dying === 0 && c.stage !== 'egg').map((c) => c.speciesId)).size;
  const options: Condition[] = [
    { k: 'hold', seconds: 120 * difficulty, cond: { k: 'population', who: 'consumer', min: Math.max(20, Math.round(pool.length * (1.1 + 0.12 * difficulty))) } },
    { k: 'generation', min: world.counters.generationsMax + 3 * difficulty },
    { k: 'hold', seconds: 300, cond: { k: 'species', min: Math.max(2, species + (difficulty >= 2 ? 1 : 0)) } },
    { k: 'hold', seconds: 180, cond: { k: 'plants', min: Math.min(0.9, Math.round((plantCoverage(world) + 0.05 * difficulty) * 20) / 20) } },
  ];
  if (world.predatorCount > 0) options.push({ k: 'hold', seconds: 300 * difficulty, cond: { k: 'population', who: 'predator', min: 2 + difficulty } });
  if ([...world.history.stories.values()].some((s) => s.watched && s.diedT < 0)) options.push({ k: 'bloodline', min: 2 + difficulty });
  return options[rng.int(options.length)];
}

/** Draw one new request for the shown tank. */
export function drawRequest(world: World, board: RequestBoard, now: number, daily = false): Request {
  const id = `r${board.nextId++}`;
  const rng = new Rng(`request:${id}:${world.seed}:${Math.floor(world.time)}`);
  const difficulty = (daily ? 2 + rng.int(2) : 1 + Math.min(2, rng.int(3))) as 1 | 2 | 3;
  const from = PEOPLE[rng.int(PEOPLE.length)];
  const [lo, hi] = REWARD[difficulty];
  let reward = Math.round(rng.range(lo, hi) / 5) * 5;
  if (daily) reward = Math.round((reward * 1.5) / 5) * 5;
  const roll = rng.next();
  if (roll < 0.62 || difficulty === 1) {
    const r = (difficulty === 3 && rng.chance(0.45) ? rareRequest(world, rng) : null) ?? specRequest(world, rng, difficulty);
    if (r) return { id, kind: 'deliver', from, text: r.line, goal: `一只${describeSpec(r.spec)}`, spec: r.spec, reward, difficulty, daily, createdAt: now };
  }
  const cond = ecologyRequest(world, rng, difficulty);
  return { id, kind: 'ecology', from, text: ECO_LINES[rng.int(ECO_LINES.length)], goal: describeCondition(cond), cond, reward, difficulty, daily, createdAt: now };
}

export function localDate(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Keep three requests open and a fresh daily one each day. */
export function refreshBoard(board: RequestBoard, world: World, now: number): boolean {
  let changed = false;
  const today = localDate(now);
  if (board.dailyDate !== today) {
    board.open = board.open.filter((r) => !r.daily);
    board.open.unshift(distinctRequest(world, board, now, true));
    board.dailyDate = today;
    changed = true;
  }
  while (board.open.filter((r) => !r.daily).length < OPEN_REQUESTS) {
    board.open.push(distinctRequest(world, board, now));
    changed = true;
  }
  return changed;
}

/** A new request that does not repeat a wish already on the board. */
function distinctRequest(world: World, board: RequestBoard, now: number, daily = false): Request {
  let r = drawRequest(world, board, now, daily);
  for (let i = 0; i < 6 && board.open.some((o) => o.goal === r.goal); i++) r = drawRequest(world, board, now, daily);
  return r;
}

/** Living creatures in the tank that would satisfy a delivery request. */
export function candidatesFor(world: World, r: Request): Creature[] {
  if (r.kind !== 'deliver' || !r.spec) return [];
  return world.creatures.filter((c) => matchesSpec(c, r.spec!));
}

/** How an ecology request stands in the shown tank. */
export function ecologyStatus(world: World, board: RequestBoard, r: Request) {
  if (!r.cond) return { met: false, progress: 0, value: 0 };
  const tracker = (board.trackers[r.id] ??= newTracker());
  return evaluate(world, r.cond, tracker, r.id);
}

/** Take a request off the board (done or set aside). */
export function closeRequest(board: RequestBoard, id: string, completed: boolean): void {
  board.open = board.open.filter((r) => r.id !== id);
  delete board.trackers[id];
  if (completed) board.completed++;
}
