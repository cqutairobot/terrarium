import { Ambient } from '../audio/ambient';
import { awayFacts, summarizeAway, type AwaySummary } from '../game/away';
import { PROFILE_KEY, tankLimit, type Profile, type TankInfo } from '../game/profile';
import { addTank, syncTankInfo, tankRecord } from '../game/tanks';
import type { StorageAdapter, SaveMeta } from '../persist/storage';
import { downloadSnapshot, readSnapshotFile } from '../persist/exportImport';
import { Renderer } from '../render/renderer';
import type { EcoConfig, EnvSettings } from '../sim/config';
import type { Creature } from '../sim/entities/creature';
import type { FoodKind } from '../sim/entities/food';
import type { DisasterKind } from '../sim/environment';
import { emigrate, immigrate } from '../sim/migration';
import { restoreWorld, snapshotWorld } from '../sim/serialize';
import { SIM_DT, World } from '../sim/world';
import { CatchUpRunner } from './catchUp';
import { Input } from './input';
import { Loop } from './loop';
import { loadPrefs, savePrefs, type Prefs } from './prefs';

export type FoodTool = 'none' | FoodKind;

export interface Toast {
  id: number;
  text: string;
  at: number;
}

/** The followed creature has left; who could the camera stay with? */
export interface LostFollow {
  id: number;
  name: string;
  heirs: number[];
  kind: 'child' | 'descendant' | 'family' | 'none';
  at: number;
}

/** A tank catching up on time nobody watched. */
export interface CatchUpState {
  tankName: string;
  /** Simulated seconds to make up. */
  target: number;
  done: number;
  awayMs: number;
  stopping: boolean;
}

