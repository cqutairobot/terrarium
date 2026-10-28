import type { Engine } from './engine';

const LONG_PRESS_MS = 380;
const MOVE_TOLERANCE = 8;

/**
 * Pointer handling on the tank: a click selects a creature or scatters a
 * pinch of food; a long press keeps pouring; while a meteor is being aimed
 * the click chooses where it falls.
 */
export class Input {
  private downAt: { x: number; y: number; t: number } | null = null;
  private current = { x: 0, y: 0 };
  private moved = false;
  private pouring = false;
  private longTimer = 0;
  private pourTimer = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly engine: Engine,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);
    canvas.addEventListener('contextmenu', this.onContext);
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private toWorld(p: { x: number; y: number }): { x: number; y: number } {
    return this.engine.renderer.cam.screenToWorld(p.x, p.y);
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const p = this.local(e);
    this.downAt = { ...p, t: performance.now() };
    this.current = p;
    this.moved = false;
    this.canvas.setPointerCapture(e.pointerId);
    clearTimeout(this.longTimer);
    if (!this.engine.aiming && this.engine.tool !== 'none' && this.engine.canPour()) {
      this.longTimer = window.setTimeout(() => this.startPour(), LONG_PRESS_MS);
    }
  };

  private onMove = (e: PointerEvent): void => {
    const p = this.local(e);
    this.current = p;
    if (this.downAt && Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > MOVE_TOLERANCE) {
      this.moved = true;
      if (!this.pouring) clearTimeout(this.longTimer);
    }
    if (!this.downAt) {
      // hover feedback
      const aiming = this.engine.aiming !== null;
      const over = !aiming && this.engine.renderer.pick(p.x, p.y);
      this.canvas.style.cursor = aiming ? 'crosshair' : over ? 'pointer' : '';
    }
  };

  private onUp = (e: PointerEvent): void => {
    clearTimeout(this.longTimer);
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (this.pouring) {
      this.stopPour();
    } else if (this.downAt && !this.moved) {
      this.click(this.local(e));
    }
    this.downAt = null;
  };

  private onCancel = (): void => {
    clearTimeout(this.longTimer);
    this.stopPour();
    this.downAt = null;
  };

  private onContext = (e: Event): void => {
    e.preventDefault();
    if (this.engine.aiming) this.engine.aim(null);
  };

  private click(p: { x: number; y: number }): void {
    const eng = this.engine;
    const w = this.toWorld(p);
    if (eng.aiming) {
      eng.disaster(eng.aiming, w.x, w.y);
      return;
    }
    const hit = eng.renderer.pick(p.x, p.y);
    if (eng.pairing) {
      if (hit) eng.choosePartner(hit.id);
      else eng.cancelPairing();
      return;
    }
    if (hit) {
      eng.select(eng.renderer.selectedId === hit.id ? 0 : hit.id);
      return;
    }
    if (eng.tool !== 'none') {
      if (w.y > 4 && w.y < eng.world.groundAt(w.x) - 2 && w.x > 0 && w.x < eng.world.width) eng.feedAt(w.x, w.y, eng.tool === 'rich' ? 2 : 5);
    } else if (eng.renderer.selectedId) {
      eng.select(0);
    }
  }

  private startPour(): void {
    if (!this.downAt || this.moved) return;
    this.pouring = true;
    const pour = () => {
      const w = this.toWorld(this.current);
      if (w.y > 4 && w.y < this.engine.world.groundAt(w.x) - 2) this.engine.feedAt(w.x, w.y, this.engine.tool === 'rich' ? 1 : 2);
    };
    pour();
    this.pourTimer = window.setInterval(pour, 160);
  }

  private stopPour(): void {
    this.pouring = false;
    clearInterval(this.pourTimer);
  }

  dispose(): void {
    this.stopPour();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onCancel);
    this.canvas.removeEventListener('contextmenu', this.onContext);
  }
}
