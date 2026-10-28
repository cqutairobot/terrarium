import { inCover } from '../behavior/perception';
import type { Creature } from '../entities/creature';
import { cloneGenome, type Genome } from '../genome';
import type { World } from '../world';
import { formatAge } from './narrator';

export type StoryKind =
  | 'born'
  | 'watched'
  | 'named'
  | 'firstMeal'
  | 'parent'
  | 'children'
  | 'disaster'
  | 'escape'
  | 'elder'
  | 'descendants'
  | 'death'
  | 'lineEnd'
  | 'record';

export interface StoryEntry {
  t: number;
  w: number;
  k: StoryKind;
  p: Record<string, string | number>;
}

/** A life followed by the observer (or kept because it set a record). */
export interface LifeStory {
  id: number;
  name: string;
  custom: string | null;
  species: string;
  family: string;
  generation: number;
  hue: number;
  genome: Genome;
  bornT: number;
  bornW: number;
  place: string;
  parents: [number, string, number, string];
  watchedT: number;
  watched: boolean;
  /** Why it was kept automatically (record holder), if so. */
  auto: string | null;
  diedT: number;
  diedW: number;
  cause: string;
  age: number;
  children: number;
  descendants: number;
  /** Living creatures that still carry this bloodline (refreshed every few seconds). */
  living: number;
  maxDepth: number;
  /** Sim time the last descendant died (-1 while the line goes on). */
  lineEnd: number;
  escapes: number;
  events: StoryEntry[];
}

const MAX_EVENTS = 120;

export function displayName(s: LifeStory): string {
  return s.custom || s.name;
}

/** Where a creature was, in words. */
export function placeOf(world: World, x: number, y: number): string {
  if (inCover(world, x, y)) return '水草丛中';
  const floor = world.groundAt(x);
  if (floor - y < 70) return '沙地上方';
  if (y < 220) return '靠近水面的地方';
  return '开阔的水域';
}

export function newStory(world: World, c: Creature, auto: string | null): LifeStory {
  const sp = world.species.get(c.speciesId);
  const fam = world.families.get(c.familyId);
  const nameOf = (id: number) => {
    if (!id) return '';
    const o = world.creatureMap.get(id);
    if (o) return o.customName || o.name;
    const n = world.history.lineage.nodes.get(id);
    return n ? n.name : `#${id}`;
  };
  return {
    id: c.id,
    name: c.name,
    custom: c.customName,
    species: sp?.name ?? '',
    family: fam?.name ?? '',
    generation: c.generation,
    hue: c.ph.rare.golden ? 0.13 : c.ph.hue,
    genome: cloneGenome(c.genome),
    bornT: c.bornT,
    bornW: world.clock() - Math.max(0, world.time - c.bornT) * 1000,
    place: placeOf(world, c.bornX, c.bornY),
    parents: [c.parentA, nameOf(c.parentA), c.parentB, nameOf(c.parentB)],
    watchedT: world.time,
    watched: auto === null,
    auto,
    diedT: -1,
    diedW: 0,
    cause: '',
    age: 0,
    children: c.children,
    descendants: 0,
    living: 0,
    maxDepth: 0,
    lineEnd: -1,
    escapes: c.escapes,
    events: [],
  };
}

export function pushStory(s: LifeStory, e: StoryEntry): void {
  s.events.push(e);
  if (s.events.length > MAX_EVENTS) {
    // keep the beginning of a life and its most recent chapters
    s.events.splice(12, s.events.length - MAX_EVENTS);
  }
}

/** One line of a life's timeline. */
export function narrateStory(s: LifeStory, e: StoryEntry): string {
  const name = displayName(s);
  const p = e.p;
  switch (e.k) {
    case 'born':
      return p.pa ? `出生在${p.place}，父母是${p.pa}与${p.pb}。` : `在${p.place}醒来，没有人知道它从哪里来。`;
    case 'watched':
      return '你开始关注它。';
    case 'named':
      return `你给它取名为「${p.name}」。`;
    case 'firstMeal':
      return '第一次找到了食物。';
    case 'parent':
      return `第一次成为了父母（和${p.mate}一起）。`;
    case 'children':
      return `已经有了 ${p.n} 个孩子。`;
    case 'disaster':
      return p.mood === 2 ? `赶上了一场${p.kind}。` : p.mood === 1 ? `经历了一场${p.kind}。` : `挺过了一场${p.kind}。`;
    case 'escape':
      return Number(p.n ?? 1) > 1 ? `从${p.predator}的追捕中逃脱（${p.n} 次）。` : `从${p.predator}的追捕中逃脱。`;
    case 'elder':
      return '慢慢老了，游得也慢了一些。';
    case 'descendants':
      return `血脉延续到了第 ${p.n} 代后裔。`;
    case 'death':
      return `${p.how ?? `因${p.cause}离开了这个世界`}，享年${p.age}，留下了 ${p.children} 个孩子。`;
    case 'lineEnd':
      return `最后一个后裔也离开了。这条血脉延续了 ${p.n} 代。`;
    case 'record':
      return String(p.text ?? '');
  }
  return name;
}

export const RECORD_LABELS: Record<string, string> = {
  first: '世界的第一个孩子',
  longevity: '有史以来最长寿',
  children: '子女最多的生命',
  last: '族群的最后一只',
};

export function describeLife(s: LifeStory): string {
  if (s.diedT < 0) return `第 ${s.generation} 代 · 在世`;
  return `第 ${s.generation} 代 · 享年${formatAge(s.age)}`;
}
