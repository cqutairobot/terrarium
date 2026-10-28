import type { FxEvent, World } from '../sim/world';

/** Major pentatonic steps (semitones above the root). */
const PENTA = [0, 2, 4, 7, 9];
const ROOT = 523.25; // C5

type Layer = { gain: GainNode; filter: BiquadFilterNode };

/**
 * Procedural ambience, synthesized live with Web Audio (no recordings):
 * a low watery hush, a slow swell, rain during storms, the odd bubble and
 * soft pentatonic chimes for births and rare arrivals. Silent by default;
 * a browser only allows it to start from a user gesture.
 */
export class Ambient {
  enabled = false;
  volume = 0.6;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private fxBus: GainNode | null = null;
  private water: Layer | null = null;
  private swell: Layer | null = null;
  private rain: Layer | null = null;
  private nextBubble = 0;
  private lastChime = -10;
  private lastPlip = -10;
  private lastMood = -10;

  /** Start (or resume) the sound. Call from a user gesture. */
  async enable(): Promise<boolean> {
    try {
      if (!this.ctx) this.build();
      const ctx = this.ctx!;
      if (ctx.state !== 'running') await ctx.resume();
      this.enabled = true;
      this.master!.gain.cancelScheduledValues(ctx.currentTime);
      this.master!.gain.setTargetAtTime(this.volume * 0.8, ctx.currentTime, 0.8);
      return true;
    } catch {
      this.enabled = false;
      return false;
    }
  }

  disable(): void {
    this.enabled = false;
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
    setTimeout(() => {
      if (!this.enabled) void ctx.suspend();
    }, 1500);
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ctx && this.master && this.enabled) this.master.gain.setTargetAtTime(this.volume * 0.8, this.ctx.currentTime, 0.2);
  }

  /** The page is hidden: let the speakers rest too. */
  pause(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.enabled) void this.ctx.resume();
  }

  private build(): void {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);
    this.master = master;

    // a soft echo for the chimes and bubbles: delay with a darkening feedback loop
    const fxBus = ctx.createGain();
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.33;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dark = ctx.createBiquadFilter();
    dark.type = 'lowpass';
    dark.frequency.value = 1700;
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    fxBus.connect(master);
    fxBus.connect(delay);
    delay.connect(dark).connect(fb).connect(delay);
    dark.connect(wet).connect(master);
    this.fxBus = fxBus;

    const brown = noiseBuffer(ctx, 'brown');
    const pink = noiseBuffer(ctx, 'pink');
    this.water = this.noiseLayer(brown, 'lowpass', 380, 0.5, 0.5);
    this.swell = this.noiseLayer(pink, 'bandpass', 520, 0.8, 0.035);
    this.rain = this.noiseLayer(pink, 'highpass', 2600, 0.4, 0);
    // slow tides in the water and the swell
    this.lfo(0.07, 140, this.water.filter.frequency);
    this.lfo(0.031, 0.12, this.water.gain.gain);
    this.lfo(0.047, 0.025, this.swell.gain.gain);
    this.lfo(0.019, 180, this.swell.filter.frequency);
  }

  private noiseLayer(buffer: AudioBuffer, type: BiquadFilterType, freq: number, q: number, level: number): Layer {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = level;
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(0, Math.random() * buffer.duration);
    return { gain, filter };
  }

  private lfo(freq: number, depth: number, target: AudioParam): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.frequency.value = freq;
    const amt = ctx.createGain();
    amt.gain.value = depth;
    osc.connect(amt).connect(target);
    osc.start(ctx.currentTime + Math.random());
  }

  /** Follow the world's mood: night, storms, cold. Called every frame. */
  update(world: World): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || ctx.state !== 'running') return;
    const env = world.env;
    const t = ctx.currentTime;
    const storm = env.turbulence;
    if (t - this.lastMood > 0.5) {
      this.lastMood = t;
      const night = 1 - env.daylight;
      const cold = Math.max(0, 0.45 - env.temperature) * 2;
      this.water!.filter.frequency.setTargetAtTime(380 - 120 * night + 260 * storm, t, 1.5);
      this.water!.gain.gain.setTargetAtTime(0.5 + 0.25 * storm, t, 1.5);
      this.swell!.gain.gain.setTargetAtTime(0.035 + 0.05 * cold + 0.03 * storm, t, 2);
      this.rain!.gain.gain.setTargetAtTime(0.07 * storm, t, 1.2);
    }
    if (t >= this.nextBubble) {
      const busy = 1 + 2 * storm;
      const n = Math.random() < 0.3 ? 2 + Math.floor(Math.random() * 3) : 1;
      for (let i = 0; i < n; i++) this.bubble(t + i * (0.04 + Math.random() * 0.06), 0.6 + Math.random() * 0.8);
      this.nextBubble = t + (2 + Math.random() * 6) / busy;
    }
  }

  /** Gentle feedback for things that happened in the tank. */
  handle(e: FxEvent): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    switch (e.type) {
      case 'hatch':
        if (t - this.lastChime > 2.2 && Math.random() < 0.35) {
          this.lastChime = t;
          this.chime(t, PENTA[Math.floor(Math.random() * PENTA.length)] + (Math.random() < 0.3 ? 12 : 0), 0.03);
        }
        break;
      case 'rareBirth':
        this.lastChime = t;
        [0, 4, 7, 12].forEach((s, i) => this.chime(t + i * 0.13, s, 0.045));
        break;
      case 'feed':
        if (t - this.lastPlip > 0.12) {
          this.lastPlip = t;
          this.bubble(t, 1.5 + Math.random() * 0.5);
        }
        break;
      case 'impact':
        this.thump(t);
        break;
      default:
        break;
    }
  }

  private bubble(t: number, pitch: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f0 = 260 * pitch + Math.random() * 120;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 2.3, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.03, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(g).connect(this.fxBus!);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  private chime(t: number, semis: number, level: number): void {
    const ctx = this.ctx!;
    const f = ROOT * Math.pow(2, semis / 12);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(level, t + 0.01);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 3200;
    out.connect(soft).connect(this.fxBus!);
    for (const [mult, amp] of [
      [1, 1],
      [2, 0.22],
      [3.01, 0.07],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mult;
      const a = ctx.createGain();
      a.gain.value = amp;
      o.connect(a).connect(out);
      o.start(t);
      o.stop(t + 2.3);
    }
  }

  private thump(t: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 1.7);
  }
}

/** A few seconds of loopable noise: brown (deep water) or pink (swell, rain). */
function noiseBuffer(ctx: AudioContext, kind: 'brown' | 'pink'): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 4);
  const fade = Math.floor(ctx.sampleRate * 0.25);
  const raw = new Float32Array(len + fade);
  let last = 0;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < raw.length; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === 'brown') {
      last = (last + 0.02 * white) / 1.02;
      raw[i] = last * 3.5;
    } else {
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      raw[i] = (b0 + b1 + b2 + white * 0.1848) * 0.11;
    }
  }
  // crossfade the tail into the head so the loop has no seam
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = raw[i];
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[i] = raw[i] * k + raw[len + i] * (1 - k);
  }
  return buf;
}
