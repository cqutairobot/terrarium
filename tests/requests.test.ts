import { describe, expect, it } from 'vitest';
import { MEASURES, specCloseness, type Measure } from '../src/game/conditions';
import { normalizeProfile } from '../src/game/profile';
import { candidatesFor, closeRequest, drawRequest, ecologyStatus, localDate, newBoard, refreshBoard, resetRequestTrackers, type Request, type RequestBoard } from '../src/game/requests';
import type { Creature } from '../src/sim/entities/creature';
import { express, G } from '../src/sim/genome';
import { restoreWorld, snapshotWorld } from '../src/sim/serialize';
import { World } from '../src/sim/world';
import { addAdult, emptyWorld, herbGenome, stepFor } from './helpers';

const GENE: Partial<Record<Measure, number>> = { size: G.size, speed: G.speed, sense: G.perception, lifespan: G.longevity, tentacles: G.tentacles, tail: G.tailLength, eyes: G.eyeSize, warmth: G.thermalPref };

const holdRequest = (id = 'hold'): Request => ({
  id, kind: 'ecology', from: '观察者', text: '', goal: '', reward: 25, difficulty: 1, createdAt: 0,
  cond: { k: 'hold', seconds: 300, cond: { k: 'population', who: 'consumer', min: 1 } },
});

function observedWorld(seed: string, time: number) {
  const world = emptyWorld(seed);
  addAdult(world, herbGenome(), 300, 400);
  world.time = time;
  return world;
}

