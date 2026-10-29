import { Ambient } from '../audio/ambient';
import { awayFacts, summarizeAway, type AwaySummary } from '../game/away';
import { bond, forecastBrood, pairProblem, unbond, type BroodForecast } from '../game/breeding';
import { canBuy, itemById, priceOf, rewardFor, vitalityPerMinute } from '../game/economy';
import { candidatesFor, closeRequest, ecologyStatus, refreshBoard } from '../game/requests';
import { TUTORIAL } from '../game/tutorial';
import { pushStory } from '../sim/history/stories';
import { mainTankCount, PROFILE_KEY, tankLimit, type Profile, type TankInfo } from '../game/profile';
import { shownHue } from '../game/conditions';
import { cardLimit, has } from '../game/economy';
import { addTank, syncTankInfo, tankRecord } from '../game/tanks';
import { FOOD_TOOLS, levelCall, levelDisaster, levelEnv, levelFeed, levelPair, levelRelease } from '../game/levels/actions';
import { capOf, LevelRun } from '../game/levels/run';
import { createLevelWorld } from '../game/levels/setup';
import type { LevelDef, ToolKind } from '../game/levels/types';
import type { StorageAdapter, SaveMeta } from '../persist/storage';
import { downloadSnapshot, readSnapshotFile } from '../persist/exportImport';
import { Renderer } from '../render/renderer';
import type { EcoConfig, EnvSettings } from '../sim/config';
import type { Creature } from '../sim/entities/creature';
import { FOOD_LABELS, type FoodKind } from '../sim/entities/food';
import { DISASTER_LABELS, type DisasterKind } from '../sim/environment';
import { cloneGenome, G } from '../sim/genome';
import { FORM_ARCHETYPES } from '../sim/archetypes';
import type { BiomeId } from '../sim/biomes';
import { MAX_DECOR, placeDecor, removeDecor, type DecorKind } from '../sim/decor';
import { emigrate, hatchGenome, immigrate } from '../sim/migration';
import { rareTraitKeys } from '../sim/rareTraits';
import { introduceFounders, plantAnemone, plantMoss, scatterSeeds } from '../sim/systems/ecology';
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

/** A little "+N" that floats up from the lumen counter. */
export interface LumenPop {
  id: number;
  amount: number;
  reason: string;
}

/** Where a challenge stands: its story before, the attempt, the results after. */
export type LevelPhase = 'intro' | 'playing' | 'result';

/** What finishing a challenge brought. */
export interface LevelResult {
  /** Stars beyond the best earned before. */
  newStars: number;
  lumen: number;
}

/** Reviving a gene card costs a little lumen (and the egg is made of the tank's own matter). */
export const REVIVE_PRICE = 15;

