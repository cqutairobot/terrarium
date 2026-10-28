import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { bootGame } from './engine/boot';
import { Engine } from './engine/engine';
import { platform } from './platform';
import { App } from './ui/App';
import './ui/styles/global.css';

async function boot(): Promise<void> {
  const stage = document.getElementById('stage')!;
  const canvas = document.createElement('canvas');
  canvas.className = 'eden-canvas';
  stage.appendChild(canvas);

  const params = new URLSearchParams(location.search);
  const storage = await platform.openStorage();
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);

  // the tank the player last looked at (or a new one), made up for the time away
  const game = await bootGame(storage, params, aspect);
  const engine = new Engine(canvas, game.world, storage, { wallpaper: params.has('wallpaper'), profile: game.profile, tankId: game.tankId });
  void engine.catchUpAfter(game.awayMs);
  // debug handle for automated checks and the curious
  (window as unknown as { __eden: Engine }).__eden = engine;

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App engine={engine} wallpaper={params.has('wallpaper')} />
    </StrictMode>,
  );
}

void boot();
