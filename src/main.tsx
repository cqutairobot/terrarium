import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Engine } from './engine/engine';
import { App } from './ui/App';
import './ui/styles/global.css';

const stage = document.getElementById('stage')!;
const canvas = document.createElement('canvas');
canvas.className = 'eden-canvas';
stage.appendChild(canvas);

const params = new URLSearchParams(location.search);
const seed = params.get('seed') ?? Math.random().toString(36).slice(2, 10);

const engine = new Engine(canvas, { seed, aspect: window.innerWidth / Math.max(1, window.innerHeight) });
engine.start();

// debug handle for automated checks and the curious
(window as unknown as { __eden: Engine }).__eden = engine;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App engine={engine} />
  </StrictMode>,
);
