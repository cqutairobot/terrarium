import type { World } from '../world';

/**
 * The world's memory: turns simulation events into statistics, stories and
 * chronicle entries. Part of the simulation state (saved with the world).
 */
export class History {
  constructor(private readonly world: World) {}

  /** Consume the events produced during the last step. */
  process(): void {
    void this.world;
  }

  save(): unknown {
    return {};
  }

  load(_data: unknown): void {}
}
