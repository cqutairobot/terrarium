import { useSyncExternalStore } from 'react';
import type { Engine } from '../engine/engine';

/** Re-render whenever the engine publishes (about 4 times a second, or on commands). */
export function useEngineVersion(engine: Engine): number {
  return useSyncExternalStore(engine.subscribe, engine.getVersion);
}
