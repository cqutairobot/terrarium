import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Engine } from '../engine/engine';
import { platform } from '../platform';
import { Captions } from './components/Captions';
import { ArchivePanel } from './components/ArchivePanel';
import { AwayCard, CatchUpOverlay } from './components/CatchUp';
import { ChroniclePanel } from './components/ChroniclePanel';
import { CodexPanel } from './components/CodexPanel';
import { PairHint, PairOfferCard } from './components/Pairing';
import { RequestsPanel } from './components/RequestsPanel';
import { ShopPanel } from './components/ShopPanel';
import { CreatureCard } from './components/CreatureCard';
import { Dock, type PanelId } from './components/Dock';
import { EnvPanel } from './components/EnvPanel';
import { LogPanel } from './components/LogPanel';
import { StatsPanel } from './components/StatsPanel';
import { TopBar } from './components/TopBar';
import { Tutorial } from './components/Tutorial';
import { WorldPanel } from './components/WorldPanel';
import { LevelHud, LevelIntro, LevelResultCard, LevelsPanel } from './components/Levels';
import { SpotlightCard } from './components/Spotlight';
import { itemById } from '../game/economy';
import { Icon } from './icons';
import { useEngineVersion } from './useEngine';

const EDGE = 110;

const HEIR_WORDS = { child: '它的孩子', descendant: '它的后代', family: '它的家人', none: '' } as const;

/** The followed creature has left: offer to stay with its heirs. */
function LostFollowPrompt({ engine }: { engine: Engine }) {
  const lost = engine.lostFollow!;
  const heir = lost.heirs.map((id) => engine.world.creatureMap.get(id)).find((c) => c && c.dying === 0);
  return (
    <div className="lost-follow glass">
      <span>
        {lost.name}安静地离开了。
        {heir ? '' : '它没有留下在世的亲人。'}
      </span>
      {heir && (
        <button className="btn" onClick={() => engine.followHeir()}>
          继续跟随{HEIR_WORDS[lost.kind]}「{heir.customName || heir.name}」
        </button>
      )}
      <button className="btn ghost" onClick={() => engine.dismissLost()}>
        {heir ? '不了' : '好'}
      </button>
    </div>
  );
}

const toggleFullscreen = () => platform.toggleFullscreen();

export function App({ engine, wallpaper }: { engine: Engine; wallpaper: boolean }) {
  useEngineVersion(engine);
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [nearEdge, setNearEdge] = useState(false);
  const [dockHover, setDockHover] = useState(false);
  const [boot, setBoot] = useState(!wallpaper);
  const captions = engine.prefs.captions;
  const [still, setStill] = useState(false);
  const [showTitle, setShowTitle] = useState(!wallpaper);
  const [storyFocus, setStoryFocus] = useState<number | null>(null);
  const [resultHidden, setResultHidden] = useState(false);
  const level = engine.level;
  const phase = engine.levelPhase;
  // a fresh result is always shown; "看看水缸" tucks it away until the next one
  useEffect(() => {
    if (phase !== 'result') setResultHidden(false);
  }, [phase, level]);
  // panels that belong to the garden close when a challenge begins
  useEffect(() => {
    if (level) setPanel((p) => (p === 'requests' || p === 'shop' || p === 'levels' || p === 'world' ? null : p));
  }, [level]);
  const openStory = useCallback((id: number) => {
    setStoryFocus(id);
    setPanel('archive');
  }, []);

  useEffect(() => {
    const t1 = setTimeout(() => setShowTitle(false), 5200);
    const t2 = setTimeout(() => setBoot(false), 7000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  useEffect(() => {
    let timer = 0;
    const onMove = (e: MouseEvent) => {
      setNearEdge(e.clientY > window.innerHeight - EDGE);
      setStill(false);
      clearTimeout(timer);
      timer = window.setTimeout(() => setStill(true), 3000);
    };
    const onLeave = () => setNearEdge(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('pointerdown', onMove);
    document.addEventListener('mouseleave', onLeave);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('pointerdown', onMove);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  // a still pointer fades away, so the tank can be watched undisturbed
  useEffect(() => {
    document.body.classList.toggle('pointer-still', still && engine.prefs.hideCursor && engine.aiming === null);
  }, [still, engine.prefs.hideCursor, engine.aiming]);

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
        case 'm':
        case 'M':
          void engine.toggleSound();
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
          else if (engine.placing) engine.cancelPlacing();
          else if (engine.pairing || engine.pairOffer) engine.cancelPairing();
          else if (engine.lostFollow) engine.dismissLost();
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
    world: ['世界与设置', <WorldPanel engine={engine} />],
    archive: ['生命档案馆', <ArchivePanel engine={engine} focus={storyFocus} setFocus={setStoryFocus} />],
    codex: ['生命图鉴', <CodexPanel engine={engine} />],
    requests: ['委托', <RequestsPanel engine={engine} />],
    shop: ['灵光商店', <ShopPanel engine={engine} />],
    levels: ['生态挑战', <LevelsPanel engine={engine} />],
  };
  const open = panel && panel !== 'env' ? drawer[panel] : null;

  return (
    <div className={`eden-ui ${hidden ? 'is-hidden' : ''} ${dockVisible ? 'dock-open' : ''}`}>
      <div className={`eden-title ${showTitle ? 'is-visible' : ''}`} aria-hidden={!showTitle}>
        <div className="eden-title-main">浮生</div>
        <div className="eden-title-sub">{engine.world.name}</div>
      </div>

      {!hidden && (level ? <LevelHud engine={engine} /> : <TopBar engine={engine} />)}

      {!hidden && selected && <CreatureCard engine={engine} c={selected} openStory={openStory} />}

      {!hidden && engine.lostFollow && <LostFollowPrompt engine={engine} />}

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
              <input type="checkbox" checked={captions} onChange={(e) => engine.setPref('captions', e.target.checked)} />
              在画面上轻轻显示重要事件
            </label>
          )}
        </div>
      )}

      {!hidden && panel === 'env' && <EnvPanel engine={engine} />}

      {!hidden && engine.pairing && <PairHint engine={engine} />}
      {!hidden && engine.pairOffer && <PairOfferCard engine={engine} />}
      {!hidden && engine.spotlight && !level && !engine.pairOffer && <SpotlightCard engine={engine} />}

      {!hidden && engine.aiming === 'meteor' && <div className="aim-hint glass">点击水中，选择流星坠落的地方 · 右键或 Esc 取消</div>}
      {!hidden && engine.placing && <div className="aim-hint glass">点击缸底，放下「{itemById(engine.placing)?.name}」 · 右键或 Esc 取消</div>}

      {!hidden && captions && <Captions engine={engine} />}
      {!hidden && !engine.catchUp && !engine.away && !level && <Tutorial engine={engine} panel={panel} />}
      {level && phase === 'intro' && <LevelIntro engine={engine} />}
      {level && phase === 'result' && !resultHidden && <LevelResultCard engine={engine} onHide={() => setResultHidden(true)} />}

      {engine.catchUp && <CatchUpOverlay engine={engine} />}
      {!engine.catchUp && engine.away && !hidden && <AwayCard engine={engine} />}

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
