import { describe, expect, it } from 'vitest';
import { PROFILE_KEY, newProfile, type Profile } from '../src/game/profile';
import { addTank, tankRecord } from '../src/game/tanks';
import { MemoryStorage } from '../src/persist/storage';
import { World } from '../src/sim/world';

describe('atomic tank persistence', () => {
  it('commits both tank snapshots and their profile together without sharing caller objects', async () => {
    const storage = new MemoryStorage();
    const profile = newProfile(0);
    const source = new World({ seed: 'atomic-source', lifeless: true });
    const destination = new World({ seed: 'atomic-destination', lifeless: true });
    const sourceId = addTank(profile, source, 100);
    const destinationId = addTank(profile, destination, 100);
    const records = [tankRecord(source, sourceId, 100), tankRecord(destination, destinationId, 100)];

    await storage.putAll(records, { [PROFILE_KEY]: profile });
    records[0].snapshot.name = 'later change';
    profile.tanks[0].lastWall = 500;

    expect((await storage.get(sourceId))?.snapshot.name).toBe(source.name);
    expect((await storage.get(destinationId))?.snapshot.name).toBe(destination.name);
    expect((await storage.getDoc<Profile>(PROFILE_KEY))?.tanks[0].lastWall).toBe(100);
    const loaded = (await storage.get(sourceId))!;
    loaded.snapshot.name = 'uncommitted read mutation';
    expect((await storage.get(sourceId))?.snapshot.name).toBe(source.name);
  });

  it('leaves both worlds and the profile unchanged if a document cannot be stored', async () => {
    const storage = new MemoryStorage();
    const source = new World({ seed: 'rollback-source', lifeless: true });
    const destination = new World({ seed: 'rollback-destination', lifeless: true });
    const before = [tankRecord(source, 'source', 100), tankRecord(destination, 'destination', 100)];
    await storage.putAll(before, { [PROFILE_KEY]: { lastSeen: 100 } });
    const after = structuredClone(before);
    after[0].snapshot.creatures = [];
    after[0].savedAt = 200;
    after[1].savedAt = 200;
    const circular: { self?: unknown } = {};
    circular.self = circular;

    await expect(storage.putAll(after, { [PROFILE_KEY]: circular })).rejects.toThrow();

    expect(await storage.get('source')).toEqual(before[0]);
    expect(await storage.get('destination')).toEqual(before[1]);
    expect(await storage.getDoc(PROFILE_KEY)).toEqual({ lastSeen: 100 });
  });
});
