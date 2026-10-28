/**
 * Fixed-timestep loop: the simulation advances in constant SIM_DT steps no
 * matter the display refresh rate; rendering interpolates between steps.
 */
export interface LoopHooks {
  step(dt: number): void;
  render(alpha: number, realDt: number, visualTime: number): void;
  /** Called once per frame with the real time elapsed while running. */
  tick?(realDt: number): void;
}

export class Loop {
  timeScale = 1;
  paused = false;
  /** Render no faster than this (0 = every animation frame). */
  maxFps = 0;
  /** Effective speed actually achieved (may fall below timeScale if the CPU cannot keep up). */
  achievedScale = 1;
  private acc = 0;
  private last = -1;
  private lastRender = 0;
  private raf = 0;
  private running = false;
  private visualTime = 0;
  private stepsWindow = 0;
  private wantedWindow = 0;
  private windowStart = 0;

  constructor(
    private readonly simDt: number,
    private readonly hooks: LoopHooks,
    private readonly maxStepsPerFrame = 16,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = -1;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    if (this.last < 0) {
      this.last = now;
      this.windowStart = now;
      return;
    }
    // clamp long gaps (tab switches, sleeps) so we never try to catch up
    const realDt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.visualTime += realDt;
    if (!this.paused) {
      this.hooks.tick?.(realDt);
      const wanted = realDt * this.timeScale;
      this.acc += wanted;
      this.wantedWindow += wanted;
      let steps = 0;
      while (this.acc >= this.simDt && steps < this.maxStepsPerFrame) {
        this.hooks.step(this.simDt);
        this.acc -= this.simDt;
        steps++;
      }
      this.stepsWindow += steps * this.simDt;
      if (steps === this.maxStepsPerFrame && this.acc > this.simDt) this.acc = this.simDt * 0.5;
    }
    if (now - this.windowStart > 2000) {
      this.achievedScale = this.wantedWindow > 0 ? (this.stepsWindow / this.wantedWindow) * this.timeScale : this.timeScale;
      this.stepsWindow = 0;
      this.wantedWindow = 0;
      this.windowStart = now;
    }
    if (this.maxFps > 0 && now - this.lastRender < 1000 / this.maxFps - 2) return;
    const renderDt = this.lastRender > 0 ? Math.min(0.25, (now - this.lastRender) / 1000) : realDt;
    this.lastRender = now;
    this.hooks.render(this.paused ? 1 : this.acc / this.simDt, renderDt, this.visualTime);
  };
}
