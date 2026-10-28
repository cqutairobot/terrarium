import { Renderer } from '../render/renderer';
import { SIM_DT, World, type WorldOptions } from '../sim/world';
import { Loop } from './loop';

export type Listener = () => void;

/**
 * Glue between the pure simulation, the canvas renderer and the UI. The
 * engine owns the loop; React only reads snapshots and sends commands.
 */
export class Engine {
  world: World;
  readonly renderer: Renderer;
  readonly loop: Loop;
  private listeners = new Set<Listener>();
  private publishAcc = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    opts: WorldOptions,
  ) {
    this.world = new World(opts);
    this.renderer = new Renderer(canvas, this.world);
    this.loop = new Loop(SIM_DT, {
      step: (dt) => this.world.step(dt),
      tick: (realDt) => {
        this.world.realTime += realDt;
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
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  start(): void {
    this.loop.start();
  }

  private onResize = (): void => {
    this.renderer.resize();
  };

  private onVisibility = (): void => {
    // rAF stops by itself while hidden; restart cleanly so no backlog is simulated
    if (document.hidden) this.loop.stop();
    else this.loop.start();
  };

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  publish(): void {
    for (const fn of this.listeners) fn();
  }

  setTimeScale(s: number): void {
    this.loop.timeScale = s;
    this.publish();
  }

  togglePause(): void {
    this.loop.paused = !this.loop.paused;
    this.publish();
  }
}
