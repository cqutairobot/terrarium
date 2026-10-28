import type { Quality } from '../render/renderer';

/** Per-device viewing preferences (not part of a world's save). */
export interface Prefs {
  quality: 'auto' | Quality;
  /** Render at most 30 frames per second. */
  powerSave: boolean;
  sound: boolean;
  volume: number;
  /** Quietly show important events on screen. */
  captions: boolean;
  /** Hide the pointer after a few still seconds. */
  hideCursor: boolean;
}

const KEY = 'eden.prefs';

export function loadPrefs(wallpaper: boolean): Prefs {
  const base: Prefs = { quality: 'auto', powerSave: wallpaper, sound: false, volume: 0.6, captions: true, hideCursor: true };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      quality: p.quality === 0 || p.quality === 1 || p.quality === 2 ? p.quality : 'auto',
      powerSave: typeof p.powerSave === 'boolean' ? p.powerSave : base.powerSave,
      sound: p.sound === true,
      volume: typeof p.volume === 'number' ? Math.max(0, Math.min(1, p.volume)) : base.volume,
      captions: p.captions !== false,
      hideCursor: p.hideCursor !== false,
    };
  } catch {
    return base;
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: preferences last for this session only */
  }
}
