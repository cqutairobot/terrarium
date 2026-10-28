/** Fixed-capacity FIFO that serializes to a plain array (oldest first). */
export class RingBuffer<T> {
  private buf: (T | undefined)[];
  private head = 0;
  private len = 0;

  constructor(readonly capacity: number, items?: readonly T[]) {
    this.buf = new Array(capacity);
    if (items) for (const it of items.slice(-capacity)) this.push(it);
  }

  get length(): number {
    return this.len;
  }

  push(item: T): T | undefined {
    let evicted: T | undefined;
    if (this.len === this.capacity) {
      evicted = this.buf[this.head];
      this.buf[this.head] = item;
      this.head = (this.head + 1) % this.capacity;
    } else {
      this.buf[(this.head + this.len) % this.capacity] = item;
      this.len++;
    }
    return evicted;
  }

  /** i = 0 is the oldest item. */
  get(i: number): T | undefined {
    if (i < 0 || i >= this.len) return undefined;
    return this.buf[(this.head + i) % this.capacity];
  }

  last(): T | undefined {
    return this.len === 0 ? undefined : this.get(this.len - 1);
  }

  clear(): void {
    this.buf = new Array(this.capacity);
    this.head = 0;
    this.len = 0;
  }

  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.len; i++) out.push(this.buf[(this.head + i) % this.capacity] as T);
    return out;
  }

  *[Symbol.iterator](): IterableIterator<T> {
    for (let i = 0; i < this.len; i++) yield this.buf[(this.head + i) % this.capacity] as T;
  }
}
