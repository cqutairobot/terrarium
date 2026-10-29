import type { WorldSnapshot } from '../sim/serialize';

export interface SaveMeta {
  id: string;
  name: string;
  /** 'tank' is a living tank; 'manual' a snapshot kept by the player; 'auto' the first version's autosave. */
  kind: 'auto' | 'manual' | 'tank';
  /** The tank a manual snapshot was taken from. */
  tankId?: string;
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
  /** Commit related worlds and documents together, or leave all of them unchanged. */
  putAll(records: SaveRecord[], docs?: Record<string, unknown>): Promise<void>;
  get(id: string): Promise<SaveRecord | undefined>;
  list(): Promise<SaveMeta[]>;
  remove(id: string): Promise<void>;
  /** Small JSON documents (the player profile). */
  getDoc<T>(key: string): Promise<T | undefined>;
  putDoc<T>(key: string, value: T): Promise<void>;
}

/** Fallback when IndexedDB is unavailable (private windows, blocked storage). */
export class MemoryStorage implements StorageAdapter {
  readonly kind = 'memory' as const;
  private map = new Map<string, SaveRecord>();
  private docs = new Map<string, string>();

  async put(rec: SaveRecord): Promise<void> {
    await this.putAll([rec]);
  }

  async putAll(records: SaveRecord[], docs: Record<string, unknown> = {}): Promise<void> {
    // Prepare every value before changing either store, just like an IDB transaction.
    const copies = structuredClone(records);
    const documents = Object.entries(docs).map(([key, value]) => [key, JSON.stringify(value)] as const);
    for (const rec of copies) this.map.set(rec.id, rec);
    for (const [key, value] of documents) this.docs.set(key, value);
  }

  async get(id: string): Promise<SaveRecord | undefined> {
    const rec = this.map.get(id);
    return rec === undefined ? undefined : structuredClone(rec);
  }

  async list(): Promise<SaveMeta[]> {
    return [...this.map.values()].map(toMeta).sort((a, b) => b.savedAt - a.savedAt);
  }

  async remove(id: string): Promise<void> {
    this.map.delete(id);
  }

  async getDoc<T>(key: string): Promise<T | undefined> {
    const s = this.docs.get(key);
    return s === undefined ? undefined : (JSON.parse(s) as T);
  }

  async putDoc<T>(key: string, value: T): Promise<void> {
    // stored as text so callers never share mutable state with the store
    this.docs.set(key, JSON.stringify(value));
  }
}

export function toMeta(r: SaveRecord): SaveMeta {
  const { snapshot: _s, ...meta } = r;
  return meta;
}
