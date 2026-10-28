import { hash32 } from '../../sim/core/rng';
import type { Profile } from '../profile';
import { CHAPTER_1 } from './chapter1';
import type { LevelDef } from './types';

export const CHAPTERS: { id: number; name: string; levels: LevelDef[] }[] = [{ id: 1, name: '浅滩', levels: CHAPTER_1 }];

export const LEVELS: LevelDef[] = CHAPTERS.flatMap((c) => c.levels);

export function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id) ?? (id.startsWith('daily-') ? dailyLevel(id.slice(6)) : undefined);
}

export function starsOf(p: Profile, id: string): number {
  return p.levels[id]?.stars ?? 0;
}

/** Levels open one after another: each needs the one before it cleared. */
export function levelUnlocked(p: Profile, def: LevelDef): boolean {
  if (def.id.startsWith('daily-')) return dailyUnlocked(p);
  const chapter = CHAPTERS.find((c) => c.id === def.chapter);
  const i = chapter?.levels.indexOf(def) ?? -1;
  return i <= 0 || starsOf(p, chapter!.levels[i - 1].id) > 0;
}

/** The next level of the same chapter, if there is one. */
export function nextLevel(def: LevelDef): LevelDef | undefined {
  const chapter = CHAPTERS.find((c) => c.id === def.chapter);
  const i = chapter?.levels.indexOf(def) ?? -1;
  return i >= 0 ? chapter!.levels[i + 1] : undefined;
}

/** Levels whose daily versions stay fair on any seed (checked by the bots). */
const DAILY_BASES = ['1-1', '1-2', '1-3', '1-4', '1-6', '1-7'];
/** The daily challenge opens once the basics are learned. */
const DAILY_AFTER = '1-3';

export function dailyUnlocked(p: Profile): boolean {
  return starsOf(p, DAILY_AFTER) > 0;
}

/**
 * Today's challenge: one of the first chapter's ideas in a tank grown from
 * the date, so everyone playing on the same day meets the same water.
 */
export function dailyLevel(date: string): LevelDef {
  const pick = Math.floor(hash32(Number(date.replace(/\D/g, '')) || 1) * DAILY_BASES.length);
  const base = CHAPTER_1.find((l) => l.id === DAILY_BASES[pick])!;
  return {
    ...structuredClone(base),
    id: `daily-${date}`,
    chapter: 0,
    index: 0,
    name: base.name,
    seed: `daily-${date}`,
    reward: { lumen: 45 },
  };
}
