import { addTank, loadProfile, tankRecord } from '../game/tanks';
import { PROFILE_KEY, type Profile } from '../game/profile';
import type { StorageAdapter } from '../persist/storage';
import { restoreWorld } from '../sim/serialize';
import { World } from '../sim/world';
import { randomSeed } from './engine';

export interface BootResult {
  profile: Profile;
  world: World;
  tankId: string;
  /** How long the shown tank went unwatched (ms), to be made up for. */
  awayMs: number;
}

/**
 * Open the player's game: their profile, and the tank they last looked at.
 * `?seed=…` or `?new` start a new tank instead; the very first visit (or a
 * missing record) starts one too.
 */
export async function bootGame(storage: StorageAdapter, params: URLSearchParams, aspect: number): Promise<BootResult> {
  const now = Date.now();
  const profile = await loadProfile(storage, now);
  const seed = params.get('seed');
  // ?seed= opens the tank grown from that seed if there is one, so a bookmark does not pile up tanks
  const bySeed = seed ? profile.tanks.find((t) => t.seed === seed) : undefined;
  if (bySeed) profile.activeTank = bySeed.id;
  const wantNew = (!!seed && !bySeed) || params.has('new');
  const info = profile.tanks.find((t) => t.id === profile.activeTank);
  if (!wantNew && info) {
    try {
      const rec = await storage.get(info.id);
      if (rec) return { profile, world: restoreWorld(rec.snapshot), tankId: info.id, awayMs: Math.max(0, now - info.lastWall) };
    } catch {
      /* an unreadable tank: start a fresh one below and keep the record untouched */
    }
  }
  const world = new World({ seed: seed || randomSeed(), aspect });
  const tankId = addTank(profile, world, now);
  await storage.put(tankRecord(world, tankId, now));
  await storage.putDoc(PROFILE_KEY, profile);
  return { profile, world, tankId, awayMs: 0 };
}
