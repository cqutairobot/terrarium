import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CatchUpRunner, type CatchUpResult } from '../src/engine/catchUp';
import { Engine, MAX_CATCH_UP } from '../src/engine/engine';
import type { LevelDef } from '../src/game/levels/types';
import { newProfile, PROFILE_KEY, type Profile } from '../src/game/profile';
import { addTank, tankRecord } from '../src/game/tanks';
import { MemoryStorage, type SaveRecord } from '../src/persist/storage';
import { restoreWorld, snapshotWorld, type WorldSnapshot } from '../src/sim/serialize';
import { addAdult, emptyWorld, herbGenome } from './helpers';

// Keep Engine's real commands, save queue and simulation objects. Only browser
// rendering, input, audio and animation frames are replaced in this Node suite.
vi.mock('../src/render/renderer', () => ({
  Renderer: class {
    selectedId = 0;
    followId = 0;
    quality = 2;
    effects = { handle: vi.fn() };
    setWorld = vi.fn();
    resize = vi.fn();
    render = vi.fn();
  },
}));
vi.mock('../src/engine/input', () => ({ Input: class { dispose = vi.fn(); } }));
vi.mock('../src/audio/ambient', () => ({
  Ambient: class {
    setVolume = vi.fn();
    cue = vi.fn();
    update = vi.fn();
    handle = vi.fn();
    pause = vi.fn();
    resume = vi.fn();
  },
}));
vi.mock('../src/engine/loop', () => ({
  Loop: class {
    timeScale = 1;
    paused = false;
    maxFps = 0;
    start = vi.fn();
    stop = vi.fn();
  },
}));

const NOW = 1_800_000_000_000;
const engines: Engine[] = [];

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

type WriteMatch = (records: SaveRecord[], docs: Record<string, unknown>) => boolean;

/** Delay or fail a transaction before MemoryStorage makes any changes. */
class ControlledStorage extends MemoryStorage {
  writes: { records: SaveRecord[]; docs: Record<string, unknown> }[] = [];
  private intercepts: { match: WriteMatch; before: () => Promise<void> }[] = [];

  async seed(records: SaveRecord[], profile: Profile): Promise<void> {
    await super.putAll(records, { [PROFILE_KEY]: profile });
  }

  holdNext(match: WriteMatch = (records) => records.length > 0) {
    const entered = signal();
    const released = signal();
    this.intercepts.push({
      match,
      before: async () => {
        entered.resolve();
        await released.promise;
      },
    });
    return { entered: entered.promise, release: released.resolve };
  }

  failNext(match: WriteMatch = (records) => records.length > 0): void {
    this.intercepts.push({ match, before: async () => { throw new Error('storage unavailable'); } });
  }

  override async putAll(records: SaveRecord[], docs: Record<string, unknown> = {}): Promise<void> {
    this.writes.push(structuredClone({ records, docs }));
    const index = this.intercepts.findIndex((item) => item.match(records, docs));
    if (index >= 0) {
      const [intercept] = this.intercepts.splice(index, 1);
      await intercept.before();
    }
    await super.putAll(records, docs);
  }

  override async putDoc<T>(key: string, value: T): Promise<void> {
    await this.putAll([], { [key]: value });
  }
}

async function fixture(awayMs = 0) {
  const storage = new ControlledStorage();
  const home = emptyWorld('persist-home');
  home.name = 'Home';
  home.time = 30;
  const traveller = addAdult(home, herbGenome('traveller'), 500, 300);
  traveller.customName = 'New arrival';
  home.rebuildGrids();
  const destination = emptyWorld('persist-destination');
  destination.name = 'Destination';
  destination.time = 200;
  const resident = addAdult(destination, herbGenome('resident'), 520, 300);
  resident.customName = 'Old resident';
  destination.rebuildGrids();
  const profile = newProfile(NOW);
  const homeId = addTank(profile, home, NOW);
  const destinationId = addTank(profile, destination, NOW - awayMs);
  profile.activeTank = homeId;
  for (const [id, world] of [[homeId, home], [destinationId, destination]] as const) {
    Object.assign(profile.tanks.find((info) => info.id === id)!, { seenEvent: 0, vitalityT: world.time, vitality: 0 });
  }
  await storage.seed([tankRecord(home, homeId, NOW), tankRecord(destination, destinationId, NOW - awayMs)], profile);
  const engine = new Engine({} as HTMLCanvasElement, home, storage, { profile, tankId: homeId });
  engines.push(engine);
  return { engine, storage, home, homeId, destination, destinationId, traveller, resident };
}

