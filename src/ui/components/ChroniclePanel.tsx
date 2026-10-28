import { useState } from 'react';
import type { Engine } from '../../engine/engine';
import { categoryOf, type StoryCategory } from '../../sim/history/narrator';
import { formatDuration, wallTime } from '../format';
import { CATEGORY_COLORS, EventRow } from './LogPanel';
import { Seg } from './StatsPanel';
import { TrendChart } from './TrendChart';

type Win = 3600 | 86400 | 604800 | 0;

const CATEGORIES: [StoryCategory, string][] = [
  ['world', '世界'],
  ['species', '族群'],
  ['family', '家族'],
  ['rare', '稀有'],
  ['disaster', '天气与灾害'],
  ['watch', '你关注的'],
  ['life', '生命'],
];

/** The world's history: a timeline of real events over the population curve. */
export function ChroniclePanel({ engine }: { engine: Engine }) {
  const world = engine.world;
  const h = world.history;
  const [win, setWin] = useState<Win>(86400);
  const [axis, setAxis] = useState<'sim' | 'real'>('sim');
  const [majorOnly, setMajorOnly] = useState(false);
  const [cats, setCats] = useState<Set<StoryCategory>>(() => new Set(CATEGORIES.map(([c]) => c)));
  const toggleCat = (c: StoryCategory) => {
    const next = new Set(cats);
    if (next.has(c) && next.size > 1) next.delete(c);
    else next.add(c);
    setCats(next);
  };
  const now = axis === 'sim' ? world.time : world.clock();
  const span = win === 0 ? Infinity : axis === 'sim' ? win : win * 1000;
  const inWindow = (t: number, w: number) => (axis === 'sim' ? now - t : now - w) <= span;
  const events = h.chronicle.filter((e) => inWindow(e.t, e.w) && (!majorOnly || e.i >= 3) && cats.has(categoryOf(e.k))).slice().reverse();
  const samples = h.series.window(win === 0 ? 1e12 : win, axis, world.time, world.clock());
  const markers = events
    .filter((e) => e.i >= 3)
    .map((e) => ({ t: e.t, w: e.w, color: CATEGORY_COLORS[categoryOf(e.k)], label: e.k }));
  const born = h.chronicle[0];

  return (
    <div className="panel-body">
      <div className="muted small">
        {world.name} 诞生于 {wallTime(world.createdAt)}，已经走过模拟时间 {formatDuration(world.time)}。
        {born ? '' : ''}
      </div>
      <div className="seg-row">
        <Seg
          value={win}
          set={setWin}
          options={[
            [3600, '1 小时'],
            [86400, '24 小时'],
            [604800, '7 天'],
            [0, '全部'],
          ]}
        />
        <Seg value={axis} set={setAxis} options={[['sim', '模拟'], ['real', '真实']]} />
      </div>
      <TrendChart
        samples={samples}
        axis={axis}
        lines={[
          { label: '消费者', color: 'rgb(140, 230, 210)', get: (s) => s.cons },
          { label: '掠食者', color: 'rgb(255, 196, 140)', get: (s) => s.pred },
        ]}
        markers={markers}
        height={110}
      />
      <div className="cat-row">
        {CATEGORIES.map(([c, label]) => (
          <button key={c} className={`cat ${cats.has(c) ? 'on' : ''}`} onClick={() => toggleCat(c)}>
            <i className="dot" style={{ background: CATEGORY_COLORS[c] }} />
            {label}
          </button>
        ))}
      </div>
      <label className="toggle-line">
        <input type="checkbox" checked={majorOnly} onChange={(ev) => setMajorOnly(ev.target.checked)} />
        只看重大事件
      </label>
      <div className="event-list">
        {events.map((e) => (
          <EventRow key={e.id} e={e} engine={engine} showWall />
        ))}
        {events.length === 0 && <div className="muted small">这段时间里，世界很安静。</div>}
      </div>
    </div>
  );
}
