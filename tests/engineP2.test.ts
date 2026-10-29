import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/engine/engine';
import type { LevelDef } from '../src/game/levels/types';
import { mainTankCount, newProfile, PROFILE_KEY, type Profile, type TankKind } from '../src/game/profile';
import { ecologyStatus, type Request } from '../src/game/requests';
import { addTank, tankRecord } from '../src/game/tanks';
import { MemoryStorage } from '../src/persist/storage';
import { BIOMES, type BiomeId } from '../src/sim/biomes';
import { DEFAULT_CONFIG, DEFAULT_SETTINGS } from '../src/sim/config';
import { World } from '../src/sim/world';
import { WorldPanel } from '../src/ui/components/WorldPanel';
import { addAdult, emptyWorld, herbGenome } from './helpers';

// Exercise the real Engine, fixed-step Loop and simulation. These browser-only
// boundaries do not participate in the state transitions covered below.
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

const NOW = 1_800_000_000_000;
const engines: Engine[] = [];
let frames: Map<number, FrameRequestCallback>;
let nextFrameId: number;
let frameTime: number;

/** Each callback schedules the following frame through the real Loop. */
function advanceFrames(count = 60): void {
  for (let i = 0; i < count; i++) {
    frameTime += 1000 / 60;
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(frameTime);
  }
}

async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

async function fixture(world = emptyWorld('p2-home'), kind: TankKind = 'main') {
  const storage = new MemoryStorage();
  const profile = newProfile(NOW);
  const tankId = addTank(profile, world, NOW, kind);
  Object.assign(profile.tanks[0], { seenEvent: 0, vitalityT: world.time, vitality: 0 });
  await storage.put(tankRecord(world, tankId, NOW));
  await storage.putDoc(PROFILE_KEY, profile);
  const engine = new Engine({} as HTMLCanvasElement, world, storage, { profile, tankId });
  engines.push(engine);
  return { engine, storage, profile, tankId };
}

async function fillMainTanks(engine: Engine): Promise<void> {
  while (engine.canAddTank()) {
    const w = emptyWorld(`extra-${engine.profile.nextTankNo}`);
    const id = addTank(engine.profile, w, NOW);
    await engine.storage.put(tankRecord(w, id, NOW));
  }
  engine.profile.activeTank = engine.tankId;
}

const level: LevelDef = {
  id: 'p2-intro', chapter: 1, index: 1, name: 'A quiet introduction',
  intro: 'Read before beginning.', outro: '', seed: 'p2-intro',
  setup: [{ k: 'founders', arch: 'schooler', count: 2, adult: true }],
  goals: [{ cond: { k: 'population', who: 'consumer', min: 9999 } }],
  timeLimit: 60, tools: { food: 5 },
  stars: [{ k: 'time', under: 30 }, { k: 'spare', tool: 'food', atLeast: 1 }],
  reward: { lumen: 0 },
};

function holdRequest(): Request {
  return {
    id: 'p2-continuous-hold', kind: 'ecology', from: 'An observer', text: '', goal: 'Observe for five minutes',
    cond: { k: 'hold', cond: { k: 'population', who: 'all', min: 0 }, seconds: 300 },
    reward: 10, difficulty: 1, createdAt: NOW,
  };
}