function advanced(snapshot: WorldSnapshot, seconds: number, discovery = false): CatchUpResult {
  const world = restoreWorld(snapshot);
  world.time += seconds;
  for (const creature of world.creatures) creature.age += seconds;
  if (discovery) world.history.add('speciation', 3, { species: 'Offline discovery' });
  return { snapshot: snapshotWorld(world), simulated: seconds };
}

function catchUpNormally(discovery = false) {
  return vi.spyOn(CatchUpRunner.prototype, 'run').mockImplementation(async (snapshot, plan, onProgress) => {
    onProgress(plan.seconds);
    return advanced(snapshot, plan.seconds, discovery);
  });
}

async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

const level: LevelDef = {
  id: 'persistence-level', chapter: 1, index: 1, name: 'Persistence challenge',
  intro: '', outro: '', seed: 'persistence-level', setup: [],
  goals: [{ cond: { k: 'population', who: 'consumer', min: 1 } }],
  timeLimit: 60, tools: { food: 5 },
  stars: [{ k: 'time', under: 30 }, { k: 'spare', tool: 'food', atLeast: 1 }],
  reward: { lumen: 0 },
};

type LeavingCommand = 'switch' | 'create' | 'level';
function leaveGarden(command: LeavingCommand, engine: Engine, destinationId: string): Promise<void> {
  if (command === 'switch') return engine.switchTank(destinationId);
  if (command === 'create') return engine.createTank('created', 'Created', emptyWorld('created'));
  return engine.startLevel(level);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal('window', {
    innerWidth: 1280, innerHeight: 720,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    setTimeout, clearTimeout,
  });
  vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
});

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('engine persistence queue', () => {
  it('waits for a second save and persists changes made while an autosave is pending', async () => {
    const { engine, storage, homeId } = await fixture();
    const gate = storage.holdNext();
    const autosave = engine.saveActive();
    await gate.entered;
    engine.world.time = 75;
    engine.world.feed('pellet', 500, 100, 3);
    const foods = engine.world.foods.length;
    let secondSettled = false;
    const latest = engine.saveActive().then((ok) => { secondSettled = true; return ok; });
    await drainMicrotasks();
    expect(secondSettled).toBe(false);
    expect(storage.writes).toHaveLength(1);
    gate.release();
    expect(await autosave).toBe(true);
    expect(await latest).toBe(true);
    const saved = await storage.get(homeId);
    expect(saved?.snapshot.time).toBe(75);
    expect(saved?.snapshot.foods).toHaveLength(foods);
    expect((await storage.getDoc<Profile>(PROFILE_KEY))?.tanks.find((tank) => tank.id === homeId)?.simTime).toBe(75);
  });

  it('binds both the snapshot and metadata to the world and tank of each request', async () => {
    const { engine, storage, home, homeId, destination, destinationId } = await fixture();
    const originalName = home.name;
    const gate = storage.holdNext();
    const oldSave = engine.saveActive();
    await gate.entered;
    home.time = 999;
    home.name = 'Changed after the request';
    engine.world = destination;
    engine.tankId = destinationId;
    engine.profile.activeTank = destinationId;
    vi.setSystemTime(NOW + 1000);
    const newSave = engine.saveActive();
    gate.release();
    expect(await oldSave).toBe(true);
    expect(await newSave).toBe(true);
    expect(await storage.get(homeId)).toMatchObject({ worldName: originalName, simTime: 30, savedAt: NOW });
    expect(await storage.get(destinationId)).toMatchObject({ worldName: destination.name, simTime: 200, savedAt: NOW + 1000 });
    const persisted = await storage.getDoc<Profile>(PROFILE_KEY);
    expect(persisted?.tanks.find((tank) => tank.id === homeId)).toMatchObject({ name: originalName, simTime: 30, lastWall: NOW });
    expect(persisted?.tanks.find((tank) => tank.id === destinationId)).toMatchObject({ name: destination.name, simTime: 200, lastWall: NOW + 1000 });
  });

  it('continues processing queued requests after a failed write', async () => {
    const { engine, storage, homeId } = await fixture();
    storage.failNext();
    const failed = engine.saveActive();
    engine.world.time = 90;
    const retry = engine.saveActive();
    expect(await failed).toBe(false);
    expect(await retry).toBe(true);
    expect((await storage.get(homeId))?.snapshot.time).toBe(90);
  });

  it('freezes an in-flight snapshot and its reward cursor before later history events', async () => {
    const { engine, storage, homeId } = await fixture();
    const gate = storage.holdNext();
    const autosave = engine.saveActive();
    await gate.entered;
    engine.world.time = 90;
    engine.world.history.add('speciation', 3, { species: 'After the write started' });
    gate.release();
    expect(await autosave).toBe(true);
    const saved = (await storage.get(homeId))!;
    expect(saved.snapshot.time).toBe(30);
    expect(restoreWorld(saved.snapshot).history.chronicle).toHaveLength(0);
    const persisted = (await storage.getDoc<Profile>(PROFILE_KEY))!;
    expect(persisted.lumen).toBe(0);
    expect(persisted.tanks.find((tank) => tank.id === homeId)).toMatchObject({ seenEvent: 0, vitalityT: 30 });
  });

  it('captures queued world changes, history and reward cursors together when its write starts', async () => {
    const { engine, storage, homeId } = await fixture();
    const gate = storage.holdNext();
    const autosave = engine.saveActive();
    await gate.entered;
    engine.world.time = 60;
    engine.world.history.add('speciation', 3, { species: 'Before the queued request' });
    const queued = engine.saveActive();
    engine.world.time = 90;
    const latestEvent = engine.world.history.add('speciation', 3, { species: 'Before the queued write' });
    gate.release();
    expect(await autosave).toBe(true);
    expect(await queued).toBe(true);
    const saved = (await storage.get(homeId))!;
    expect(saved.snapshot.time).toBe(90);
    expect(restoreWorld(saved.snapshot).history.chronicle.map((event) => event.p.species)).toEqual([
      'Before the queued request', 'Before the queued write',
    ]);
    const persisted = (await storage.getDoc<Profile>(PROFILE_KEY))!;
    expect(persisted.lumen).toBe(30);
    expect(persisted.tanks.find((tank) => tank.id === homeId)).toMatchObject({
      seenEvent: latestEvent.id, vitalityT: saved.snapshot.time, simTime: saved.snapshot.time,
    });
  });

  it('does not persist a later failed save’s reward cursor and pays the next discovery after reload', async () => {
    const { engine, storage, homeId } = await fixture();
    const firstGate = storage.holdNext();
    const autosave = engine.saveActive();
    await firstGate.entered;
    engine.world.time = 60;
    engine.world.history.add('speciation', 3, { species: 'First discovery' });
    const queued = engine.saveActive();
    engine.world.time = 90;
    const secondEvent = engine.world.history.add('speciation', 3, { species: 'Second discovery' });
    const secondGate = storage.holdNext();
    firstGate.release();
    await secondGate.entered;
    expect(await autosave).toBe(true);

    // The second write is already frozen. A third write will see this event,
    // but its failure must not advance the second transaction's saved cursor.
    engine.world.time = 120;
    const unsavedEvent = engine.world.history.add('speciation', 3, { species: 'Unsaved discovery' });
    storage.failNext();
    const failed = engine.saveActive();
    secondGate.release();
    expect(await queued).toBe(true);
    expect(await failed).toBe(false);
    const saved = (await storage.get(homeId))!;
    const profile = (await storage.getDoc<Profile>(PROFILE_KEY))!;
    expect(saved.snapshot.time).toBe(90);
    expect(restoreWorld(saved.snapshot).history.chronicle.map((event) => event.id)).toEqual([1, secondEvent.id]);
    expect(profile.lumen).toBe(30);
    expect(profile.tanks.find((tank) => tank.id === homeId)).toMatchObject({ seenEvent: secondEvent.id, vitalityT: 90 });

    const reloaded = new Engine({} as HTMLCanvasElement, restoreWorld(saved.snapshot), storage, { profile, tankId: homeId });
    engines.push(reloaded);
    reloaded.world.time = 120;
    const nextEvent = reloaded.world.history.add('speciation', 3, { species: 'Discovery after reload' });
    expect(nextEvent.id).toBe(unsavedEvent.id);
    expect(await reloaded.saveActive()).toBe(true);
    expect(reloaded.profile.lumen).toBe(45);
    expect((await storage.getDoc<Profile>(PROFILE_KEY))?.tanks.find((tank) => tank.id === homeId)?.seenEvent).toBe(nextEvent.id);
  });

  it.each<LeavingCommand>(['switch', 'create', 'level'])('does not %s away from a garden whose required save fails', async (command) => {
    const { engine, storage, home, homeId, destinationId } = await fixture();
    const tankIds = engine.profile.tanks.map((tank) => tank.id);
    storage.failNext();
    await leaveGarden(command, engine, destinationId);
    expect(engine.world).toBe(home);
    expect(engine.tankId).toBe(homeId);
    expect(engine.profile.activeTank).toBe(homeId);
    expect(engine.profile.tanks.map((tank) => tank.id)).toEqual(tankIds);
    expect(engine.level).toBeNull();
    expect(engine.busy).toBe(false);
    expect(engine.toasts.some((toast) => toast.text.includes('保存'))).toBe(true);
  });

  it.each<LeavingCommand>(['switch', 'create', 'level'])('waits for a pending autosave and a fresh garden save before %s', async (command) => {
    const { engine, storage, home, homeId, destinationId } = await fixture();
    const gate = storage.holdNext();
    const autosave = engine.saveActive();
    await gate.entered;
    home.time = 80;
    home.feed('pellet', 500, 100, 2);
    const foodCount = home.foods.length;
    let settled = false;
    const leaving = leaveGarden(command, engine, destinationId).then(() => { settled = true; });
    await drainMicrotasks();
    expect(settled).toBe(false);
    expect(engine.world).toBe(home);
    gate.release();
    expect(await autosave).toBe(true);
    await leaving;
    expect(engine.world).not.toBe(home);
    expect((await storage.get(homeId))?.snapshot).toMatchObject({ seed: home.seed, time: 80 });
    expect((await storage.get(homeId))?.snapshot.foods).toHaveLength(foodCount);
    expect(engine.profile.tanks.find((tank) => tank.id === homeId)?.simTime).toBe(80);
    if (command === 'level') expect(engine.level?.def.id).toBe(level.id);
  });
});

