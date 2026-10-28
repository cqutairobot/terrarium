import type { Engine } from '../../engine/engine';
import { narrate } from '../../sim/history/narrator';
import { formatDuration } from '../format';

/** The world makes up for the time nobody watched it. */
export function CatchUpOverlay({ engine }: { engine: Engine }) {
  const c = engine.catchUp!;
  const frac = c.target > 0 ? Math.min(1, c.done / c.target) : 1;
  return (
    <div className="veil">
      <div className="catch-up glass" role="status">
        <div className="catch-title">你不在的时候，「{c.tankName}」也没有停下</div>
        <div className="muted small">
          你离开了 {formatDuration(c.awayMs / 1000)}，正在补上其中的 {formatDuration(c.target)}……
        </div>
        <div className="catch-bar">
          <span style={{ width: `${frac * 100}%` }} />
        </div>
        <div className="catch-foot">
          <span className="muted small">{Math.round(frac * 100)}%</span>
          <button className="btn ghost" onClick={() => engine.skipCatchUp()} disabled={c.stopping}>
            {c.stopping ? '正在停下…' : '跳过，从这里继续'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** What happened while the player was away. */
export function AwayCard({ engine }: { engine: Engine }) {
  const a = engine.away!;
  const stats: [string, string][] = [
    ['出生', String(a.births)],
    ['离去', String(a.deaths)],
    ['世代', a.genTo > a.genFrom ? `${a.genFrom} → ${a.genTo}` : String(a.genTo)],
    ['生命', `${a.popFrom} → ${a.popTo}`],
    ['族群', a.speciesTo !== a.speciesFrom ? `${a.speciesFrom} → ${a.speciesTo}` : String(a.speciesTo)],
  ];
  return (
    <div className="veil soft" onClick={() => engine.dismissAway()}>
      <div className="away-card glass" onClick={(e) => e.stopPropagation()}>
        <div className="catch-title">你不在的时候</div>
        <div className="muted small">
          「{a.tankName}」度过了 {formatDuration(a.simulated)}
          {a.partial ? `（你离开了 ${formatDuration(a.awayMs / 1000)}，只补上了这一段）` : ''}。
        </div>
        <div className="away-stats">
          {stats.map(([k, v]) => (
            <div key={k}>
              <b>{v}</b>
              <span>{k}</span>
            </div>
          ))}
        </div>
        {a.events.length > 0 ? (
          <ul className="away-events">
            {a.events.map((e) => (
              <li key={e.id} className={`tier-${e.i}`}>
                {narrate(e)}
              </li>
            ))}
          </ul>
        ) : (
          <div className="muted small">水里一切如常，生命安静地延续着。</div>
        )}
        <button className="btn" onClick={() => engine.dismissAway()}>
          回到水缸
        </button>
      </div>
    </div>
  );
}
