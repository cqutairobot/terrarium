import type { WorldSnapshot } from '../sim/serialize';

export interface SaveMeta {
  id: string;
  name: string;
  kind: 'auto' | 'manual';
  savedAt: number;
  worldName: string;
  seed: string;
  simTime: number;
  population: number;
  generation: number;
}

export interface SaveRecord extends SaveMeta {
  snapshot: WorldSnapshot;
}

/**
 * Where worlds are kept. The browser build uses IndexedDB; a future desktop
 * build can implement the same interface on top of the file system.
 */
export interface StorageAdapter {
  readonly kind: 'indexeddb' | 'memory';
  put(rec: SaveRecord): Promise<void>;
  get(id: string): Promise<SaveRecord | undefined>;
  list(): Promise<SaveMeta[]>;
  remove(id: string): Promise<void>;
}

/** Fallback when IndexedDB is unavailable (private windows, blocked storage). */
export class MemoryStorage implements StorageAdapter {
  readonly kind = 'memory' as const;
  private map = new Map<string, SaveRecord>();

  async put(rec: SaveRecord): Promise<void> {
    this.map.set(rec.id, rec);
  }

  async get(id: string): Promise<SaveRecord | undefined> {
    return this.map.get(id);
  }

  async list(): Promise<SaveMeta[]> {
    return [...this.map.values()].map(toMeta).sort((a, b) => b.savedAt - a.savedAt);
  }

  async remove(id: string): Promise<void> {
    this.map.delete(id);
  }
}

export function toMeta(r: SaveRecord): SaveMeta {
  const { snapshot: _s, ...meta } = r;
  return meta;
}
