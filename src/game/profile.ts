import type { Genome } from '../sim/genome';
import { newBoard, type RequestBoard } from './requests';

/** What a tank is for. A nursery is small and has no predators. */
export type TankKind = 'main' | 'nursery';

/** A tank the player keeps; its world lives in storage under `id`. */
export interface TankInfo {
  id: string;
  name: string;
  seed: string;
  kind: TankKind;
  /** Environment preset ('shallows' for the first version's waters). */
  biome: string;
  createdAt: number;
  /** Wall clock when the tank last ran (catch-up starts from here). */
  lastWall: number;
  simTime: number;
  population: number;
  generation: number;
  /** Chronicle entries up to this id have been rewarded. */
  seenEvent?: number;
  /** Sim time up to which this tank's vitality has been paid, and the unpaid fraction. */
  vitalityT?: number;
  vitality?: number;
}

/** A creature's genes kept by the player, to be revived later (or taken into a challenge). */
export interface GeneCard {
  id: string;
  name: string;
  genome: Genome;
  species: string;
  generation: number;
  hue: number;
  savedAt: number;
}

/** Everything the player owns across tanks and challenges (saved apart from any one world). */
export interface Profile {
  version: number;
  createdAt: number;
  /** Wall clock of the last save. */
  lastSeen: number;
  /** 灵光: earned from discoveries, requests and challenges; spent on unlocks. */
  lumen: number;
  lumenEarned: number;
  unlocks: string[];
  tanks: TankInfo[];
  activeTank: string;
  nextTankNo: number;
  geneCards: GeneCard[];
  cardSlots: number;
  requests: RequestBoard;
  tutorial: { step: number; done: boolean };
  levels: Record<string, { stars: number; bestTime?: number; at?: number }>;
  achievements: Record<string, number>;
  flags: Record<string, number>;
}

export const PROFILE_KEY = 'profile';
export const PROFILE_VERSION = 1;
/** How many tanks a player may keep before unlocking more. */
export const BASE_TANK_LIMIT = 3;

export function newProfile(now: number): Profile {
  return {
    version: PROFILE_VERSION,
    createdAt: now,
    lastSeen: now,
    lumen: 0,
    lumenEarned: 0,
    unlocks: [],
    tanks: [],
    activeTank: '',
    nextTankNo: 1,
    geneCards: [],
    cardSlots: 6,
    requests: newBoard(),
    tutorial: { step: 0, done: false },
    levels: {},
    achievements: {},
    flags: {},
  };
}

/** Fill in anything an older (or partial) profile is missing. */
export function normalizeProfile(raw: Partial<Profile> | undefined, now: number): Profile {
  const base = newProfile(now);
  if (!raw || typeof raw !== 'object') return base;
  const p: Profile = { ...base, ...raw, tutorial: { ...base.tutorial, ...(raw.tutorial ?? {}) } };
  p.tanks = Array.isArray(raw.tanks) ? raw.tanks.filter((t) => t && typeof t.id === 'string') : [];
  p.unlocks = Array.isArray(raw.unlocks) ? raw.unlocks.slice() : [];
  p.geneCards = Array.isArray(raw.geneCards) ? raw.geneCards.slice() : [];
  p.levels = { ...(raw.levels ?? {}) };
  p.requests = raw.requests && Array.isArray(raw.requests.open) ? { ...newBoard(), ...raw.requests } : newBoard();
  p.achievements = { ...(raw.achievements ?? {}) };
  p.flags = { ...(raw.flags ?? {}) };
  if (!p.tanks.some((t) => t.id === p.activeTank)) p.activeTank = p.tanks[0]?.id ?? '';
  const highest = p.tanks.reduce((m, t) => Math.max(m, Number(t.id.replace(/\D/g, '')) || 0), 0);
  p.nextTankNo = Math.max(p.nextTankNo || 1, highest + 1);
  p.version = PROFILE_VERSION;
  return p;
}

export function tankLimit(p: Profile): number {
  return BASE_TANK_LIMIT + p.unlocks.filter((u) => u === 'tank-slot').length;
}

/** Ordinary tanks count against the limit; the nursery does not. */
export function mainTankCount(p: Profile): number {
  return p.tanks.filter((t) => t.kind !== 'nursery').length;
}
