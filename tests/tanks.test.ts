import { describe, expect, it } from 'vitest';
import { newProfile, normalizeProfile, PROFILE_KEY, tankLimit, type Profile } from '../src/game/profile';
import { addTank, loadProfile, syncTankInfo, tankRecord, V1_AUTOSAVE } from '../src/game/tanks';
import { MemoryStorage } from '../src/persist/storage';
import { snapshotWorld } from '../src/sim/serialize';
import { World } from '../src/sim/world';
import { stepFor } from './helpers';

describe('player profile and tanks', () => {
  it('starts an empty profile on a first visit', async () => {
    const store = new MemoryStorage();
    const p = await loadProfile(store, 1000);
    expect(p.tanks).toHaveLength(0);
    expect(p.lumen).toBe(0);
    expect(await store.getDoc<Profile>(PROFILE_KEY)).toEqual(p);
  });

  it('turns the first version’s autosaved world into the first tank, once', async () => {
    const store = new MemoryStorage();
    const w = new World({ seed: 'old-world', aspect: 16 / 9 });
    stepFor(w, 20);
    await store.put({
      id: V1_AUTOSAVE,
      name: '自动存档',
      kind: 'auto',
      savedAt: 5000,
      worldName: w.name,
      seed: w.seed,
      simTime: w.time,
      population: 40,
      generation: 0,
      snapshot: snapshotWorld(w),
    });
    const p = await loadProfile(store, 9000);
    expect(p.tanks).toHaveLength(1);
    expect(p.activeTank).toBe('tank-1');
    expect(p.tanks[0]).toMatchObject({ name: w.name, seed: 'old-world', lastWall: 5000, kind: 'main' });
    const rec = await store.get('tank-1');
    expect(rec?.kind).toBe('tank');
    expect(rec?.snapshot.time).toBeCloseTo(w.time, 6);
    expect(await store.get(V1_AUTOSAVE)).toBeUndefined();
    // a second visit reads the profile as it is
    const again = await loadProfile(store, 20000);
    expect(again.tanks.map((t) => t.id)).toEqual(['tank-1']);
    expect(again.nextTankNo).toBe(2);
  });

  it('repairs a partial or older profile', () => {
    const raw = { tanks: [{ id: 'tank-4', name: 'a' }, { bogus: true }], activeTank: 'missing', unlocks: ['tank-slot'] } as unknown as Partial<Profile>;
    const p = normalizeProfile(raw, 1);
    expect(p.tanks).toHaveLength(1);
    expect(p.activeTank).toBe('tank-4');
    expect(p.nextTankNo).toBe(5);
    expect(p.tutorial).toEqual({ step: 0, done: false });
    expect(tankLimit(p)).toBe(tankLimit(newProfile(1)) + 1);
  });

  it('keeps each tank’s summary in step with its world', () => {
    const p = newProfile(0);
    const w = new World({ seed: 'summary-tank', aspect: 16 / 9 });
    const id = addTank(p, w, 100);
    expect(id).toBe('tank-1');
    expect(p.activeTank).toBe(id);
    stepFor(w, 5);
    syncTankInfo(p.tanks[0], w, 200);
    expect(p.tanks[0].lastWall).toBe(200);
    expect(p.tanks[0].simTime).toBeCloseTo(w.time, 6);
    const rec = tankRecord(w, id, 200);
    expect(rec).toMatchObject({ id, kind: 'tank', worldName: w.name, savedAt: 200 });
  });
});
