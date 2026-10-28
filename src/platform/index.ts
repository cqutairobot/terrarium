import { openStorage } from '../persist/idb';
import type { StorageAdapter } from '../persist/storage';

/**
 * Where the tank runs. Today it is a browser page, which tools such as Plash
 * (macOS) or Lively Wallpaper (Windows) can place on the desktop. A native
 * shell (Tauri or Electron) would provide its own implementation of this
 * interface: file-based saves, a real desktop-level window beneath the icons,
 * launch at login. Nothing else in the app needs to change.
 */
export interface Platform {
  kind: 'web' | 'desktop';
  /** Durable storage for worlds. */
  openStorage(): Promise<StorageAdapter>;
  toggleFullscreen(): void;
  /** True only when the window can really sit on the desktop as a wallpaper. */
  readonly nativeWallpaper: boolean;
}

const web: Platform = {
  kind: 'web',
  openStorage,
  toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  },
  nativeWallpaper: false,
};

export const platform: Platform = web;
