/**
 * A Web Worker that runs a world forward while the page stays responsive
 * (catching up after the player was away). It receives a snapshot, steps it
 * exactly as the live loop would, and sends the new snapshot back.
 */
import { advanceWorld, type CatchUpPlan } from '../sim/advance';
import { restoreWorld, snapshotWorld, type WorldSnapshot } from '../sim/serialize';

export type WorkerRequest = { type: 'advance'; snapshot: WorldSnapshot; plan: CatchUpPlan } | { type: 'stop' };
export type WorkerReply =
  | { type: 'progress'; simulated: number }
  | { type: 'done'; snapshot: WorldSnapshot; simulated: number }
  | { type: 'error'; message: string };

const ctx = self as unknown as { postMessage(m: WorkerReply): void; onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null };
let stop = false;

ctx.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'stop') {
    stop = true;
    return;
  }
  stop = false;
  void run(msg.snapshot, msg.plan);
};

async function run(snapshot: WorldSnapshot, plan: CatchUpPlan): Promise<void> {
  try {
    const world = restoreWorld(snapshot);
    const simulated = await advanceWorld(world, plan, {
      onProgress: (s) => ctx.postMessage({ type: 'progress', simulated: s }),
      shouldStop: () => stop,
      pause: () => new Promise((r) => setTimeout(r, 0)),
    });
    ctx.postMessage({ type: 'done', snapshot: snapshotWorld(world), simulated });
  } catch (err) {
    ctx.postMessage({ type: 'error', message: String((err as Error)?.message ?? err) });
  }
}
