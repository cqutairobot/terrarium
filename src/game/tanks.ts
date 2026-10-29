import type { SaveRecord, StorageAdapter } from '../persist/storage';
import { snapshotWorld } from '../sim/serialize';
import type { World } from '../sim/world';
import { newProfile, normalizeProfile, PROFILE_KEY, type Profile, type TankInfo, type TankKind } from './profile';

/** The first version kept a single world under this id. */
export const V1_AUTOSAVE = 'autosave';

export function tankRecordId(n: number): string {
  return `tank-${n}`;
}

function population(world: World): number {
  const counts = world.counts();
  return counts.consumers + counts.predators;
}

/** The storage record for a tank's world. */
export function tankRecord(world: World, id: string, now: number): SaveRecord {
  return {
    id,
    name: world.name,
    kind: 'tank',
    savedAt: now,
    worldName: world.name,
    seed: world.seed,
    simTime: world.time,
    population: population(world),
    generation: world.counters.generationsMax,
    // History snapshots contain mutable collections; queued writes own their copy.
    snapshot: structuredClone(snapshotWorld(world)),
  };
}

/** Keep a tank's summary in the profile in step with its world. */
export function syncTankInfo(info: TankInfo, world: World, now: number): void {
  info.name = world.name;
  info.lastWall = now;
  info.simTime = world.time;
  info.population = population(world);
  info.generation = world.counters.generationsMax;
}

/** Register a new tank in the profile and return its id (the world is saved by the caller). */
export function addTank(profile: Profile, world: World, now: number, kind: TankKind = 'main', biome: string = world.biome): string {
  const id = tankRecordId(profile.nextTankNo++);
  const info: TankInfo = {
    id,
    name: world.name,
    seed: world.seed,
    kind,
    biome,
    createdAt: now,
    lastWall: now,
    simTime: world.time,
    population: population(world),
    generation: world.counters.generationsMax,
  };
  profile.tanks.push(info);
  profile.activeTank = id;
  return id;
}

/**
 * Read the player's profile, creating it on the first visit. A world kept by
 * the first version becomes the player's first tank (written before the old
 * record is removed, so nothing is lost if the page closes halfway).
 */
export async function loadProfile(storage: StorageAdapter, now: number): Promise<Profile> {
  const raw = await storage.getDoc<Profile>(PROFILE_KEY);
  if (raw) return normalizeProfile(raw, now);
  const profile = newProfile(now);
  const old = await storage.get(V1_AUTOSAVE);
  if (old) {
    const id = tankRecordId(profile.nextTankNo++);
    await storage.put({ ...old, id, kind: 'tank', name: old.worldName });
    profile.tanks.push({
      id,
      name: old.worldName,
      seed: old.seed,
      kind: 'main',
      biome: 'shallows',
      createdAt: old.snapshot.createdAt ?? old.savedAt,
      lastWall: old.savedAt,
      simTime: old.simTime,
      population: old.population,
      generation: old.generation,
    });
    profile.activeTank = id;
  }
  await storage.putDoc(PROFILE_KEY, profile);
  if (old) await storage.remove(V1_AUTOSAVE);
  return profile;
}