describe('moving between tanks and offline time', () => {
  it('catches up only existing residents before arrival, caps the interval, and does not replay it on switching', async () => {
    const { engine, storage, homeId, destination, destinationId, traveller, resident } = await fixture(9_000_000);
    const runner = catchUpNormally();
    const age = traveller.age;
    const bornAgo = engine.world.time - traveller.bornT;
    await engine.moveCreature(traveller.id, destinationId);
    expect(runner).toHaveBeenCalledTimes(1);
    const [input, plan] = runner.mock.calls[0];
    expect(input.creatures.map((creature) => creature.customName)).toEqual(['Old resident']);
    expect(plan.seconds).toBe(MAX_CATCH_UP);
    const saved = (await storage.get(destinationId))!;
    const arrived = saved.snapshot.creatures.find((creature) => creature.customName === 'New arrival')!;
    expect(arrived.age).toBe(age);
    expect(saved.snapshot.time - arrived.bornT).toBe(bornAgo);
    expect(saved.snapshot.creatures.find((creature) => creature.customName === 'Old resident')?.age).toBe(resident.age + MAX_CATCH_UP);
    expect(saved.snapshot.time).toBe(destination.time + MAX_CATCH_UP);
    expect((await storage.get(homeId))?.snapshot.creatures).toHaveLength(0);
    expect(saved.population).toBe(2);
    expect((await storage.get(homeId))?.population).toBe(0);
    expect(engine.profile.tanks.find((tank) => tank.id === destinationId)).toMatchObject({ lastWall: NOW, simTime: saved.snapshot.time, population: 2 });
    await engine.switchTank(destinationId);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(engine.world.creatures.find((creature) => creature.customName === 'New arrival')?.age).toBe(age);
  });

  it.each([
    { offlineProgress: false, awayMs: 3_600_000 },
    { offlineProgress: true, awayMs: 59_999 },
  ])('moves without advancing when offlineProgress=$offlineProgress and awayMs=$awayMs, while consuming the old absence', async ({ offlineProgress, awayMs }) => {
    const { engine, storage, destination, destinationId, traveller } = await fixture(awayMs);
    const runner = catchUpNormally();
    engine.prefs.offlineProgress = offlineProgress;
    await engine.moveCreature(traveller.id, destinationId);
    expect(runner).not.toHaveBeenCalled();
    expect((await storage.get(destinationId))?.snapshot.time).toBe(destination.time);
    expect(engine.profile.tanks.find((tank) => tank.id === destinationId)?.lastWall).toBe(NOW);
    expect((await storage.getDoc<Profile>(PROFILE_KEY))?.tanks.find((tank) => tank.id === destinationId)?.lastWall).toBe(NOW);
    engine.prefs.offlineProgress = true;
    await engine.switchTank(destinationId);
    expect(runner).not.toHaveBeenCalled();
    expect(engine.world.creatures.find((creature) => creature.customName === 'New arrival')?.age).toBe(traveller.age);
  });

  it('can stop destination catch-up early and records arrival after the skipped absence', async () => {
    const { engine, storage, destinationId, traveller, resident } = await fixture(3_600_000);
    const entered = signal();
    const finished = signal();
    const runner = vi.spyOn(CatchUpRunner.prototype, 'run').mockImplementation(async (snapshot, _plan, onProgress) => {
      onProgress(5);
      entered.resolve();
      await finished.promise;
      return advanced(snapshot, 5);
    });
    const stop = vi.spyOn(CatchUpRunner.prototype, 'stop').mockImplementation(finished.resolve);
    const moving = engine.moveCreature(traveller.id, destinationId);
    await entered.promise;
    expect(engine.catchUp?.done).toBe(5);
    engine.skipCatchUp();
    expect(engine.catchUp?.stopping).toBe(true);
    vi.setSystemTime(NOW + 1000);
    await moving;
    expect(stop).toHaveBeenCalledOnce();
    const saved = (await storage.get(destinationId))!;
    expect(saved.snapshot.time).toBe(205);
    expect(saved.snapshot.creatures.find((creature) => creature.customName === 'Old resident')?.age).toBe(resident.age + 5);
    expect(saved.snapshot.creatures.find((creature) => creature.customName === 'New arrival')?.age).toBe(traveller.age);
    expect(engine.profile.tanks.find((tank) => tank.id === destinationId)?.lastWall).toBe(NOW + 1000);
    await engine.switchTank(destinationId);
    expect(runner).toHaveBeenCalledOnce();
  });

  it('honors a skip requested while the initial source save is still pending', async () => {
    const { engine, storage, destinationId, traveller } = await fixture(3_600_000);
    const runner = catchUpNormally();
    const stop = vi.spyOn(CatchUpRunner.prototype, 'stop').mockImplementation(() => undefined);
    const gate = storage.holdNext();
    const moving = engine.moveCreature(traveller.id, destinationId);
    await gate.entered;
    expect(engine.catchUp?.target).toBe(0);
    engine.skipCatchUp();
    expect(engine.catchUp?.stopping).toBe(true);
    gate.release();
    await moving;
    expect(stop).toHaveBeenCalledOnce();
    expect(runner).not.toHaveBeenCalled();
    const destination = (await storage.get(destinationId))!;
    expect(destination.snapshot.time).toBe(200);
    expect(destination.snapshot.creatures.find((creature) => creature.customName === 'New arrival')?.age).toBe(traveller.age);
    expect(engine.profile.tanks.find((tank) => tank.id === destinationId)?.lastWall).toBe(NOW);
  });

  it('leaves both stored tanks and the live source unchanged when destination catch-up fails', async () => {
    const { engine, storage, home, homeId, destinationId, traveller } = await fixture(3_600_000);
    const homeBefore = structuredClone(await storage.get(homeId));
    const destinationBefore = structuredClone(await storage.get(destinationId));
    vi.spyOn(CatchUpRunner.prototype, 'run').mockRejectedValue(new Error('catch-up failed'));
    await engine.moveCreature(traveller.id, destinationId);
    expect(engine.world).toBe(home);
    expect(engine.world.creatureMap.get(traveller.id)).toBe(traveller);
    expect(await storage.get(homeId)).toEqual(homeBefore);
    expect(await storage.get(destinationId)).toEqual(destinationBefore);
    expect(engine.catchUp).toBeNull();
    expect(engine.busy).toBe(false);
  });

  it('atomically keeps the creature at home if the migration commit fails, without granting destination rewards', async () => {
    const { engine, storage, home, homeId, destinationId, traveller } = await fixture(3_600_000);
    const homeBefore = structuredClone(await storage.get(homeId));
    const destinationBefore = structuredClone(await storage.get(destinationId));
    const profileBefore = await storage.getDoc<Profile>(PROFILE_KEY);
    catchUpNormally(true);
    storage.failNext((records) => records.length === 2);
    await engine.moveCreature(traveller.id, destinationId);
    expect(engine.world).toBe(home);
    expect(engine.world.creatureMap.get(traveller.id)).toBe(traveller);
    expect(await storage.get(homeId)).toEqual(homeBefore);
    expect(await storage.get(destinationId)).toEqual(destinationBefore);
    expect(await storage.getDoc<Profile>(PROFILE_KEY)).toEqual(profileBefore);
    expect(engine.profile.lumen).toBe(0);
    expect(engine.profile.tanks.find((tank) => tank.id === destinationId)?.seenEvent).toBe(0);
    expect(engine.catchUp).toBeNull();
    expect(engine.busy).toBe(false);
  });

  it('does not start migration or catch-up when saving the source fails', async () => {
    const { engine, storage, home, destinationId, traveller } = await fixture(3_600_000);
    const destinationBefore = structuredClone(await storage.get(destinationId));
    const runner = catchUpNormally();
    storage.failNext();
    await engine.moveCreature(traveller.id, destinationId);
    expect(runner).not.toHaveBeenCalled();
    expect(engine.world).toBe(home);
    expect(home.creatureMap.get(traveller.id)).toBe(traveller);
    expect(await storage.get(destinationId)).toEqual(destinationBefore);
  });

  it('serializes migration behind an in-flight autosave and never restores a duplicate at the source', async () => {
    const { engine, storage, home, homeId, destinationId, traveller } = await fixture(3_600_000);
    const runner = catchUpNormally();
    const gate = storage.holdNext();
    const autosave = engine.saveActive();
    await gate.entered;
    home.time = 50;
    home.feed('pellet', 500, 100, 3);
    const foodCount = home.foods.length;
    const moving = engine.moveCreature(traveller.id, destinationId);
    await drainMicrotasks();
    expect(engine.world).toBe(home);
    expect(runner).not.toHaveBeenCalled();
    gate.release();
    expect(await autosave).toBe(true);
    await moving;
    expect(await engine.saveActive()).toBe(true);
    const source = (await storage.get(homeId))!;
    const destination = (await storage.get(destinationId))!;
    expect(source.snapshot.time).toBe(50);
    expect(source.snapshot.foods).toHaveLength(foodCount);
    expect(source.snapshot.creatures.filter((creature) => creature.customName === 'New arrival')).toHaveLength(0);
    expect(destination.snapshot.creatures.filter((creature) => creature.customName === 'New arrival')).toHaveLength(1);
    expect(runner.mock.calls[0][0].creatures.map((creature) => creature.customName)).toEqual(['Old resident']);
  });

  it('keeps source edits blocked until the migration transaction is committed', async () => {
    const { engine, storage, home, destinationId, traveller } = await fixture();
    const gate = storage.holdNext((records) => records.length === 2);
    const moving = engine.moveCreature(traveller.id, destinationId);
    await gate.entered;
    expect(engine.world).toBe(home);
    expect(home.creatureMap.get(traveller.id)).toBe(traveller);
    expect(engine.catchUp).not.toBeNull();
    const before = snapshotWorld(home);
    engine.feedAt(500, 100, 3);
    await engine.release(traveller.id);
    expect(snapshotWorld(home)).toEqual(before);
    gate.release();
    await moving;
    expect(engine.world.creatureMap.has(traveller.id)).toBe(false);
  });

  it('does not restart the source loop when the tab returns during a pending migration', async () => {
    const { engine, storage, home, destinationId, traveller } = await fixture();
    const gate = storage.holdNext((records) => records.length === 2);
    const moving = engine.moveCreature(traveller.id, destinationId);
    await gate.entered;
    const visibility = vi.mocked(document.addEventListener).mock.calls.find((call) => call[0] === 'visibilitychange')?.[1];
    if (typeof visibility !== 'function') throw new Error('Engine did not register its visibility handler');
    Object.assign(document, { hidden: true });
    visibility(new Event('visibilitychange'));
    vi.setSystemTime(NOW + 1000);
    Object.assign(document, { hidden: false });
    visibility(new Event('visibilitychange'));
    await drainMicrotasks();
    expect(engine.catchUp).not.toBeNull();
    expect(engine.world).toBe(home);
    expect(engine.loop.start).not.toHaveBeenCalled();
    gate.release();
    await moving;
    expect(engine.loop.start).toHaveBeenCalledOnce();
    expect(engine.world.creatureMap.has(traveller.id)).toBe(false);
  });

  it('pays destination discoveries once and persists its event and vitality cursors', async () => {
    const { engine, storage, destinationId, traveller } = await fixture(3_600_000);
    catchUpNormally(true);
    await engine.moveCreature(traveller.id, destinationId);
    const earned = engine.profile.lumen;
    expect(earned).toBeGreaterThanOrEqual(15);
    const destination = (await storage.get(destinationId))!;
    const world = restoreWorld(destination.snapshot);
    const lastId = world.history.chronicle.at(-1)!.id;
    const persisted = await storage.getDoc<Profile>(PROFILE_KEY);
    expect(persisted?.lumen).toBe(earned);
    expect(persisted?.tanks.find((tank) => tank.id === destinationId)).toMatchObject({ seenEvent: lastId, vitalityT: world.time });
    await engine.switchTank(destinationId);
    expect(await engine.saveActive()).toBe(true);
    expect(engine.profile.lumen).toBe(earned);
    expect((await storage.getDoc<Profile>(PROFILE_KEY))?.lumen).toBe(earned);
  });

  it('retains a completed transfer if the later reward-profile write fails and persists rewards on retry', async () => {
    const { engine, storage, homeId, destinationId, traveller } = await fixture(3_600_000);
    catchUpNormally(true);
    storage.failNext((records) => records.length === 0);
    await engine.moveCreature(traveller.id, destinationId);
    const earned = engine.profile.lumen;
    expect(earned).toBeGreaterThanOrEqual(15);
    expect((await storage.get(homeId))?.snapshot.creatures).toHaveLength(0);
    expect((await storage.get(destinationId))?.snapshot.creatures.filter((creature) => creature.customName === 'New arrival')).toHaveLength(1);
    expect(await engine.saveActive()).toBe(true);
    expect((await storage.getDoc<Profile>(PROFILE_KEY))?.lumen).toBe(earned);
    await engine.switchTank(destinationId);
    expect(await engine.saveActive()).toBe(true);
    expect(engine.profile.lumen).toBe(earned);
  });
});
