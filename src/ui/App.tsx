import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Engine } from '../engine/engine';
import { DISASTER_LABELS } from '../sim/environment';
import { Captions } from './components/Captions';
import { ChroniclePanel } from './components/ChroniclePanel';
import { CreatureCard } from './components/CreatureCard';
import { Dock, type PanelId } from './components/Dock';
import { EnvPanel } from './components/EnvPanel';
import { LogPanel } from './components/LogPanel';
import { StatsPanel } from './components/StatsPanel';
import { WorldPanel } from './components/WorldPanel';
import { formatDuration, worldClock } from './format';
import { Icon } from './icons';
import { useEngineVersion } from './useEngine';

const EDGE = 110;

function usePersistentFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => {
    try {
      const s = localStorage.getItem(key);
      return s === null ? initial : s === '1';
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (nv: boolean) => {
      setV(nv);
      try {
        localStorage.setItem(key, nv ? '1' : '0');
      } catch {
        /* storage unavailable: keep it for this session only */
      }
    },
    [key],
  );
  return [v, set];
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => undefined);
}

export function App({ engine, wallpaper }: { engine: Engine; wallpaper: boolean }) {
  useEngineVersion(engine);
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [nearEdge, setNearEdge] = useState(false);
  const [dockHover, setDockHover] = useState(false);
  const [boot, setBoot] = useState(!wallpaper);
  const [captions, setCaptions] = usePersistentFlag('eden.captions', true);
  const [showTitle, setShowTitle] = useState(!wallpaper);

  useEffect(() => {
    const t1 = setTimeout(() => setShowTitle(false), 5200);
    const t2 = setTimeout(() => setBoot(false), 7000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => setNearEdge(e.clientY > window.innerHeight - EDGE);
    const onLeave = () => setNearEdge(false);
    window.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case 'h':
        case 'H':
          engine.setUiHidden(!engine.uiHidden);
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
        case ' ':
          e.preventDefault();
          engine.togglePause();
          break;
        case '1':
          engine.setTimeScale(0.5);
          break;
        case '2':
          engine.setTimeScale(1);
          break;
        case '3':
          engine.setTimeScale(2);
          break;
        case '4':
          engine.setTimeScale(5);
          break;
        case 'Escape':
          if (engine.aiming) engine.aim(null);
          else if (panel) setPanel(null);
          else if (engine.renderer.selectedId) engine.select(0);
          else if (engine.uiHidden) engine.setUiHidden(false);
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, panel]);

  const hidden = engine.uiHidden;
  const selected = engine.selected();
  const dockVisible = !hidden && (nearEdge || dockHover || panel !== null || engine.aiming !== null || boot);
  const drawer: Record<string, [string, ReactNode]> = {
    stats: ['生态统计', <StatsPanel engine={engine} />],
    log: ['事件日志', <LogPanel engine={engine} />],
    chronicle: ['世界编年史', <ChroniclePanel engine={engine} />],
    world: ['世界与存档', <WorldPanel engine={engine} />],
  };
  const open = panel && panel !== 'env' ? drawer[panel] : null;
  const activeWeather = engine.world.env.events.filter((e) => !e.done);

  return (
    <div className={`eden-ui ${hidden ? 'is-hidden' : ''}`}>
      <div className={`eden-title ${showTitle ? 'is-visible' : ''}`} aria-hidden={!showTitle}>
        <div className="eden-title-main">浮生</div>
        <div className="eden-title-sub">{engine.world.name}</div>
      </div>

      {!hidden && (
        <div className={`world-chip glass ${dockVisible ? 'is-visible' : ''}`}>
          <b>{engine.world.name}</b>
          <span>{worldClock(engine.world)}</span>
          <span>
            {engine.world.consumerCount + engine.world.predatorCount} 只 · 第 {engine.world.counters.generationsMax} 代
          </span>
          {engine.loop.paused && <span className="warm">已暂停</span>}
          {!engine.loop.paused && engine.loop.timeScale !== 1 && (
            <span>
              {engine.loop.timeScale}×{engine.loop.achievedScale < engine.loop.timeScale * 0.9 ? `（实际 ${engine.loop.achievedScale.toFixed(1)}×）` : ''}
            </span>
          )}
          {activeWeather.map((e) => (
            <span key={e.id} className="warm">
              {DISASTER_LABELS[e.kind]}中
            </span>
          ))}
          <span className="muted">模拟 {formatDuration(engine.world.time)}</span>
        </div>
      )}

      {!hidden && selected && <CreatureCard engine={engine} c={selected} />}

      {!hidden && open && (
        <div className="drawer glass">
          <div className="drawer-head">
            <span>{open[0]}</span>
            <button className="icon-btn" title="关闭" onClick={() => setPanel(null)}>
              <Icon.close />
            </button>
          </div>
          {open[1]}
          {panel === 'log' && (
            <label className="toggle-line drawer-foot">
              <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} />
              在画面上轻轻显示重要事件
            </label>
          )}
        </div>
      )}

      {!hidden && panel === 'env' && <EnvPanel engine={engine} />}

      {!hidden && engine.aiming === 'meteor' && <div className="aim-hint glass">点击水中，选择流星坠落的地方 · 右键或 Esc 取消</div>}

      {!hidden && captions && <Captions engine={engine} />}

      {(
        <div className="toasts">
          {engine.toasts.map((t) => (
            <div key={t.id} className="toast glass">
              {t.text}
            </div>
          ))}
        </div>
      )}

      <Dock
        engine={engine}
        visible={dockVisible}
        panel={panel}
        setPanel={setPanel}
        onHide={() => {
          setPanel(null);
          engine.setUiHidden(true);
          engine.toast('界面已隐藏 · 按 H 或 Esc 恢复');
        }}
        onFullscreen={toggleFullscreen}
        onHover={setDockHover}
      />
    </div>
  );
}
