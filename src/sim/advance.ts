import { SIM_DT, type World } from './world';

/** An absence to make up for: `seconds` of simulated time spread over a wall-clock interval. */
export interface CatchUpPlan {
  seconds: number;
  wallStart: number;
  wallEnd: number;
}

export interface CatchUpHooks {
  onProgress?(simulated: number): void;
  shouldStop?(): boolean;
  /** Let the host breathe between slices (a worker reads its messages then). */
  pause?(): Promise<void>;
  /** Simulated seconds per slice. */
  sliceSeconds?: number;
}

/**
 * While a world catches up, the history's wall-clock stamps should fall
 * inside the absence, not all at "now".
 */
function absenceClock(world: World, plan: CatchUpPlan): () => void {
  const t0 = world.time;
  const span = Math.max(1e-6, plan.seconds);
  const prev = world.clock;
  world.clock = () => plan.wallStart + Math.min(1, (world.time - t0) / span) * (plan.wallEnd - plan.wallStart);
  return () => {
    world.clock = prev;
  };
}

/**
 * Run a world forward the same way the live loop would (fixed SIM_DT
 * steps), so a catch-up is indistinguishable from having watched it.
 */
export async function advanceWorld(world: World, plan: CatchUpPlan, hooks: CatchUpHooks = {}): Promise<number> {
  const restore = absenceClock(world, plan);
  const total = Math.round(plan.seconds / SIM_DT);
  const slice = Math.max(1, Math.round((hooks.sliceSeconds ?? 20) / SIM_DT));
  let done = 0;
  try {
    while (done < total) {
      const n = Math.min(slice, total - done);
      for (let i = 0; i < n; i++) world.step(SIM_DT);
      done += n;
      world.drainFx();
      hooks.onProgress?.(done * SIM_DT);
      if (hooks.shouldStop?.()) break;
      if (hooks.pause) await hooks.pause();
    }
  } finally {
    restore();
  }
  return done * SIM_DT;
}
