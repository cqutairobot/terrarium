import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AUTOSAVE_ID, Engine, randomSeed } from './engine/engine';
import { platform } from './platform';
import { restoreWorld } from './sim/serialize';
import { World } from './sim/world';
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

  // continue the last world unless a new one is asked for
  let world: World | null = null;
  if (!params.has('seed') && !params.has('new')) {
    try {
      const rec = await storage.get(AUTOSAVE_ID);
      if (rec) world = restoreWorld(rec.snapshot);
    } catch {
      world = null;
    }
  }
  if (!world) world = new World({ seed: params.get('seed') ?? randomSeed(), aspect });

  const engine = new Engine(canvas, world, storage, { wallpaper: params.has('wallpaper') });
  engine.start();
  // debug handle for automated checks and the curious
  (window as unknown as { __eden: Engine }).__eden = engine;

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App engine={engine} wallpaper={params.has('wallpaper')} />
    </StrictMode>,
  );
}

void boot();
