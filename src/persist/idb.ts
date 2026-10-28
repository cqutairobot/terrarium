import { MemoryStorage, toMeta, type SaveMeta, type SaveRecord, type StorageAdapter } from './storage';

const DB_NAME = 'tiny-eden';
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Saves split into a small `meta` store (fast listing) and a `worlds` store (snapshots). */
export class IdbStorage implements StorageAdapter {
  readonly kind = 'indexeddb' as const;
  private constructor(private readonly db: IDBDatabase) {}

  static async open(): Promise<IdbStorage> {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
    };
    const db = await req(open);
    return new IdbStorage(db);
  }

  async put(rec: SaveRecord): Promise<void> {
    const tx = this.db.transaction(['meta', 'worlds'], 'readwrite');
    tx.objectStore('meta').put(toMeta(rec));
    tx.objectStore('worlds').put({ id: rec.id, snapshot: rec.snapshot });
    await done(tx);
  }

  async get(id: string): Promise<SaveRecord | undefined> {
    const tx = this.db.transaction(['meta', 'worlds'], 'readonly');
    const meta = await req(tx.objectStore('meta').get(id) as IDBRequest<SaveMeta | undefined>);
    const world = await req(tx.objectStore('worlds').get(id) as IDBRequest<{ id: string; snapshot: SaveRecord['snapshot'] } | undefined>);
    if (!meta || !world) return undefined;
    return { ...meta, snapshot: world.snapshot };
  }

  async list(): Promise<SaveMeta[]> {
    const tx = this.db.transaction('meta', 'readonly');
    const all = await req(tx.objectStore('meta').getAll() as IDBRequest<SaveMeta[]>);
    return all.sort((a, b) => b.savedAt - a.savedAt);
  }

  async remove(id: string): Promise<void> {
    const tx = this.db.transaction(['meta', 'worlds'], 'readwrite');
    tx.objectStore('meta').delete(id);
    tx.objectStore('worlds').delete(id);
    await done(tx);
  }
}

export async function openStorage(): Promise<StorageAdapter> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no indexedDB');
    return await IdbStorage.open();
  } catch {
    return new MemoryStorage();
  }
}