const AUTOSAVE_EVERY = 60;
/** Vitality paid for one catch-up is capped, so long absences do not flood the purse. */
const VITALITY_CATCH_UP_CAP = 60;
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
  /** Choosing a partner for this creature (the next creature clicked). */
  pairing: { firstId: number } | null = null;
  /** Two creatures proposed as a pair, with what their young would be like. */
  pairOffer: { a: number; b: number; forecast: BroodForecast } | null = null;
  lumenPops: LumenPop[] = [];
  /** Pinches of food scattered this session (the tutorial watches it). */
  feeds = 0;
  /** Something bought that waits to be set down (shop item id; the next click on the floor places it). */
  placing: string | null = null;
  /** A challenge being played; the garden tank waits in storage (and lives on) meanwhile. */
  level: LevelRun | null = null;
  levelPhase: LevelPhase = 'intro';
  levelResult: LevelResult | null = null;
  private levelAcc = 0;
  /** Tools the player has already been told are spent (said once per attempt). */
  private spentSaid = new Set<string>();
  private economyAcc = 0;
  private profileDirty = false;
  private profileSaveAcc = 0;
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
      step: (dt) => {
        this.world.step(dt);
        if (this.level) this.tickLevel(dt);
      },
      tick: (realDt) => {
        this.world.realTime += realDt;
        this.autosaveAcc += realDt;
        if (this.autosaveAcc >= (this.prefs.powerSave ? AUTOSAVE_EVERY_QUIET : AUTOSAVE_EVERY)) {
          this.autosaveAcc = 0;
          this.idle(() => void this.saveActive());
        }
        this.economyAcc += realDt;
        if (this.economyAcc >= 1 && !this.level) {
          this.economyAcc = 0;
          this.collectRewards();
          this.tendRequests();
        }
        // lumen is precious: write the profile soon after it changes
        this.profileSaveAcc += realDt;
        if (this.profileDirty && this.profileSaveAcc >= 10 && !this.saving) {
          this.profileSaveAcc = 0;
          void this.saveProfile();
        }
        this.qualityAcc += realDt;
        if (this.qualityAcc >= 2) {
          this.qualityAcc = 0;
          this.adaptQuality();
        }
      },
      gap: (seconds) => {
        // the machine slept with the page open: make up for it like any absence (a challenge simply goes on)
        if (this.level) return;
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
      // a challenge waits for the player; the garden makes up for the time
      if (this.level) this.loop.start();
      else void this.catchUpAfter(away);
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

  // ------------------------------------------------------------ pairing

  startPairing(id: number): void {
    const c = this.world.creatureMap.get(id);
    if (!c || c.dying > 0 || c.stage === 'egg') return;
    if (!this.allowed('pair', '配对')) return;
    this.aiming = null;
    this.pairOffer = null;
    this.pairing = { firstId: id };
    this.publish();
  }

  cancelPairing(): void {
    this.pairing = null;
    this.pairOffer = null;
    this.publish();
  }

  /** The second creature was chosen: show what their young would be like. */
  choosePartner(id: number): void {
    const first = this.pairing ? this.world.creatureMap.get(this.pairing.firstId) : undefined;
    const second = this.world.creatureMap.get(id);
    if (!first || !second) {
      this.cancelPairing();
      return;
    }
    const problem = pairProblem(first, second);
    if (problem) {
      this.toast(problem);
      return;
    }
    this.pairing = null;
    this.pairOffer = { a: first.id, b: second.id, forecast: forecastBrood(this.world, first, second) };
    this.publish();
  }

  confirmPair(): void {
    const offer = this.pairOffer;
    const a = offer ? this.world.creatureMap.get(offer.a) : undefined;
    const b = offer ? this.world.creatureMap.get(offer.b) : undefined;
    this.pairOffer = null;
    if (!a || !b || a.dying > 0 || b.dying > 0) {
      this.publish();
      return;
    }
    if (this.level) {
      const problem = levelPair(this.level, this.world, a, b);
      if (problem) {
        this.toast(problem);
        return;
      }
    } else bond(this.world, a, b);
    const name = (c: Creature) => c.customName || c.name;
    this.world.history.note(a.id, 'bonded', { mate: name(b) });
    this.world.history.note(b.id, 'bonded', { mate: name(a) });
    this.toast(`「${name(a)}」和「${name(b)}」结为伴侣，都准备好时就会去找对方`);
  }

  breakBond(id: number): void {
    const c = this.world.creatureMap.get(id);
    if (c) unbond(this.world, c);
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
    if (this.level) {
      if (!this.allowed(FOOD_TOOLS[this.tool], FOOD_LABELS[this.tool])) return;
      levelFeed(this.level, this.world, this.tool, x, y, count);
      this.publish();
    } else this.world.feed(this.tool, x, y, count);
    this.feeds++;
  }

  /** Holding the button pours food freely, except where a challenge counts every pinch. */
  canPour(): boolean {
    return !this.level || this.tool === 'none' || this.level.left(FOOD_TOOLS[this.tool]) === Infinity;
  }

  // ------------------------------------------------------------ tutorial

  advanceTutorial(): void {
    const t = this.profile.tutorial;
    t.step++;
    if (t.step >= TUTORIAL.length) t.done = true;
    this.profileDirty = true;
    this.publish();
  }

  skipTutorial(): void {
    this.profile.tutorial.done = true;
    this.profileDirty = true;
    this.publish();
  }

  aim(kind: DisasterKind | null): void {
    if (kind && !this.allowed(`disaster:${kind}`, DISASTER_LABELS[kind])) return;
    this.aiming = kind;
    this.publish();
  }

  disaster(kind: DisasterKind, x?: number, y?: number): void {
    this.aiming = null;
    if (this.level) {
      if (this.allowed(`disaster:${kind}`, DISASTER_LABELS[kind])) levelDisaster(this.level, this.world, kind, x, y);
    } else this.world.disaster(kind, x, y);
    this.publish();
  }

  setEnv(patch: Partial<EnvSettings>): void {
    if (this.level) {
      if (!this.level.def.tools.env) this.sayOnce('env', '这一关不能调节环境');
      else if (this.levelPhase === 'playing') levelEnv(this.level, this.world, patch);
    } else Object.assign(this.world.env.settings, patch);
    this.publish();
  }

  setConfig(patch: Partial<EcoConfig>): void {
    if (this.level) return;
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
    this.profileDirty = false;
    await this.storage.putDoc(PROFILE_KEY, this.profile);
  }

  // ------------------------------------------------------------ lumen

  /** Add lumen; notable amounts are also announced. */
  earn(amount: number, reason: string, quiet = false): void {
    if (amount <= 0) return;
    this.profile.lumen += amount;
    this.profile.lumenEarned += amount;
    this.profileDirty = true;
    const pop = { id: this.toastId++, amount, reason };
    this.lumenPops = [...this.lumenPops.slice(-3), pop];
    setTimeout(() => {
      this.lumenPops = this.lumenPops.filter((x) => x !== pop);
      this.publish();
    }, 2600);
    if (!quiet && amount >= 15) this.toast(`+${amount} 灵光 · ${reason}`);
    this.publish();
  }

  /**
   * Reward what really happened in the shown tank since last time (from its
   * chronicle), plus a gentle income for a living, varied tank.
   */
  private collectRewards(quietSummary = false): void {
    const info = this.profile.tanks.find((t) => t.id === this.tankId);
    if (!info) return;
    const w = this.world;
    const chron = w.history.chronicle;
    const lastId = chron.length ? chron[chron.length - 1].id : 0;
    if (info.seenEvent === undefined) {
      // a tank from before the economy existed: its past is not paid out
      info.seenEvent = lastId;
      info.vitalityT = w.time;
      info.vitality = 0;
      this.profileDirty = true;
      return;
    }
    let total = 0;
    let count = 0;
    for (let i = chron.length - 1; i >= 0 && chron[i].id > info.seenEvent; i--) {
      const r = rewardFor(chron[i], this.profile);
      if (!r) continue;
      if (r.flag) this.profile.flags[r.flag] = 1;
      if (quietSummary) {
        total += r.amount;
        count++;
      } else this.earn(r.amount, r.reason);
    }
    info.seenEvent = Math.max(info.seenEvent, lastId);
    const minutes = Math.max(0, w.time - (info.vitalityT ?? w.time)) / 60;
    info.vitalityT = w.time;
    const due = (info.vitality ?? 0) + Math.min(VITALITY_CATCH_UP_CAP, minutes * vitalityPerMinute(w));
    const whole = Math.floor(due);
    info.vitality = due - whole;
    if (quietSummary) total += whole;
    else if (whole > 0) this.earn(whole, '水缸里生机勃勃', true);
    if (quietSummary && total > 0) this.earn(total, count > 0 ? `你不在时的 ${count} 个发现与水缸的生机` : '你不在时水缸的生机');
  }

  // ------------------------------------------------------------ requests

  /** Keep the board full, finish ecology requests the tank has met, notice ready deliveries. */
  private tendRequests(): void {
    const board = this.profile.requests;
    const w = this.world;
    if (refreshBoard(board, w, Date.now())) this.profileDirty = true;
    for (const r of [...board.open]) {
      if (r.kind === 'ecology') {
        if (ecologyStatus(w, board, r).met) this.completeRequest(r.id);
      } else if (!r.ready && candidatesFor(w, r).length > 0) {
        r.ready = true;
        this.profileDirty = true;
        this.toast(`「${w.name}」里有生命符合${r.from}的委托了`);
      }
    }
  }

  private completeRequest(id: string): void {
    const r = this.profile.requests.open.find((x) => x.id === id);
    if (!r) return;
    closeRequest(this.profile.requests, id, true);
    this.earn(r.reward, `完成了${r.from}的委托`, true);
    this.toast(`完成委托：${r.from}收到了「${r.goal}」 · +${r.reward} 灵光`);
    refreshBoard(this.profile.requests, this.world, Date.now());
  }

  /** Give a matching creature to the one who asked; it leaves the tank for good. */
  async deliverRequest(id: string, cid: number): Promise<void> {
    if (this.level) return;
    const r = this.profile.requests.open.find((x) => x.id === id);
    const c = this.world.creatureMap.get(cid);
    if (!r || !c || !candidatesFor(this.world, r).includes(c)) return;
    // a watched life keeps its place in the archive, its story closed with the journey
    if (!this.sendAway(cid, r.from, 'delivered')) return;
    this.completeRequest(id);
    await this.saveActive();
  }

  /** A creature leaves the tank for good; a watched one's story closes with how it left. */
  private sendAway(cid: number, to: string, k: 'delivered' | 'released'): boolean {
    const w = this.world;
    const c = w.creatureMap.get(cid);
    if (!c) return false;
    const age = c.age;
    const t = emigrate(w, cid, to);
    if (!t) return false;
    if (t.story) {
      const s = t.story;
      if (s.events[s.events.length - 1]?.k === 'moved') s.events.pop();
      pushStory(s, { t: w.time, w: Date.now(), k, p: { to } });
      s.diedT = w.time;
      s.diedW = Date.now();
      s.cause = '远行';
      s.age = age;
      w.history.stories.set(s.id, s);
    }
    if (this.renderer.selectedId === cid) this.select(0);
    if (this.renderer.followId === cid) this.follow(0);
    return true;
  }

  /** Let a creature go: a small thank-you in lumen, more for rare looks. */
  async release(cid: number): Promise<void> {
    const c = this.world.creatureMap.get(cid);
    if (!c || c.dying > 0 || this.catchUp) return;
    const name = c.customName || c.name;
    if (this.level) {
      if (!this.allowed('release', '放生') || !levelRelease(this.level, this.world, cid)) return;
      if (this.renderer.selectedId === cid) this.select(0);
      if (this.renderer.followId === cid) this.follow(0);
      this.toast(`「${name}」游向了远方`);
      return;
    }
    const gift = Math.min(20, 2 + 5 * rareTraitKeys(c.ph.rare).length);
    if (!this.sendAway(cid, '远方的湖泊', 'released')) return;
    this.earn(gift, `放生了「${name}」`, true);
    this.toast(`「${name}」游向了远方 · +${gift} 灵光`);
    await this.saveActive();
  }

  // ------------------------------------------------------------ gene cards

  /** Keep a creature's genes on a card, to revive later in any tank (or take into a challenge). */
  saveCard(cid: number): void {
    if (this.level) return;
    const c = this.world.creatureMap.get(cid);
    if (!c) return;
    const p = this.profile;
    if (p.geneCards.length >= cardLimit(p)) {
      this.toast(`生命卡已经满了（${cardLimit(p)} 张）`);
      return;
    }
    p.geneCards.push({
      id: `card-${Date.now()}-${c.id}`,
      name: c.customName || c.name,
      genome: cloneGenome(c.genome),
      species: this.world.species.get(c.speciesId)?.name ?? '',
      generation: c.generation,
      hue: shownHue(c),
      savedAt: Date.now(),
    });
    this.profileDirty = true;
    this.toast(`「${c.customName || c.name}」的基因存成了生命卡`);
  }

  deleteCard(id: string): void {
    this.profile.geneCards = this.profile.geneCards.filter((x) => x.id !== id);
    this.profileDirty = true;
    this.publish();
  }

  /** A gene card comes back to life as an egg in the shown tank. */
  async reviveCard(id: string): Promise<void> {
    if (this.level) {
      this.toast('生命卡要回到自己的水缸里才能复苏');
      return;
    }
    const card = this.profile.geneCards.find((x) => x.id === id);
    if (!card || this.catchUp) return;
    if (this.profile.lumen < REVIVE_PRICE) {
      this.toast('灵光不够');
      return;
    }
    if (card.genome.g[G.diet] > 0.65 && this.tank().kind === 'nursery') {
      this.toast('育种缸里不能放掠食者');
      return;
    }
    const egg = hatchGenome(this.world, card.genome, card.generation);
    if (!egg) {
      this.toast('水里的养分不够孕育一颗卵，过一会儿再试试');
      return;
    }
    this.profile.lumen -= REVIVE_PRICE;
    this.profileDirty = true;
    this.select(egg.id);
    this.toast(`生命卡「${card.name}」在「${this.world.name}」里化作了一颗卵`);
    await this.saveActive();
  }

  /** Set a request aside; a new one takes its place. */
  skipRequest(id: string): void {
    closeRequest(this.profile.requests, id, false);
    refreshBoard(this.profile.requests, this.world, Date.now());
    this.profileDirty = true;
    this.publish();
  }

  /** Buy something from the shop; goods arrive in the shown tank. */
  async buy(id: string): Promise<void> {
    if (this.level) return;
    const item = itemById(id);
    if (!item || this.catchUp) return;
    const check = canBuy(this.profile, item);
    if (!check.ok) {
      this.toast(check.why ?? '现在还买不了');
      return;
    }
    if (item.predators && this.tank().kind === 'nursery') {
      this.toast('育种缸里不能放掠食者');
      return;
    }
    const price = priceOf(this.profile, item);
    if (item.place) {
      if (id.startsWith('decor:') && this.world.decor.length >= MAX_DECOR) {
        this.toast(`一个水缸最多放 ${MAX_DECOR} 件装饰`);
        return;
      }
      // paid for when it is set down
      this.aiming = null;
      this.placing = id;
      this.toast(`点击缸底，放下「${item.name}」 · 右键或 Esc 取消`);
      this.publish();
      return;
    }
    if (item.kind === 'goods') {
      const ok = this.deliver(id);
      if (!ok) {
        this.toast('水缸里现在放不下了');
        return;
      }
    } else this.profile.unlocks.push(id);
    this.profile.lumen -= price;
    if (id === 'nursery') await this.createNursery();
    this.toast(item.kind === 'goods' ? `「${item.name}」来到了「${this.world.name}」` : `得到了「${item.name}」`);
    await this.saveProfile();
    if (item.kind === 'goods') await this.saveActive();
    this.publish();
  }

  private deliver(id: string): boolean {
    if (id === 'seeds') return scatterSeeds(this.world, 6) > 0;
    if (id === 'moss') return plantMoss(this.world, 6) > 0;
    if (id.startsWith('founders:')) {
      const key = id.slice('founders:'.length);
      const predator = key === 'glider' || key === 'lurker';
      const count = predator ? 2 : (FORM_ARCHETYPES.find((a) => a.key === key)?.count ?? 6);
      const room = this.world.cfg.maxCreatures - this.world.creatures.length;
      if (room < count) return false;
      return introduceFounders(this.world, key, count).length > 0;
    }
    return false;
  }

  /** Write the shown tank (and the profile) to storage. */
  async saveActive(): Promise<boolean> {
    // a challenge's tank is never written over the garden
    if (this.saving || this.catchUp || this.level) return false;
    this.saving = true;
    try {
      this.collectRewards();
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
    if (this.level) return false;
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
    if (this.level) return;
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
    return mainTankCount(this.profile) < tankLimit(this.profile);
  }

  nursery(): TankInfo | undefined {
    return this.profile.tanks.find((t) => t.kind === 'nursery');
  }

  /** The nursery: small, calm, no predators, and empty until the player brings someone. */
  async createNursery(): Promise<void> {
    if (this.level) return;
    if (!has(this.profile, 'nursery') || this.nursery() || this.busy) return;
    this.busy = true;
    try {
      const w = new World({ seed: randomSeed(), aspect: 1.3, name: '育种缸', config: { wildLife: false, maxPredators: 0 }, lifeless: true });
      const now = Date.now();
      const keep = this.profile.activeTank;
      const id = addTank(this.profile, w, now, 'nursery');
      this.profile.activeTank = keep;
      await this.storage.put(tankRecord(w, id, now));
      await this.saveProfile();
      this.toast('育种缸准备好了：在顶部切换过去，再把选中的生命搬进来');
    } finally {
      this.busy = false;
      this.publish();
    }
  }

  /** A new tank with a fresh world, shown right away. */
  async createTank(seed?: string, name?: string, from?: World, biome: BiomeId = 'shallows'): Promise<void> {
    if (this.level) return;
    if (this.busy) return;
    if (!this.canAddTank()) {
      this.toast(`最多只能养 ${tankLimit(this.profile)} 个水缸`);
      return;
    }
    this.busy = true;
    try {
      await this.saveActive();
      const aspect = window.innerWidth / Math.max(1, window.innerHeight);
      if (biome !== 'shallows' && !has(this.profile, `biome:${biome}`)) biome = 'shallows';
      const w = from ?? new World({ seed: seed?.trim() || randomSeed(), aspect, name: name?.trim() || undefined, biome });
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
    if (this.level) return;
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
    if (this.level) return;
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
    if (this.level) return;
    if (this.busy || this.catchUp || toId === this.tankId) return;
    const info = this.profile.tanks.find((t) => t.id === toId);
    const c = this.world.creatureMap.get(cid);
    if (!info || !c || c.dying > 0) return;
    if (info.kind === 'nursery' && c.ph.trophic === 'carnivore') {
      this.toast('育种缸里不能放掠食者');
      return;
    }
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
    if (this.level) return;
    const w = new World({ seed: this.world.seed, aspect: this.world.width / this.world.height, name: this.world.name });
    this.setWorld(w);
    this.toast('水缸回到了它的第一天');
    void this.saveActive();
  }

  exportWorld(): void {
    if (this.level) return;
    const w = this.world;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    downloadSnapshot(snapshotWorld(w), `浮生-${w.name}-${stamp}.json`);
  }

  /** An exported world arrives as a new tank. */
  async importWorld(file: File): Promise<void> {
    if (this.level) return;
    try {
      const snap = await readSnapshotFile(file);
      await this.createTank(undefined, undefined, restoreWorld(snap));
    } catch (err) {
      this.toast('导入失败：' + String((err as Error)?.message ?? err));
    }
  }

  // ------------------------------------------------------------ decorations

  /** Set what was bought down where the player clicked (its price is paid now). */
  async placeAt(x: number): Promise<void> {
    const id = this.placing;
    this.placing = null;
    const item = id ? itemById(id) : undefined;
    if (!id || !item || this.level) {
      this.publish();
      return;
    }
    const price = priceOf(this.profile, item);
    if (this.profile.lumen < price) {
      this.toast('灵光不够');
      return;
    }
    if (id.startsWith('decor:')) {
      if (!placeDecor(this.world, id.slice('decor:'.length) as DecorKind, x)) {
        this.toast(`一个水缸最多放 ${MAX_DECOR} 件装饰`);
        return;
      }
    } else if (id === 'anemone' && !plantAnemone(this.world, x)) {
      this.toast('水里的养分不够，过一会儿再试试');
      return;
    }
    this.profile.lumen -= price;
    this.profileDirty = true;
    this.toast(`「${item.name}」放好了`);
    await this.saveActive();
    this.publish();
  }

  cancelPlacing(): void {
    this.placing = null;
    this.publish();
  }

  /** Take a decoration out of the shown tank (it is not refunded). */
  async removeDecoration(id: number): Promise<void> {
    if (this.level || !removeDecor(this.world, id)) return;
    await this.saveActive();
    this.publish();
  }

  // ------------------------------------------------------------ challenges

  /** The gene lens shows hidden alleles once unlocked, and always in a challenge. */
  lens(): boolean {
    return this.level !== null || has(this.profile, 'lens');
  }

  private sayOnce(key: string, text: string): void {
    if (this.spentSaid.has(key)) return;
    this.spentSaid.add(key);
    this.toast(text);
  }

  /** In a challenge: may this tool be used now? (Says why not, once.) Always true in the garden. */
  private allowed(tool: ToolKind, label: string): boolean {
    const run = this.level;
    if (!run) return true;
    if (this.levelPhase !== 'playing') return false;
    if (run.left(tool) > 0) return true;
    this.sayOnce(tool, capOf(run.def, tool) === undefined ? `这一关不能用${label}` : `这一关的${label}用完了`);
    return false;
  }

  /** Leave the garden (saved; it lives on meanwhile) for a challenge. */
  async startLevel(def: LevelDef): Promise<void> {
    if (this.busy || this.catchUp) return;
    this.busy = true;
    try {
      if (!this.level) await this.saveActive();
      this.openLevel(def, 'intro');
    } finally {
      this.busy = false;
      this.publish();
    }
  }

  private openLevel(def: LevelDef, phase: LevelPhase): void {
    const w = createLevelWorld(def, window.innerWidth / Math.max(1, window.innerHeight));
    this.pairing = null;
    this.pairOffer = null;
    this.select(0);
    this.setWorld(w);
    this.level = new LevelRun(def, w);
    this.levelPhase = phase;
    this.levelResult = null;
    this.levelAcc = 0;
    this.spentSaid.clear();
    this.tool = def.tools.food !== undefined ? 'pellet' : 'none';
    this.loop.timeScale = 1;
    // the tank holds still while the story is told
    this.loop.paused = phase === 'intro';
    this.loop.start();
  }

  /** The intro has been read: the clock starts. */
  beginLevel(): void {
    if (!this.level || this.levelPhase !== 'intro') return;
    this.levelPhase = 'playing';
    this.loop.paused = false;
    this.publish();
  }

  restartLevel(): void {
    if (!this.level || this.busy) return;
    this.openLevel(this.level.def, 'playing');
    this.publish();
  }

  /** Back to the garden, which made up for the time it was left alone. */
  async exitLevel(): Promise<void> {
    if (!this.level || this.busy) return;
    this.busy = true;
    try {
      this.level = null;
      this.levelResult = null;
      this.pairing = null;
      this.pairOffer = null;
      this.select(0);
      const rec = await this.storage.get(this.tankId);
      const info = this.tank();
      this.setWorld(rec ? restoreWorld(rec.snapshot) : new World({ seed: info?.seed ?? randomSeed() }));
      this.loop.timeScale = 1;
      this.loop.paused = false;
      this.tool = 'pellet';
      this.busy = false;
      await this.catchUpAfter(Date.now() - (info?.lastWall ?? Date.now()));
    } catch (err) {
      this.toast('回到水缸时出了点问题：' + String((err as Error)?.message ?? err));
    } finally {
      this.busy = false;
      this.publish();
    }
  }

  /** Let the level's newcomers in (a challenge tool). */
  callNewcomers(): void {
    const run = this.level;
    if (!run?.def.tools.call || !this.allowed('call', run.def.tools.call.label)) return;
    if (!levelCall(run, this.world)) this.toast('缸里已经太挤了');
    this.publish();
  }

  /** The level's own clock, kept in simulated seconds. */
  private tickLevel(dt: number): void {
    const run = this.level!;
    if (this.levelPhase !== 'playing') return;
    this.levelAcc += dt;
    if (this.levelAcc < 1) return;
    this.levelAcc -= 1;
    run.update(this.world);
    for (const m of run.messages.splice(0)) this.toast(m);
    if (run.status !== 'playing') this.finishLevel();
  }

  private finishLevel(): void {
    const run = this.level!;
    this.levelPhase = 'result';
    this.pairing = null;
    this.pairOffer = null;
    this.aiming = null;
    let newStars = 0;
    let lumen = 0;
    if (run.status === 'won') {
      const key = run.def.id;
      const prev = this.profile.levels[key];
      const had = prev?.stars ?? 0;
      newStars = Math.max(0, run.stars - had);
      // a level's lumen comes a third per star, each star paid once
      lumen = Math.round((run.def.reward.lumen * newStars) / 3);
      const best = prev?.bestTime === undefined || run.endT < prev.bestTime;
      this.profile.levels[key] = { stars: Math.max(had, run.stars), bestTime: best ? run.endT : prev?.bestTime, at: Date.now() };
      const unlock = run.def.reward.unlock;
      if (unlock && !this.profile.unlocks.includes(unlock)) this.profile.unlocks.push(unlock);
      if (lumen > 0) this.earn(lumen, `挑战「${run.def.name}」`, true);
      this.profileDirty = true;
      void this.saveProfile();
    }
    this.levelResult = { newStars, lumen };
    this.publish();
  }

  // ------------------------------------------------------------ catching up

  /**
   * Make up for time nobody was watching (closed page, hidden tab, another
   * tank shown): the world runs that long in a worker, capped, skippable.
   */
  async catchUpAfter(awayMs: number): Promise<void> {
    if (!this.prefs.offlineProgress || this.catchUp || this.level || awayMs < MIN_AWAY_MS) {
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
      this.collectRewards(true);
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
