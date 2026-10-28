import { useState } from 'react';
import type { Engine } from '../../engine/engine';
import { categoryOf, narrate, type StoryCategory, type StoryEvent } from '../../sim/history/narrator';
import { formatDuration, wallTime } from '../format';

export const CATEGORY_COLORS: Record<StoryCategory, string> = {
  world: '#9ff3e0',
  life: '#bfe6ff',
  species: '#b8a6ff',
  family: '#ffd6a6',
  rare: '#ffe08a',
  disaster: '#ff9f8a',
  watch: '#ffb3d1',
};

export function EventRow({ e, engine, showWall = false }: { e: StoryEvent; engine: Engine; showWall?: boolean }) {
  const id = typeof e.p.id === 'number' ? e.p.id : 0;
  const alive = id > 0 && engine.world.creatureMap.has(id) && engine.world.creatureMap.get(id)!.dying === 0;
  return (
    <div className={`event tier-${e.i} ${alive ? 'clickable' : ''}`} onClick={alive ? () => engine.select(id) : undefined}>
      <i className="dot" style={{ background: CATEGORY_COLORS[categoryOf(e.k)] }} />
      <div className="event-text">
        <div>{narrate(e)}</div>
        <div className="event-time">
          模拟 {formatDuration(e.t)}
          {showWall ? ` · ${wallTime(e.w)}` : ''}
        </div>
      </div>
    </div>
  );
}

export function LogPanel({ engine }: { engine: Engine }) {
  const [quiet, setQuiet] = useState(false);
  const all = engine.world.history.log.toArray().reverse();
  const events = quiet ? all.filter((e) => e.i >= 2) : all;
  return (
    <div className="panel-body">
      <label className="toggle-line">
        <input type="checkbox" checked={quiet} onChange={(ev) => setQuiet(ev.target.checked)} />
        只看值得注意的事
      </label>
      <div className="event-list">
        {events.map((e) => (
          <EventRow key={e.id} e={e} engine={engine} />
        ))}
        {events.length === 0 && <div className="muted small">还没有发生什么。耐心一点，生命会自己找到故事。</div>}
      </div>
    </div>
  );
}