const AUTOSAVE_EVERY = 60;
/** Shorter absences are simply resumed. */
const MIN_AWAY_MS = 60_000;
/** At most two simulated hours are made up at once. */
export const MAX_CATCH_UP = 7200;
/** In power-saving (wallpaper) mode the world is written less often. */
const AUTOSAVE_EVERY_QUIET = 180;

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
  lostFollow: LostFollow | null = null;
  profile: Profile;
  /** The tank being shown. */
  tankId: string;
  catchUp: CatchUpState | null = null;
  away: AwaySummary | null = null;
  /** A tank operation (switch, move, create) is under way. */
  busy = false;
  prefs: Prefs;
  readonly audio = new Ambient();
  private qualityAcc = 0;
  private slowWindows = 0;
  private fastWindows = 0;
  private qualityCooldown = 0;
  private listeners = new Set<() => void>();
  private publishAcc = 0;
  private autosaveAcc = 0;
  private toastId = 1;
  private input: Input;
  private saving = false;
  private runner = new CatchUpRunner();
  private hiddenAt = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    world: World,
    readonly storage: StorageAdapter,
    opts: { wallpaper?: boolean; profile: Profile; tankId: string },
  ) {
    this.world = world;
    this.profile = opts.profile;
    this.tankId = opts.tankId;
    this.prefs = loadPrefs(opts.wallpaper ?? false);
    this.uiHidden = opts.wallpaper ?? false;
    this.renderer = new Renderer(canvas, world);
    this.loop = new Loop(SIM_DT, {
      step: (dt) => this.world.step(dt),
      tick: (realDt) => {
        this.world.realTime += realDt;
        this.autosaveAcc += realDt;
        if (this.autosaveAcc >= (this.prefs.powerSave ? AUTOSAVE_EVERY_QUIET : AUTOSAVE_EVERY)) {
          this.autosaveAcc = 0;
          this.idle(() => void this.saveActive());
        }
        this.qualityAcc += realDt;
        if (this.qualityAcc >= 2) {
          this.qualityAcc = 0;
          this.adaptQuality();
        }
      },
      gap: (seconds) => {
        // the machine slept with the page open: make up for it like any absence
        this.loop.stop();
        void this.catchUpAfter(seconds * 1000);
      },
      render: (alpha, dt, vt) => {
        for (const e of this.world.drainFx()) {
          this.renderer.effects.handle(e);
          this.audio.handle(e);
        }
        this.audio.update(this.world);
        this.watchFollow();
        this.renderer.render(alpha, dt, vt);
        this.publishAcc += dt;
        if (this.publishAcc >= 0.25) {
          this.publishAcc = 0;
          this.publish();
        }
      },
    });
    this.input = new Input(canvas, this);
    this.applyPrefs();
    if (this.prefs.sound) {
      // browsers only let sound start from a gesture: resume on the first one
      const wake = () => {
        window.removeEventListener('pointerdown', wake);
        window.removeEventListener('keydown', wake);
        if (this.prefs.sound) void this.audio.enable();
      };
      window.addEventListener('pointerdown', wake);
      window.addEventListener('keydown', wake);
    }
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
      // keep the world safe, then let it rest until someone looks again
      this.hiddenAt = Date.now();
      void this.saveActive();
      this.loop.stop();
      this.audio.pause();
    } else {
      this.audio.resume();
      const away = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
      this.hiddenAt = 0;
      void this.catchUpAfter(away);
    }
  };

  private onPageHide = (): void => {
    void this.saveActive();
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
    this.lostFollow = null;
    this.publish();
  }

  /** Notice when the creature the camera follows leaves the world. */
  private watchFollow(): void {
    const id = this.renderer.followId;
    const lost = this.lostFollow;
    if (id && (!lost || lost.id !== id)) {
      const f = this.world.creatureMap.get(id);
      if (!f || f.dying > 0) {
        this.lostFollow = this.heirsOf(id, f?.customName || f?.name || this.world.history.lineage.nodes.get(id)?.name || '它');
        this.publish();
      }
    }
    // once it has dissolved, an unattended screen simply keeps watching its heir
    if (lost && lost.heirs.length > 0 && this.uiHidden && !this.world.creatureMap.has(lost.id)) this.followHeir();
  }

  private heirsOf(id: number, name: string): LostFollow {
    const w = this.world;
    const alive = w.creatures.filter((c) => c.dying === 0 && c.id !== id);
    const byYouth = (a: Creature, b: Creature) => Number(a.stage === 'egg') - Number(b.stage === 'egg') || b.bornT - a.bornT;
    const kids = alive.filter((c) => c.parentA === id || c.parentB === id).sort(byYouth);
    if (kids.length) return { id, name, heirs: kids.map((c) => c.id), kind: 'child', at: w.time };
    const desc = w.history.lineage.livingDescendants(w, id).sort((a, b) => a.generation - b.generation || b.bornT - a.bornT);
    if (desc.length) return { id, name, heirs: desc.map((c) => c.id), kind: 'descendant', at: w.time };
    const fam = w.creatureMap.get(id)?.familyId ?? 0;
    const kin = fam ? alive.filter((c) => c.familyId === fam && c.stage !== 'egg').sort(byYouth) : [];
    if (kin.length) return { id, name, heirs: kin.map((c) => c.id), kind: 'family', at: w.time };
    return { id, name, heirs: [], kind: 'none', at: w.time };
  }

  /** Continue with the heir of the creature that left. */
  followHeir(): void {
    const lost = this.lostFollow;
    if (!lost) return;
    const heir = lost.heirs.map((h) => this.world.creatureMap.get(h)).find((c) => c && c.dying === 0);
    this.lostFollow = null;
    if (heir) this.follow(heir.id);
    else this.publish();
  }

  dismissLost(): void {
    this.lostFollow = null;
    this.publish();
  }

  // ------------------------------------------------------------ life stories

  watch(id: number): void {
    const c = this.world.creatureMap.get(id);
    if (!c || c.dying > 0) return;
    const s = this.world.history.watch(c);
    this.toast(`开始关注「${s.custom || s.name}」，它的一生会被记下来`);
  }

  unwatch(id: number): void {
    this.world.history.unwatch(id);
    this.publish();
  }

  rename(id: number, name: string): void {
    const c = this.world.creatureMap.get(id);
    if (!c) return;
    const was = this.world.history.isWatched(id);
    this.world.history.rename(c, name);
    const now = c.customName || c.name;
    this.toast(was ? `它现在叫「${now}」了` : `它现在叫「${now}」了，你也开始关注它的一生`);
  }

  /** Select (and follow) a living creature that shows a codex trait. */
  findCarrier(match: (c: Creature) => boolean): boolean {
    const found = this.world.creatures.filter((c) => c.dying === 0 && c.stage !== 'egg' && match(c));
    if (!found.length) return false;
    const pick = found[(this.version * 7) % found.length];
    this.follow(pick.id);
    return true;
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

  // ------------------------------------------------------------ preferences

  setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
    this.prefs = { ...this.prefs, [key]: value };
    savePrefs(this.prefs);
    this.applyPrefs();
    this.publish();
  }

  private applyPrefs(): void {
    const p = this.prefs;
    this.loop.maxFps = p.powerSave ? 30 : 0;
    if (p.quality !== 'auto') this.renderer.quality = p.quality;
    this.audio.setVolume(p.volume);
  }

  async toggleSound(): Promise<void> {
    if (this.prefs.sound) {
      this.audio.disable();
      this.setPref('sound', false);
      return;
    }
    const ok = await this.audio.enable();
    if (ok) this.setPref('sound', true);
    else this.toast('浏览器暂时不允许播放声音');
  }

  /**
   * Automatic quality: step the detail down when frames take too long and
   * back up (slowly, with a cooldown) when there is plenty of headroom.
   */
  private adaptQuality(): void {
    if (this.prefs.quality !== 'auto' || this.loop.paused) return;
    const budget = 1000 / (this.loop.maxFps > 0 ? this.loop.maxFps : 60);
    const work = this.loop.workMs;
    const r = this.renderer;
    this.qualityCooldown = Math.max(0, this.qualityCooldown - 2);
    if (work > budget * 0.85) {
      this.slowWindows++;
      this.fastWindows = 0;
    } else if (work < budget * 0.4) {
      this.fastWindows++;
      this.slowWindows = 0;
    } else {
      this.slowWindows = 0;
      this.fastWindows = 0;
    }
    if (this.slowWindows >= 2 && r.quality > 0) {
      r.quality = (r.quality - 1) as 0 | 1;
      this.slowWindows = 0;
      this.qualityCooldown = 40;
      this.publish();
    } else if (this.fastWindows >= 6 && r.quality < 2 && this.qualityCooldown <= 0) {
      r.quality = (r.quality + 1) as 1 | 2;
      this.fastWindows = 0;
      this.qualityCooldown = 20;
      this.publish();
    }
  }

  // ------------------------------------------------------------ tanks

  /** The tank being shown. */
  tank(): TankInfo {
    return this.profile.tanks.find((t) => t.id === this.tankId) ?? this.profile.tanks[0];
  }

  private async saveProfile(): Promise<void> {
    this.profile.lastSeen = Date.now();
    await this.storage.putDoc(PROFILE_KEY, this.profile);
  }

  /** Write the shown tank (and the profile) to storage. */
  async saveActive(): Promise<boolean> {
    if (this.saving || this.catchUp) return false;
    this.saving = true;
    try {
      const now = Date.now();
      await this.storage.put(tankRecord(this.world, this.tankId, now));
      const info = this.profile.tanks.find((t) => t.id === this.tankId);
      if (info) syncTankInfo(info, this.world, now);
      await this.saveProfile();
      this.lastSavedAt = now;
      return true;
    } catch {
      return false;
    } finally {
      this.saving = false;
    }
  }

  /** 'auto' keeps the tank itself up to date; 'manual' also keeps a snapshot to return to. */
  async save(kind: 'auto' | 'manual', name?: string): Promise<boolean> {
    const ok = await this.saveActive();
    if (kind === 'auto') return ok;
    try {
      const w = this.world;
      const now = Date.now();
      const rec = tankRecord(w, `snap-${now}`, now);
      await this.storage.put({
        ...rec,
        kind: 'manual',
        tankId: this.tankId,
        name: name ?? `${w.name} · ${new Date(now).toLocaleString('zh-CN', { hour12: false })}`,
      });
      this.toast('已保存快照：' + w.name);
      this.publish();
      return true;
    } catch (err) {
      this.toast('保存失败：' + String((err as Error)?.message ?? err));
      return false;
    }
  }

  listSaves(): Promise<SaveMeta[]> {
    return this.storage.list().then((all) => all.filter((m) => m.kind === 'manual'));
  }

  /** Bring a snapshot back into the shown tank. */
  async load(id: string): Promise<void> {
    const rec = await this.storage.get(id);
    if (!rec) {
      this.toast('找不到这个快照');
      return;
    }
    try {
      this.setWorld(restoreWorld(rec.snapshot));
      this.toast('已回到快照：' + rec.worldName);
      await this.saveActive();
    } catch (err) {
      this.toast('读取失败：' + String((err as Error)?.message ?? err));
    }
  }

  async remove(id: string): Promise<void> {
    await this.storage.remove(id);
    this.publish();
  }

  canAddTank(): boolean {
    return this.profile.tanks.length < tankLimit(this.profile);
  }

  /** A new tank with a fresh world, shown right away. */
  async createTank(seed?: string, name?: string, from?: World): Promise<void> {
    if (this.busy) return;
    if (!this.canAddTank()) {
      this.toast(`最多只能养 ${tankLimit(this.profile)} 个水缸`);
      return;
    }
    this.busy = true;
    try {
      await this.saveActive();
      const aspect = window.innerWidth / Math.max(1, window.innerHeight);
      const w = from ?? new World({ seed: seed?.trim() || randomSeed(), aspect, name: name?.trim() || undefined });
      const now = Date.now();
      const id = addTank(this.profile, w, now);
      await this.storage.put(tankRecord(w, id, now));
      this.tankId = id;
      this.setWorld(w);
      await this.saveProfile();
      this.toast('新的水缸醒来了：' + w.name);
    } catch (err) {
      this.toast('创建失败：' + String((err as Error)?.message ?? err));
    } finally {
      this.busy = false;
      this.publish();
    }
  }

  /** Show another tank; it makes up for the time it was not watched. */
  async switchTank(id: string): Promise<void> {
    if (this.busy || this.catchUp || id === this.tankId) return;
    const info = this.profile.tanks.find((t) => t.id === id);
    if (!info) return;
    this.busy = true;
    try {
      await this.saveActive();
      const rec = await this.storage.get(id);
      if (!rec) {
        this.toast('找不到这个水缸');
        return;
      }
      const w = restoreWorld(rec.snapshot);
      this.tankId = id;
      this.profile.activeTank = id;
      this.setWorld(w);
      await this.saveProfile();
      this.busy = false;
      await this.catchUpAfter(Date.now() - info.lastWall);
    } catch (err) {
      this.toast('切换失败：' + String((err as Error)?.message ?? err));
    } finally {
      this.busy = false;
      this.publish();
    }
  }

  async renameTank(id: string, name: string): Promise<void> {
    const clean = name.trim().slice(0, 16);
    const info = this.profile.tanks.find((t) => t.id === id);
    if (!clean || !info) return;
    if (id === this.tankId) {
      this.world.name = clean;
      await this.saveActive();
    } else {
      const rec = await this.storage.get(id);
      if (!rec) return;
      rec.snapshot.name = clean;
      await this.storage.put({ ...rec, name: clean, worldName: clean });
      info.name = clean;
      await this.saveProfile();
    }
    this.publish();
  }

  /** Let a tank go (never the one being shown, never the last one). */
  async deleteTank(id: string): Promise<void> {
    if (id === this.tankId || this.profile.tanks.length <= 1) return;
    await this.storage.remove(id);
    this.profile.tanks = this.profile.tanks.filter((t) => t.id !== id);
    await this.saveProfile();
    this.publish();
  }

  /** Carry a creature to another tank (it continues its life there). */
  async moveCreature(cid: number, toId: string): Promise<void> {
    if (this.busy || this.catchUp || toId === this.tankId) return;
    const info = this.profile.tanks.find((t) => t.id === toId);
    const c = this.world.creatureMap.get(cid);
    if (!info || !c || c.dying > 0) return;
    this.busy = true;
    try {
      const rec = await this.storage.get(toId);
      if (!rec) {
        this.toast('找不到那个水缸');
        return;
      }
      const dest = restoreWorld(rec.snapshot);
      const name = c.customName || c.name;
      const traveller = emigrate(this.world, cid, dest.name);
      if (!traveller) return;
      try {
        immigrate(dest, structuredClone(traveller));
        // the destination keeps its own clock of absence: it has not been running meanwhile
        await this.storage.put(tankRecord(dest, toId, Date.now()));
        info.population = dest.consumerCount + dest.predatorCount + 1;
      } catch (err) {
        immigrate(this.world, traveller);
        throw err;
      }
      if (this.renderer.selectedId === cid) this.select(0);
      if (this.renderer.followId === cid) this.follow(0);
      await this.saveActive();
      this.toast(`「${name}」搬去了「${dest.name}」`);
    } catch (err) {
      this.toast('搬家没有成功：' + String((err as Error)?.message ?? err));
    } finally {
      this.busy = false;
      this.publish();
    }
  }

  newWorld(seed?: string, name?: string): void {
    void this.createTank(seed, name);
  }

  /** The shown tank starts over from its first day. */
  resetWorld(): void {
    const w = new World({ seed: this.world.seed, aspect: this.world.width / this.world.height, name: this.world.name });
    this.setWorld(w);
    this.toast('水缸回到了它的第一天');
    void this.saveActive();
  }

  exportWorld(): void {
    const w = this.world;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    downloadSnapshot(snapshotWorld(w), `浮生-${w.name}-${stamp}.json`);
  }

  /** An exported world arrives as a new tank. */
  async importWorld(file: File): Promise<void> {
    try {
      const snap = await readSnapshotFile(file);
      await this.createTank(undefined, undefined, restoreWorld(snap));
    } catch (err) {
      this.toast('导入失败：' + String((err as Error)?.message ?? err));
    }
  }

  // ------------------------------------------------------------ catching up

  /**
   * Make up for time nobody was watching (closed page, hidden tab, another
   * tank shown): the world runs that long in a worker, capped, skippable.
   */
  async catchUpAfter(awayMs: number): Promise<void> {
    if (!this.prefs.offlineProgress || this.catchUp || awayMs < MIN_AWAY_MS) {
      this.loop.start();
      return;
    }
    const seconds = Math.min(MAX_CATCH_UP, awayMs / 1000);
    const before = this.world;
    const summaryStart = awayFacts(before);
    const now = Date.now();
    this.catchUp = { tankName: before.name, target: seconds, done: 0, awayMs, stopping: false };
    this.loop.stop();
    this.publish();
    try {
      const result = await this.runner.run(snapshotWorld(before), { seconds, wallStart: now - awayMs, wallEnd: now }, (done) => {
        if (this.catchUp) this.catchUp.done = done;
        this.publish();
      });
      if (this.world !== before) return;
      const after = restoreWorld(result.snapshot);
      this.setWorld(after);
      this.catchUp = null;
      if (result.simulated >= 60) this.away = summarizeAway(summaryStart, after, awayMs, result.simulated, result.simulated + 1 < seconds);
      await this.saveActive();
    } catch (err) {
      this.toast('补上离开的时间时出了点问题：' + String((err as Error)?.message ?? err));
    } finally {
      this.catchUp = null;
      this.loop.start();
      this.publish();
    }
  }

  /** Stop catching up now and continue from wherever the world got to. */
  skipCatchUp(): void {
    if (!this.catchUp || this.catchUp.stopping) return;
    this.catchUp.stopping = true;
    this.runner.stop();
    this.publish();
  }

  dismissAway(): void {
    this.away = null;
    this.publish();
  }

  private setWorld(w: World): void {
    this.world = w;
    this.away = null;
    this.renderer.setWorld(w);
    this.aiming = null;
    this.lostFollow = null;
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
