import type { Engine } from '../../engine/engine';
import { BIOMES } from '../../sim/biomes';
import { DISASTER_LABELS } from '../../sim/environment';
import { formatDuration, worldClock } from '../format';
import { Icon } from '../icons';

/** Tank tabs and the shown world's state, along the top edge. */
export function TopBar({ engine }: { engine: Engine }) {
  const w = engine.world;
  const loop = engine.loop;
  const weather = w.env.events.filter((e) => !e.done);
  const tanks = engine.profile.tanks;
  return (
    <div className="top-bar">
      <div className="tank-tabs glass">
        {tanks.map((t) => {
          const active = t.id === engine.tankId;
          return (
            <button
              key={t.id}
              className={`tank-tab ${active ? 'on' : ''}`}
              title={active ? '正在看的水缸' : `切换到「${t.name}」（离开期间它也在演化）`}
              onClick={() => void engine.switchTank(t.id)}
              disabled={engine.busy || engine.catchUp !== null}
            >
              <span className="tank-name">{active ? w.name : t.name}</span>
              {t.kind === 'nursery' && <span className="tank-kind">育种</span>}
              {t.biome !== 'shallows' && t.biome in BIOMES && <span className="tank-kind">{t.biome === 'abyss' ? '深渊' : '珊瑚'}</span>}
              <span className="tank-pop">{active ? w.consumerCount + w.predatorCount : t.population}</span>
            </button>
          );
        })}
        {engine.canAddTank() && (
          <button className="tank-tab add" title="新的水缸" aria-label="新的水缸" onClick={() => void engine.createTank()} disabled={engine.busy}>
            <Icon.plus />
          </button>
        )}
      </div>
      <div className="lumen glass" title="灵光：来自水缸里真实发生的事，可以在商店里换东西">
        <span>✦ {Math.floor(engine.profile.lumen)}</span>
        {engine.lumenPops.map((p) => (
          <span key={p.id} className="lumen-pop" title={p.reason}>
            +{p.amount}
          </span>
        ))}
      </div>
      <div className="world-line-top glass">
        <span>{worldClock(w)}</span>
        <span>第 {w.counters.generationsMax} 代</span>
        {loop.paused && <span className="warm">已暂停</span>}
        {!loop.paused && loop.timeScale !== 1 && (
          <span>
            {loop.timeScale}×{loop.achievedScale < loop.timeScale * 0.9 ? `（实际 ${loop.achievedScale.toFixed(1)}×）` : ''}
          </span>
        )}
        {weather.map((e) => (
          <span key={e.id} className="warm">
            {DISASTER_LABELS[e.kind]}中
          </span>
        ))}
        <span className="muted">模拟 {formatDuration(w.time)}</span>
      </div>
    </div>
  );
}