function simulationState(engine: Engine) {
  return {
    time: engine.world.time,
    energy: engine.world.creatures.map((c) => c.energy),
    ages: engine.world.creatures.map((c) => c.age),
    elapsed: engine.level?.elapsed(engine.world),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  frames = new Map();
  nextFrameId = 1;
  frameTime = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
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

describe('resetting the current tank', () => {
  it.each<BiomeId>(['shallows', 'abyss', 'reef'])('recreates %s from its biome defaults and preserves its identity', async (biome) => {
    const original = new World({ seed: `reset-${biome}`, aspect: 2.1, name: 'My original tank', biome });
    const { engine, storage, profile, tankId } = await fixture(original);
    profile.unlocks = ['nursery', 'biome:abyss', 'lens'];
    profile.lumen = 143;
    profile.lumenEarned = 301;
    profile.flags['remembered-discovery'] = 1;
    Object.assign(profile.tanks[0], { biome: 'shallows', seenEvent: 999, vitalityT: 3600, vitality: 0.8 });
    original.time = 3600;
    original.cfg.wildLife = false;
    original.cfg.maxPredators = 0;
    original.env.settings.temperature = 0.99;
    original.env.settings.light = 0.01;

    engine.resetWorld();
    await drainMicrotasks();

    const reset = engine.world;
    expect(reset).not.toBe(original);
    expect(reset).toMatchObject({ seed: original.seed, name: original.name, width: original.width, height: original.height, biome, time: 0 });
    expect(reset.cfg.wildLife).toBe(DEFAULT_CONFIG.wildLife);
    expect(reset.cfg.maxPredators).toBe(DEFAULT_CONFIG.maxPredators);
    expect(reset.env.settings).toEqual({ ...DEFAULT_SETTINGS, ...BIOMES[biome].settings });
    expect(reset.creatures.length).toBeGreaterThan(0);
    expect(profile.tanks[0]).toMatchObject({ id: tankId, kind: 'main', biome, simTime: 0, seenEvent: 0, vitalityT: 0, vitality: 0 });
    expect(profile).toMatchObject({ lumen: 143, lumenEarned: 301, unlocks: ['nursery', 'biome:abyss', 'lens'], flags: { 'remembered-discovery': 1 } });
    expect((await storage.get(tankId))?.snapshot).toMatchObject({ biome, seed: original.seed, time: 0 });
    expect((await storage.getDoc<Profile>(PROFILE_KEY))?.tanks[0]).toMatchObject({ biome, seenEvent: 0, vitalityT: 0, vitality: 0 });

    // A reused low event id belongs to the new timeline and can earn rewards.
    reset.history.add('speciation', 3, { species: 'New beginning' });
    expect(await engine.saveActive()).toBe(true);
    expect(profile.lumen).toBe(158);
  });

  it('uses the tank kind to reset a nursery with plants and no animal life', async () => {
    // Nursery metadata is authoritative even if an imported world had ordinary
    // wildlife settings and residents before the reset.
    const original = new World({ seed: 'nursery-reset', aspect: 1.3, name: 'Breeding room', biome: 'reef' });
    const { engine, profile } = await fixture(original, 'nursery');
    profile.unlocks = ['nursery'];
    Object.assign(profile.tanks[0], { seenEvent: 900, vitalityT: 300, vitality: 0.4 });
    original.time = 300;

    engine.resetWorld();
    await drainMicrotasks();

    expect(engine.world).toMatchObject({ seed: original.seed, name: original.name, width: original.width, height: original.height, biome: 'reef', time: 0 });
    expect(engine.world.cfg).toMatchObject({ wildLife: false, maxPredators: 0 });
    expect(engine.world.creatures).toHaveLength(0);
    expect(engine.world.producers.some((p) => p.kind === 'plant')).toBe(true);
    expect(profile.tanks[0]).toMatchObject({ kind: 'nursery', biome: 'reef', seenEvent: 0, vitalityT: 0, vitality: 0 });
    engine.start();
    engine.setTimeScale(5);
    advanceFrames(120);
    expect(engine.world.time).toBeGreaterThan(5);
    expect(engine.world.creatures).toHaveLength(0);
  });
});

describe('ecology observations follow the engine timeline', () => {
  it('binds observations from the real economy tick to the active tank storage id', async () => {
    const { engine, profile, tankId } = await fixture();
    const request = holdRequest();
    profile.requests.open = [request];
    engine.start();

    advanceFrames(75);

    expect(profile.requests.trackers[request.id]).toMatchObject({ tankId });
    expect(profile.requests.trackers[request.id].lastTime).toBeGreaterThan(0);
  });

  it('clears and persists the reset tank’s old hold before observing its new beginning', async () => {
    const { engine, storage, profile, tankId } = await fixture();
    const request = holdRequest();
    profile.requests.open = [request];
    engine.world.time = 100;
    ecologyStatus(engine.world, profile.requests, request, tankId);
    engine.world.time = 200;
    expect(ecologyStatus(engine.world, profile.requests, request, tankId).value).toBe(100);

    engine.resetWorld();
    await drainMicrotasks();

    expect(profile.requests.trackers[request.id]).toBeUndefined();
    expect((await storage.getDoc<Profile>(PROFILE_KEY))?.requests.trackers[request.id]).toBeUndefined();
    expect(ecologyStatus(engine.world, profile.requests, request, tankId).value).toBe(0);
    engine.world.time = 299;
    expect(ecologyStatus(engine.world, profile.requests, request, tankId).met).toBe(false);
    engine.world.time = 300;
    expect(ecologyStatus(engine.world, profile.requests, request, tankId).met).toBe(true);
  });

  it.each([150, 250])('starts a fresh hold after restoring a same-tank snapshot at time %s', async (snapshotTime) => {
    const { engine, storage, profile, tankId } = await fixture();
    const request = holdRequest();
    profile.requests.open = [request];
    engine.world.time = snapshotTime;
    await storage.put({ ...tankRecord(engine.world, 'manual-timeline', NOW), kind: 'manual', tankId });
    engine.world.time = 100;
    ecologyStatus(engine.world, profile.requests, request, tankId);
    engine.world.time = 200;
    expect(ecologyStatus(engine.world, profile.requests, request, tankId).value).toBe(100);

    await engine.load('manual-timeline');

    expect(engine.tankId).toBe(tankId);
    expect(engine.world.time).toBe(snapshotTime);
    expect(profile.requests.trackers[request.id]).toBeUndefined();
    expect((await storage.getDoc<Profile>(PROFILE_KEY))?.requests.trackers[request.id]).toBeUndefined();
    expect(ecologyStatus(engine.world, profile.requests, request, tankId).value).toBe(0);
    engine.world.time = snapshotTime + 299;
    expect(ecologyStatus(engine.world, profile.requests, request, tankId).met).toBe(false);
    engine.world.time = snapshotTime + 300;
    expect(ecologyStatus(engine.world, profile.requests, request, tankId).met).toBe(true);
  });

  it('does not reuse a garden’s old observation after switching away and back without evaluating the other tank', async () => {
    const { engine, storage, profile, tankId } = await fixture();
    const other = emptyWorld(engine.world.seed);
    other.createdAt = engine.world.createdAt;
    other.time = 1000;
    const otherId = addTank(profile, other, NOW);
    profile.activeTank = tankId;
    await storage.put(tankRecord(other, otherId, NOW));
    const request = holdRequest();
    profile.requests.open = [request];
    engine.world.time = 100;
    ecologyStatus(engine.world, profile.requests, request, tankId);
    engine.world.time = 200;
    expect(ecologyStatus(engine.world, profile.requests, request, tankId).value).toBe(100);

    await engine.switchTank(otherId);
    expect(profile.requests.trackers[request.id]).toBeUndefined();
    await engine.switchTank(tankId);

    expect(engine.world.time).toBe(200);
    expect(profile.requests.trackers[request.id]).toBeUndefined();
    expect((await storage.getDoc<Profile>(PROFILE_KEY))?.requests.trackers[request.id]).toBeUndefined();
    expect(ecologyStatus(engine.world, profile.requests, request, tankId).value).toBe(0);
  });

  it('clears a previous hold after a real catch-up triggered by a long frame gap', async () => {
    const { engine, storage, profile, tankId } = await fixture();
    engine.world.cfg.wildLife = false;
    const request = holdRequest();
    profile.requests.open = [request];
    engine.world.time = 100;
    ecologyStatus(engine.world, profile.requests, request, tankId);
    engine.world.time = 200;
    expect(ecologyStatus(engine.world, profile.requests, request, tankId).value).toBe(100);
    engine.start();
    advanceFrames(1);

    frameTime += 61_000;
    advanceFrames(1);
    await vi.runAllTimersAsync();

    expect(engine.catchUp).toBeNull();
    expect(engine.world.time).toBeGreaterThan(260);
    expect(profile.requests.trackers[request.id]).toBeUndefined();
    expect((await storage.getDoc<Profile>(PROFILE_KEY))?.requests.trackers[request.id]).toBeUndefined();
    expect(ecologyStatus(engine.world, profile.requests, request, tankId).value).toBe(0);
  });
});

describe('preparing the nursery again', () => {
  it('deletes and freely recreates a nursery when ordinary tanks are full, keeping the active garden', async () => {
    const { engine, storage, profile, tankId } = await fixture();
    profile.unlocks.push('nursery');
    profile.lumen = 127;
    await fillMainTanks(engine);
    const activeWorld = engine.world;
    const ordinaryIds = profile.tanks.map((t) => t.id);
    expect(engine.canAddTank()).toBe(false);
    await engine.createNursery();
    const originalId = engine.nursery()!.id;
    await engine.deleteTank(originalId);
    expect(engine.nursery()).toBeUndefined();
    expect(await storage.get(originalId)).toBeUndefined();
    expect(profile.unlocks).toContain('nursery');

    await engine.createNursery();

    const nursery = engine.nursery()!;
    expect(nursery.id).not.toBe(originalId);
    expect(mainTankCount(profile)).toBe(3);
    expect(profile.tanks.filter((t) => t.kind === 'main').map((t) => t.id)).toEqual(ordinaryIds);
    expect(profile.lumen).toBe(127);
    expect(profile.activeTank).toBe(tankId);
    expect(engine.tankId).toBe(tankId);
    expect(engine.world).toBe(activeWorld);
    expect((await storage.get(nursery.id))?.snapshot).toMatchObject({ cfg: { wildLife: false, maxPredators: 0 }, creatures: [] });
    const saved = await storage.getDoc<Profile>(PROFILE_KEY);
    expect(saved?.activeTank).toBe(tankId);
    expect(saved?.tanks.filter((t) => t.kind === 'nursery')).toHaveLength(1);
  });

  it.each(['tank', 'profile'] as const)('can retry after the %s write fails without leaving a phantom nursery', async (stage) => {
    const { engine, storage, profile, tankId } = await fixture();
    profile.unlocks.push('nursery');
    profile.lumen = 57;
    const ordinaryIds = profile.tanks.map((t) => t.id);
    if (stage === 'tank') vi.spyOn(storage, 'put').mockRejectedValueOnce(new Error('tank write failed'));
    else vi.spyOn(storage, 'putDoc').mockRejectedValueOnce(new Error('profile write failed'));

    await expect(engine.createNursery()).resolves.toBeUndefined();

    expect(engine.busy).toBe(false);
    expect(engine.nursery()).toBeUndefined();
    expect(profile.tanks.map((t) => t.id)).toEqual(ordinaryIds);
    expect(profile.activeTank).toBe(tankId);
    expect(profile.lumen).toBe(57);
    expect((await storage.list()).filter((record) => record.kind === 'tank').map((record) => record.id)).toEqual(ordinaryIds);

    await engine.createNursery();
    expect(engine.nursery()).toBeDefined();
    expect(profile.tanks.filter((t) => t.kind === 'nursery')).toHaveLength(1);
    expect(profile.activeTank).toBe(tankId);
    expect(profile.lumen).toBe(57);
  });

  it('ignores locked, busy, catching-up and duplicate requests', async () => {
    const { engine, storage, profile } = await fixture();
    const writes = vi.spyOn(storage, 'put');
    await engine.createNursery();
    expect(writes).not.toHaveBeenCalled();
    profile.unlocks.push('nursery');
    engine.busy = true;
    await engine.createNursery();
    engine.busy = false;
    engine.catchUp = { tankName: 'Home', target: 100, done: 0, awayMs: 100_000, stopping: false };
    await engine.createNursery();
    expect(writes).not.toHaveBeenCalled();
    engine.catchUp = null;
    await engine.createNursery();
    const count = writes.mock.calls.length;
    await engine.createNursery();
    expect(writes).toHaveBeenCalledTimes(count);
    expect(profile.tanks.filter((t) => t.kind === 'nursery')).toHaveLength(1);
  });

  it('shows the recovery entry only when unlocked and missing, including at the main tank limit', async () => {
    const { engine, profile } = await fixture();
    const panel = () => renderToStaticMarkup(createElement(WorldPanel, { engine }));
    expect(panel()).not.toContain('重新准备育种缸');
    profile.unlocks.push('nursery');
    await fillMainTanks(engine);
    expect(panel()).toMatch(/<button\b[^>]*>重新准备育种缸（免费）<\/button>/);
    await engine.createNursery();
    expect(panel()).not.toContain('重新准备育种缸');
    await engine.deleteTank(engine.nursery()!.id);
    expect(panel()).toContain('重新准备育种缸');
  });
});

describe('the challenge introduction holds the simulation still', () => {
  // These are the same Engine commands called by App's space and 1–4 keys,
  // and by the pause/speed controls in the dock.
  it.each([
    { key: 'Space', command: (engine: Engine) => engine.togglePause() },
    { key: '1', command: (engine: Engine) => engine.setTimeScale(0.5) },
    { key: '2', command: (engine: Engine) => engine.setTimeScale(1) },
    { key: '3', command: (engine: Engine) => engine.setTimeScale(2) },
    { key: '4', command: (engine: Engine) => engine.setTimeScale(5) },
  ])('ignores the $key command until beginLevel, then advances real creatures', async ({ command }) => {
    const { engine } = await fixture();
    await engine.startLevel(level);
    expect(engine.world.creatures.length).toBeGreaterThan(0);
    const initial = simulationState(engine);
    advanceFrames(1);

    command(engine);
    expect(engine.loop.paused).toBe(true);
    expect(engine.loop.timeScale).toBe(1);
    advanceFrames(120);
    expect(engine.renderer.render).toHaveBeenCalled();
    expect(simulationState(engine)).toEqual(initial);
    expect(engine.levelPhase).toBe('intro');

    engine.beginLevel();
    expect(engine.levelPhase).toBe('playing');
    expect(engine.loop.paused).toBe(false);
    engine.setTimeScale(2);
    expect(engine.loop.timeScale).toBe(2);
    engine.togglePause();
    expect(engine.loop.paused).toBe(true);
    advanceFrames(30);
    expect(simulationState(engine)).toEqual(initial);
    engine.togglePause();
    advanceFrames(60);
    expect(engine.world.time).toBeGreaterThan(initial.time + 1);
    expect(engine.level!.elapsed(engine.world)).toBeGreaterThan(1);
    expect(engine.world.creatures.map((c) => c.age)).not.toEqual(initial.ages);
    expect(engine.world.creatures.map((c) => c.energy)).not.toEqual(initial.energy);
  });

  it('also guards the real simulation step if a caller directly unpauses the Loop during intro', async () => {
    const { engine } = await fixture();
    await engine.startLevel(level);
    const initial = simulationState(engine);
    engine.loop.paused = false;
    engine.loop.timeScale = 5;
    advanceFrames(120);
    expect(engine.renderer.render).toHaveBeenCalled();
    expect(simulationState(engine)).toEqual(initial);
    engine.beginLevel();
    advanceFrames(60);
    expect(engine.world.time).toBeGreaterThan(1);
    expect(engine.level!.elapsed(engine.world)).toBeGreaterThan(1);
  });

  it('keeps pause and speed controls available in an ordinary garden and while viewing results', async () => {
    const home = emptyWorld('garden-controls');
    addAdult(home, herbGenome('garden-resident'), 500, 300);
    const { engine } = await fixture(home);
    engine.start();
    engine.setTimeScale(2);
    expect(engine.loop.timeScale).toBe(2);
    engine.togglePause();
    expect(engine.loop.paused).toBe(true);
    advanceFrames(60);
    expect(engine.world.time).toBe(0);
    engine.setTimeScale(0.5);
    advanceFrames(60);
    expect(engine.world.time).toBeGreaterThan(0);

    await engine.startLevel({ ...level, timeLimit: 1 });
    engine.beginLevel();
    advanceFrames(120);
    expect(engine.levelPhase).toBe('result');
    const resultTime = engine.world.time;
    const endTime = engine.level!.endT;
    engine.setTimeScale(5);
    expect(engine.loop.timeScale).toBe(5);
    engine.togglePause();
    expect(engine.loop.paused).toBe(true);
    advanceFrames(30);
    expect(engine.world.time).toBe(resultTime);
    engine.togglePause();
    advanceFrames(30);
    expect(engine.world.time).toBeGreaterThan(resultTime + 1);
    expect(engine.level!.endT).toBe(endTime);
  });
});
