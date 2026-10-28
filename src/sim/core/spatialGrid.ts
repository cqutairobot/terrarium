/**
 * Uniform grid built with a counting sort each step. Stores indices into the
 * list that was passed to build(); queries append matching indices to a
 * caller-owned array so the hot path never allocates.
 */
export interface Positioned {
  x: number;
  y: number;
}

export class SpatialGrid {
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  private readonly inv: number;
  private cellStart: Int32Array;
  private cellCount: Int32Array;
  private items: Int32Array;
  private cellOf: Int32Array;
  private size = 0;

  constructor(width: number, height: number, cellSize: number) {
    this.cellSize = cellSize;
    this.inv = 1 / cellSize;
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    const cells = this.cols * this.rows;
    this.cellStart = new Int32Array(cells + 1);
    this.cellCount = new Int32Array(cells);
    this.items = new Int32Array(64);
    this.cellOf = new Int32Array(64);
  }

  get count(): number {
    return this.size;
  }

  private cellIndex(x: number, y: number): number {
    let cx = Math.floor(x * this.inv);
    let cy = Math.floor(y * this.inv);
    if (cx < 0) cx = 0;
    else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  build(list: readonly Positioned[]): void {
    const n = list.length;
    this.size = n;
    if (this.items.length < n) {
      const cap = Math.max(n, this.items.length * 2);
      this.items = new Int32Array(cap);
      this.cellOf = new Int32Array(cap);
    }
    const count = this.cellCount;
    count.fill(0);
    for (let i = 0; i < n; i++) {
      const c = this.cellIndex(list[i].x, list[i].y);
      this.cellOf[i] = c;
      count[c]++;
    }
    const start = this.cellStart;
    let acc = 0;
    for (let c = 0; c < count.length; c++) {
      start[c] = acc;
      acc += count[c];
    }
    start[count.length] = acc;
    // reuse count as a write cursor
    for (let c = 0; c < count.length; c++) count[c] = start[c];
    for (let i = 0; i < n; i++) {
      const c = this.cellOf[i];
      this.items[count[c]++] = i;
    }
  }

  /**
   * Append indices of items within radius r of (x, y) to `out`.
   * Returns the number appended.
   */
  query(list: readonly Positioned[], x: number, y: number, r: number, out: number[]): number {
    const inv = this.inv;
    let x0 = Math.floor((x - r) * inv);
    let x1 = Math.floor((x + r) * inv);
    let y0 = Math.floor((y - r) * inv);
    let y1 = Math.floor((y + r) * inv);
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 >= this.cols) x1 = this.cols - 1;
    if (y1 >= this.rows) y1 = this.rows - 1;
    const r2 = r * r;
    let added = 0;
    for (let cy = y0; cy <= y1; cy++) {
      const row = cy * this.cols;
      for (let cx = x0; cx <= x1; cx++) {
        const c = row + cx;
        const end = this.cellStart[c + 1];
        for (let k = this.cellStart[c]; k < end; k++) {
          const idx = this.items[k];
          const p = list[idx];
          const dx = p.x - x;
          const dy = p.y - y;
          if (dx * dx + dy * dy <= r2) {
            out.push(idx);
            added++;
          }
        }
      }
    }
    return added;
  }
}
