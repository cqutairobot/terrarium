import type { ReactNode } from 'react';
import type { Engine, FoodTool } from '../../engine/engine';
import type { DisasterKind } from '../../sim/environment';
import { Icon } from '../icons';

export type PanelId = 'env' | 'stats' | 'log' | 'chronicle' | 'archive' | 'codex' | 'requests' | 'shop' | 'world';

interface Props {
  engine: Engine;
  visible: boolean;
  panel: PanelId | null;
  setPanel: (p: PanelId | null) => void;
  onHide: () => void;
  onFullscreen: () => void;
  onHover: (over: boolean) => void;
  extra?: ReactNode;
}

const TOOLS: [FoodTool, string, () => ReactNode][] = [
  ['none', '仅观察（点击不投喂）', Icon.observe],
  ['pellet', '营养颗粒', Icon.pellet],
  ['rich', '高能食物', Icon.rich],
  ['spore', '发光孢子', Icon.spore],
];

const DISASTERS: [DisasterKind, string, () => ReactNode][] = [
  ['storm', '暴雨', Icon.storm],
  ['coldwave', '寒潮', Icon.coldwave],
  ['heatwave', '热浪', Icon.heatwave],
  ['meteor', '流星（点击水中选落点）', Icon.meteor],
  ['bloom', '生态繁荣', Icon.bloom],
];

const SPEEDS: [number, string][] = [
  [0.5, '0.5×'],
  [1, '1×'],
  [2, '2×'],
  [5, '5×'],
];

const PANELS: [PanelId, string, () => ReactNode][] = [
  ['stats', '生态统计', Icon.stats],
  ['log', '事件日志', Icon.log],
  ['chronicle', '世界编年史', Icon.chronicle],
  ['archive', '生命档案馆', Icon.archive],
  ['codex', '生命图鉴', Icon.codex],
  ['requests', '委托', Icon.requests],
  ['shop', '灵光商店', Icon.shop],
];

/** The floating control dock that rises from the bottom edge. */
export function Dock({ engine, visible, panel, setPanel, onHide, onFullscreen, onHover, extra }: Props) {
  const active = new Set(engine.world.env.events.filter((e) => !e.done).map((e) => e.kind));
  const toggle = (p: PanelId) => setPanel(panel === p ? null : p);
  const loop = engine.loop;
  return (
    <div className={`dock glass ${visible ? 'is-visible' : ''}`} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      <div className="dock-group">
        {TOOLS.map(([t, label, I]) => (
          <button key={t} className={`dock-btn ${engine.tool === t ? 'on' : ''}`} data-tip={label} aria-label={label} onClick={() => engine.setTool(t)}>
            <I />
          </button>
        ))}
      </div>
      <i className="dock-sep" />
      <div className="dock-group">
        {DISASTERS.map(([k, label, I]) => (
          <button
            key={k}
            className={`dock-btn ${active.has(k) || engine.aiming === k ? 'on warm' : ''}`}
            data-tip={label}
            aria-label={label}
            onClick={() => (k === 'meteor' ? engine.aim(engine.aiming === 'meteor' ? null : 'meteor') : engine.disaster(k))}
          >
            <I />
          </button>
        ))}
      </div>
      <i className="dock-sep" />
      <div className="dock-group">
        <button className={`dock-btn ${loop.paused ? 'on' : ''}`} data-tip={loop.paused ? '继续' : '暂停'} aria-label="暂停" onClick={() => engine.togglePause()}>
          {loop.paused ? <Icon.play /> : <Icon.pause />}
        </button>
        {SPEEDS.map(([s, label]) => (
          <button key={s} className={`dock-btn text ${!loop.paused && loop.timeScale === s ? 'on' : ''}`} data-tip={`时间流速 ${label}`} onClick={() => engine.setTimeScale(s)}>
            {label}
          </button>
        ))}
      </div>
      <i className="dock-sep" />
      <div className="dock-group">
        <button className={`dock-btn ${panel === 'env' ? 'on' : ''}`} data-tip="环境" aria-label="环境" onClick={() => toggle('env')}>
          <Icon.sliders />
        </button>
        {PANELS.map(([p, label, I]) => (
          <button key={p} className={`dock-btn ${panel === p ? 'on' : ''}`} data-tip={label} aria-label={label} onClick={() => toggle(p)}>
            <I />
          </button>
        ))}
        {extra}
        <button className={`dock-btn ${panel === 'world' ? 'on' : ''}`} data-tip="世界、存档与设置" aria-label="世界与设置" onClick={() => toggle('world')}>
          <Icon.world />
        </button>
      </div>
      <i className="dock-sep" />
      <div className="dock-group">
        <button
          className={`dock-btn ${engine.prefs.sound ? 'on' : ''}`}
          data-tip={engine.prefs.sound ? '关闭声音 (M)' : '打开环境声音 (M)'}
          aria-label="声音"
          onClick={() => void engine.toggleSound()}
        >
          {engine.prefs.sound ? <Icon.sound /> : <Icon.mute />}
        </button>
        <button className="dock-btn" data-tip="全屏 (F)" aria-label="全屏" onClick={onFullscreen}>
          <Icon.fullscreen />
        </button>
        <button className="dock-btn" data-tip="隐藏全部界面 (H)" aria-label="隐藏界面" onClick={onHide}>
          <Icon.hide />
        </button>
      </div>
    </div>
  );
}
