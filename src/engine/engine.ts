import type { StorageAdapter, SaveMeta } from '../persist/storage';
import { downloadSnapshot, readSnapshotFile } from '../persist/exportImport';
import { Renderer } from '../render/renderer';
import type { EcoConfig, EnvSettings } from '../sim/config';
import type { Creature } from '../sim/entities/creature';
import type { FoodKind } from '../sim/entities/food';
import type { DisasterKind } from '../sim/environment';
import { restoreWorld, snapshotWorld } from '../sim/serialize';
import { SIM_DT, World } from '../sim/world';
import { Input } from './input';
import { Loop } from './loop';

export type FoodTool = 'none' | FoodKind;

export interface Toast {
  id: number;
  text: string;
  at: number;
}

export const AUTOSAVE_ID = 'autosave';
const AUTOSAVE_EVERY = 60;

export function randomSeed(): string {
  const words = ['苔', '汐', '萤', '澜', '雾', '星', '露', '溪', '岚', '珀'];
  return words[Math.floor(Math.random() * words.length)] + Math.random().toString(36).slice(2, 7);
}

/**
 * Glue between the pure simulation, the canvas renderer, persistence and
 * the UI. React reads `version`-stamped state and calls these commands.
 */
export class Engine {
  world: World;
  readonly renderer: Renderer;
  readonly loop: Loop;
  version = 0;
  tool: FoodTool = 'pellet';
  aiming: DisasterKind | null = null;
  uiHidden = false;
  toasts: Toast[] = [];
  lastSavedAt = 0;
  private listeners = new Set<() => void>();
  private publishAcc = 0;
  private autosaveAcc = 0;
  private toastId = 1;
  private input: Input;
  private saving = false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    world: World,
    readonly storage: StorageAdapter,
  ) {
    this.world = world;
    this.renderer = new Renderer(canvas, world);
    this.loop = new Loop(SIM_DT, {
      step: (dt) => this.world.step(dt),
      tick: (realDt) => {
        this.world.realTime += realDt;
        this.autosaveAcc += realDt;
        if (this.autosaveAcc >= AUTOSAVE_EVERY) {
          this.autosaveAcc = 0;
          this.idle(() => void this.save('auto'));
        }
      },
      render: (alpha, dt, vt) => {
        for (const e of this.world.drainFx()) this.renderer.effects.handle(e);
        this.renderer.render(alpha, dt, vt);
        this.publishAcc += dt;
        if (this.publishAcc >= 0.25) {
          this.publishAcc = 0;
          this.publish();
        }
      },
    });
    this.input = new Input(canvas, this);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
  }

  start(): void {
    this.loop.start();
  }

  private idle(fn: () => void): void {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    if (ric) ric(fn, { timeout: 2000 });
    else setTimeout(fn, 0);
  }

  private onResize = (): void => {
    this.renderer.resize();
  };

  private onVisibility = (): void => {
    if (document.hidden) {
      // the world rests while nobody can see it; keep it safe first
      void this.save('auto');
      this.loop.stop();
    } else this.loop.start();
  };

  private onPageHide = (): void => {
    void this.save('auto');
  };

  // ------------------------------------------------------------ store

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getVersion = (): number => this.version;

  publish(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  toast(text: string): void {
    const t = { id: this.toastId++, text, at: performance.now() };
    this.toasts = [...this.toasts.slice(-2), t];
    this.publish();
    setTimeout(() => {
      this.toasts = this.toasts.filter((x) => x.id !== t.id);
      this.publish();
    }, 3600);
  }

  // ------------------------------------------------------------ observing

  selected(): Creature | undefined {
    return this.renderer.selectedId ? this.world.creatureMap.get(this.renderer.selectedId) : undefined;
  }

  select(id: number): void {
    this.renderer.selectedId = id;
    if (!id) this.renderer.followId = 0;
    this.publish();
  }

  follow(id: number): void {
    this.renderer.followId = id;
    if (id) this.renderer.selectedId = id;
    this.publish();
  }

  // ------------------------------------------------------------ interventions

  setTool(t: FoodTool): void {
    this.tool = t;
    this.aiming = null;
    this.publish();
  }

  feedAt(x: number, y: number, count: number): void {
    if (this.tool === 'none') return;
    this.world.feed(this.tool, x, y, count);
  }

  aim(kind: DisasterKind | null): void {
    this.aiming = kind;
    this.publish();
  }

  disaster(kind: DisasterKind, x?: number, y?: number): void {
    this.world.disaster(kind, x, y);
    this.aiming = null;
    this.publish();
  }

  setEnv(patch: Partial<EnvSettings>): void {
    Object.assign(this.world.env.settings, patch);
    this.publish();
  }

  setConfig(patch: Partial<EcoConfig>): void {
    Object.assign(this.world.cfg, patch);
    this.publish();
  }

  setTimeScale(s: number): void {
    this.loop.timeScale = s;
    this.loop.paused = false;
    this.publish();
  }

  togglePause(): void {
    this.loop.paused = !this.loop.paused;
    this.publish();
  }

  setUiHidden(hidden: boolean): void {
    this.uiHidden = hidden;
    this.publish();
  }

  // ------------------------------------------------------------ worlds

  async save(kind: 'auto' | 'manual', name?: string): Promise<boolean> {
    if (this.saving) return false;
    this.saving = true;
    try {
      const w = this.world;
      const snapshot = snapshotWorld(w);
      const id = kind === 'auto' ? AUTOSAVE_ID : `save-${Date.now()}`;
      await this.storage.put({
        id,
        name: name ?? (kind === 'auto' ? '自动存档' : `${w.name} · ${new Date().toLocaleString('zh-CN', { hour12: false })}`),
        kind,
        savedAt: Date.now(),
        worldName: w.name,
        seed: w.seed,
        simTime: w.time,
        population: w.consumerCount + w.predatorCount,
        generation: w.counters.generationsMax,
        snapshot,
      });
      this.lastSavedAt = Date.now();
      if (kind === 'manual') this.toast('已保存：' + w.name);
      return true;
    } catch (err) {
      if (kind === 'manual') this.toast('保存失败：' + String((err as Error)?.message ?? err));
      return false;
    } finally {
      this.saving = false;
    }
  }

  listSaves(): Promise<SaveMeta[]> {
    return this.storage.list();
  }

  async load(id: string): Promise<void> {
    const rec = await this.storage.get(id);
    if (!rec) {
      this.toast('找不到这个存档');
      return;
    }
    try {
      this.setWorld(restoreWorld(rec.snapshot));
      this.toast('已读取：' + rec.worldName);
    } catch (err) {
      this.toast('读取失败：' + String((err as Error)?.message ?? err));
    }
  }

  async remove(id: string): Promise<void> {
    await this.storage.remove(id);
    this.publish();
  }

  newWorld(seed?: string, name?: string): void {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const w = new World({ seed: seed?.trim() || randomSeed(), aspect, name: name?.trim() || undefined });
    this.setWorld(w);
    this.toast('新的世界醒来了：' + w.name);
    void this.save('auto');
  }

  resetWorld(): void {
    const w = new World({ seed: this.world.seed, aspect: this.world.width / this.world.height, name: this.world.name });
    this.setWorld(w);
    this.toast('世界回到了它的第一天');
    void this.save('auto');
  }

  exportWorld(): void {
    const w = this.world;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    downloadSnapshot(snapshotWorld(w), `浮生-${w.name}-${stamp}.json`);
  }

  async importWorld(file: File): Promise<void> {
    try {
      const snap = await readSnapshotFile(file);
      this.setWorld(restoreWorld(snap));
      this.toast('已导入：' + this.world.name);
      void this.save('auto');
    } catch (err) {
      this.toast('导入失败：' + String((err as Error)?.message ?? err));
    }
  }

  private setWorld(w: World): void {
    this.world = w;
    this.renderer.setWorld(w);
    this.aiming = null;
    this.autosaveAcc = 0;
    this.publish();
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
  }
}
