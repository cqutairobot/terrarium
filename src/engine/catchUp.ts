import { advanceWorld, type CatchUpPlan } from '../sim/advance';
import { restoreWorld, snapshotWorld, type WorldSnapshot } from '../sim/serialize';
import type { WorkerReply, WorkerRequest } from './simWorker';

export interface CatchUpResult {
  snapshot: WorldSnapshot;
  simulated: number;
}

/**
 * Runs a catch-up in a Web Worker when the browser allows it, otherwise on
 * the main thread in small slices so the page keeps painting.
 */
export class CatchUpRunner {
  private worker: Worker | null = null;
  private workerFailed = false;
  private stopRequested = false;

  run(snapshot: WorldSnapshot, plan: CatchUpPlan, onProgress: (simulated: number) => void): Promise<CatchUpResult> {
    this.stopRequested = false;
    const worker = this.ensureWorker();
    if (!worker) return this.runHere(snapshot, plan, onProgress);
    return new Promise((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<WorkerReply>) => {
        const m = e.data;
        if (m.type === 'progress') onProgress(m.simulated);
        else if (m.type === 'done') resolve({ snapshot: m.snapshot, simulated: m.simulated });
        else reject(new Error(m.message));
      };
      worker.onerror = (ev) => {
        // a worker that cannot even start: fall back to the main thread once
        ev.preventDefault();
        this.workerFailed = true;
        this.worker?.terminate();
        this.worker = null;
        this.runHere(snapshot, plan, onProgress).then(resolve, reject);
      };
      const req: WorkerRequest = { type: 'advance', snapshot, plan };
      worker.postMessage(req);
    });
  }

  /** Stop early; the result covers whatever was simulated so far. */
  stop(): void {
    this.stopRequested = true;
    const req: WorkerRequest = { type: 'stop' };
    this.worker?.postMessage(req);
  }

  private ensureWorker(): Worker | null {
    if (this.worker || this.workerFailed) return this.worker;
    try {
      this.worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      this.workerFailed = true;
      this.worker = null;
    }
    return this.worker;
  }

  private async runHere(snapshot: WorldSnapshot, plan: CatchUpPlan, onProgress: (s: number) => void): Promise<CatchUpResult> {
    const world = restoreWorld(snapshot);
    const simulated = await advanceWorld(world, plan, {
      onProgress,
      shouldStop: () => this.stopRequested,
      pause: () => new Promise((r) => setTimeout(r, 0)),
      sliceSeconds: 5,
    });
    return { snapshot: snapshotWorld(world), simulated };
  }
}