describe('requests', () => {
  it('keeps three requests and one daily on the board', () => {
    const w = new World({ seed: 'board', aspect: 16 / 9 });
    stepFor(w, 30);
    const b = newBoard();
    const now = new Date(2026, 9, 28, 9, 0).getTime();
    expect(refreshBoard(b, w, now)).toBe(true);
    expect(b.open.filter((r) => !r.daily)).toHaveLength(3);
    expect(b.open.filter((r) => r.daily)).toHaveLength(1);
    expect(b.dailyDate).toBe(localDate(now));
    expect(refreshBoard(b, w, now + 1000)).toBe(false);
    closeRequest(b, b.open[1].id, true);
    expect(refreshBoard(b, w, now + 2000)).toBe(true);
    expect(b.completed).toBe(1);
    // a new day brings a new daily request
    const yesterday = b.open.find((r) => r.daily)!.id;
    refreshBoard(b, w, now + 86_400_000);
    expect(b.open.filter((r) => r.daily)).toHaveLength(1);
    expect(b.open.find((r) => r.daily)!.id).not.toBe(yesterday);
  });

  it('only asks for what the tank’s genes can reach', () => {
    for (const seed of ['ask-a', 'ask-b', 'ask-c']) {
      const w = new World({ seed, aspect: 16 / 9 });
      stepFor(w, 60);
      const b = newBoard();
      for (let i = 0; i < 40; i++) {
        const r = drawRequest(w, b, 0);
        expect(r.reward).toBeGreaterThan(0);
        expect(r.goal.length).toBeGreaterThan(4);
        if (r.kind !== 'deliver' || !r.spec) {
          const st = ecologyStatus(w, b, r);
          expect(st.progress).toBeGreaterThanOrEqual(0);
          expect(st.progress).toBeLessThanOrEqual(1);
          continue;
        }
        for (const [m, [lo, hi]] of Object.entries(r.spec.ranges ?? {}) as [Measure, [number | null, number | null]][]) {
          // someone alive could reach the target if their gene for it were pushed to the limit
          const reachable = w.creatures.some((c) => {
            const gi = GENE[m];
            if (gi === undefined) return true;
            const g = { g: c.genome.g.slice(), rare: c.genome.rare };
            g.g[gi] = lo !== null ? 1 : 0;
            const v = MEASURES[m].get({ ph: express(g) } as Creature);
            return lo !== null ? v >= lo : v <= hi!;
          });
          expect(reachable).toBe(true);
        }
        if (r.difficulty === 1) {
          // an easy request is nearly within reach already
          const best = Math.max(...w.creatures.filter((c) => c.stage !== 'egg').map((c) => specCloseness(c, r.spec!)));
          expect(best).toBeGreaterThanOrEqual(0.5);
        }
        expect(candidatesFor(w, r).every((c) => c.stage === 'adult' || c.stage === 'elder' || !r.spec!.adult)).toBe(true);
      }
    }
  });

  it.each([[100, 1000], [1000, 100]])('starts a new hold when changing tank clocks from %i to %i', (from, to) => {
    const board = newBoard();
    const request = holdRequest();
    const first = observedWorld('first', from);
    const second = observedWorld('second', to);
    ecologyStatus(first, board, request, 'tank-a');
    first.time += 120;
    expect(ecologyStatus(first, board, request, 'tank-a').value).toBe(120);

    expect(ecologyStatus(second, board, request, 'tank-b')).toEqual({ met: false, progress: 0.5, value: 0 });
    second.time += 299;
    expect(ecologyStatus(second, board, request, 'tank-b').met).toBe(false);
    second.time++;
    expect(ecologyStatus(second, board, request, 'tank-b').met).toBe(true);
    // Returning cannot reclaim the first tank's old observation interval.
    expect(ecologyStatus(first, board, request, 'tank-a')).toEqual({ met: false, progress: 0.5, value: 0 });
  });

  it('uses tank ids to distinguish tanks with the same seed and creation time', () => {
    const board = newBoard();
    const request = holdRequest();
    const first = observedWorld('same-seed', 100);
    const second = observedWorld('same-seed', 1000);
    second.createdAt = first.createdAt;
    ecologyStatus(first, board, request, 'tank-a');
    expect(ecologyStatus(second, board, request, 'tank-b').value).toBe(0);
    expect(board.trackers[request.id].tankId).toBe('tank-b');
  });

  it('keeps one tank’s continuous hold through repeated reads and restarts it after an interruption', () => {
    const board = newBoard();
    const request = holdRequest();
    const world = observedWorld('continuous', 100);
    ecologyStatus(world, board, request, 'tank-a');
    world.time = 200;
    for (let i = 0; i < 3; i++) expect(ecologyStatus(world, board, request, 'tank-a').value).toBe(100);
    world.creatures[0].dying = 1;
    world.time = 250;
    expect(ecologyStatus(world, board, request, 'tank-a')).toEqual({ met: false, progress: 0, value: 0 });
    world.creatures[0].dying = 0;
    world.time = 300;
    expect(ecologyStatus(world, board, request, 'tank-a').value).toBe(0);
    world.time = 600;
    expect(ecologyStatus(world, board, request, 'tank-a').met).toBe(true);
  });

  it('restarts an observation when time goes backwards even after its original start', () => {
    const board = newBoard();
    const request = holdRequest();
    const world = observedWorld('rewind', 500);
    ecologyStatus(world, board, request, 'tank-a');
    world.time = 700;
    expect(ecologyStatus(world, board, request, 'tank-a').value).toBe(200);
    world.time = 600;
    expect(ecologyStatus(world, board, request, 'tank-a')).toEqual({ met: false, progress: 0.5, value: 0 });
    world.time = 899;
    expect(ecologyStatus(world, board, request, 'tank-a').met).toBe(false);
    world.time = 900;
    expect(ecologyStatus(world, board, request, 'tank-a').met).toBe(true);
  });

  it('clears the replaced tank’s observations for snapshot restores and fresh starts', () => {
    const board = newBoard();
    const request = holdRequest();
    const world = observedWorld('replaced', 100);
    ecologyStatus(world, board, request, 'tank-a');
    world.time = 300;
    expect(ecologyStatus(world, board, request, 'tank-a').value).toBe(200);
    board.trackers.other = { tankId: 'tank-b', lastTime: 10, since: { other: 10 } };
    board.trackers.legacy = { since: { legacy: 0 } };

    // A snapshot can have the same clock as the current world. The replacement
    // hook must still discard observations from the world it replaces.
    const restored = restoreWorld(snapshotWorld(world));
    resetRequestTrackers(board, 'tank-a');
    expect(Object.keys(board.trackers)).toEqual(['other']);
    expect(ecologyStatus(restored, board, request, 'tank-a').value).toBe(0);
    restored.time = 600;
    expect(ecologyStatus(restored, board, request, 'tank-a').met).toBe(true);

    const restarted = observedWorld(world.seed, 0);
    resetRequestTrackers(board, 'tank-a');
    expect(ecologyStatus(restarted, board, request, 'tank-a').value).toBe(0);
    restarted.time = 300;
    expect(ecologyStatus(restarted, board, request, 'tank-a').met).toBe(true);
    // Leaving and returning without evaluating another tank still breaks the
    // observed interval, so the engine can explicitly clear all observations.
    resetRequestTrackers(board);
    expect(board.trackers).toEqual({});
    restarted.time = 1000;
    expect(ecologyStatus(restarted, board, request, 'tank-a').value).toBe(0);
  });

  it('migrates serialized unbound trackers and preserves newly bound observations', () => {
    const request = holdRequest();
    const legacy = newBoard();
    legacy.open.push(request);
    legacy.trackers[request.id] = { since: { [request.id]: 0 } };
    const profile = normalizeProfile({ requests: JSON.parse(JSON.stringify(legacy)) as RequestBoard }, 0);
    const world = observedWorld('saved', 1000);
    expect(ecologyStatus(world, profile.requests, request, 'tank-a')).toEqual({ met: false, progress: 0.5, value: 0 });
    const saved = JSON.parse(JSON.stringify(profile.requests)) as RequestBoard;
    const restored = restoreWorld(snapshotWorld(world));
    restored.time = 1120;
    expect(ecologyStatus(restored, saved, request, 'tank-a').value).toBe(120);
  });

  it('uses stable world fields for callers without a tank id', () => {
    const board = newBoard();
    const request = holdRequest();
    const world = observedWorld('default-binding', 100);
    ecologyStatus(world, board, request);
    const restored = restoreWorld(snapshotWorld(world));
    restored.time = 200;
    expect(ecologyStatus(restored, board, request).value).toBe(100);
    const other = observedWorld(world.seed, 1000);
    other.createdAt = world.createdAt + 1;
    expect(ecologyStatus(other, board, request).value).toBe(0);
  });
});
