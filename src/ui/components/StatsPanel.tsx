import { useMemo, useState } from 'react';
import type { Engine } from '../../engine/engine';
import { hsl } from '../../render/color';
import type { Sample } from '../../sim/history/series';
import { formatAge, formatDuration, pct, tempLabel, worldClock } from '../format';
import { TrendChart, type ChartLine } from './TrendChart';

type Metric = 'pop' | 'plants' | 'traits' | 'env';
type Win = 3600 | 86400 | 604800;

const WINDOWS: [Win, string][] = [
  [3600, '1 小时'],
  [86400, '24 小时'],
  [604800, '7 天'],
];

const rel = (key: 'size' | 'speed' | 'sense' | 'metab', base: number) => (s: Sample) => (base > 0 ? ((s[key] - base) / base) * 100 : 0);

export function StatsPanel({ engine }: { engine: Engine }) {
  const world = engine.world;
  const h = world.history;
  const [metric, setMetric] = useState<Metric>('pop');
  const [win, setWin] = useState<Win>(3600);
  const [axis, setAxis] = useState<'sim' | 'real'>('sim');
  const [chartOpen, setChartOpen] = useState(true);
  const k = world.counts();
  const latest = h.series.latest();
  const samples = h.series.window(win, axis, world.time, world.clock());
  const first = samples[0];

  const lines: ChartLine[] = useMemo(() => {
    switch (metric) {
      case 'pop':
        return [
          { label: '消费者', color: 'rgb(140, 230, 210)', get: (s) => s.cons },
          { label: '掠食者', color: 'rgb(255, 196, 140)', get: (s) => s.pred },
        ];
      case 'plants':
        return [
          { label: '水草', color: 'rgb(120, 210, 140)', get: (s) => s.plants },
          { label: '生物量', color: 'rgb(200, 235, 150)', get: (s) => s.plantMass },
          { label: '藻类', color: 'rgb(170, 220, 120)', get: (s) => s.algae },
        ];
      case 'traits': {
        const f = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`;
        return [
          { label: '体型', color: 'rgb(255, 200, 160)', get: rel('size', first?.size ?? 0), format: f },
          { label: '速度', color: 'rgb(140, 220, 255)', get: rel('speed', first?.speed ?? 0), format: f },
          { label: '感知', color: 'rgb(200, 170, 255)', get: rel('sense', first?.sense ?? 0), format: f },
          { label: '代谢', color: 'rgb(250, 160, 190)', get: rel('metab', first?.metab ?? 0), format: f },
        ];
      }
      case 'env':
        return [
          { label: '温度', color: 'rgb(255, 170, 140)', get: (s) => 4 + s.temp * 30, format: (v) => `${v.toFixed(1)}°` },
          { label: '光照', color: 'rgb(255, 236, 160)', get: (s) => s.light, format: (v) => v.toFixed(2) },
        ];
    }
  }, [metric, first]);

  const species = [...world.species.values()]
    .filter((s) => s.extinctAt === null && s.population > 0)
    .sort((a, b) => b.population - a.population);
  const life = h.meanLifespan(1800);
  const record = h.longevityRecord();
  const markers = h.chronicle
    .filter((e) => e.k === 'disasterStart' || e.k === 'speciation' || e.k === 'speciesExtinct' || e.k === 'rareFirst')
    .map((e) => ({ t: e.t, w: e.w, color: e.k === 'disasterStart' ? '#ffc48c' : e.k === 'rareFirst' ? '#ffe08a' : '#b8a6ff', label: e.k }));

  return (
    <div className="panel-body">
      <div className="world-line">
        <span className="world-name">{world.name}</span>
        <span className="muted">{worldClock(world)}</span>
      </div>
      <div className="muted small">
        模拟时长 {formatDuration(world.time)} · 你已陪伴 {formatDuration(world.realTime)}
      </div>
      <div className="stat-grid">
        <Stat label="总人口" value={k.consumers + k.predators} />
        <Stat label="消费者" value={k.consumers} />
        <Stat label="掠食者" value={k.predators} />
        <Stat label="卵" value={k.eggs} />
        <Stat label="最高世代" value={world.counters.generationsMax} />
        <Stat label="平均寿命" value={life > 0 ? formatAge(life) : '—'} />
        <Stat label="平均速度" value={latest ? `${latest.speed.toFixed(1)}` : '—'} />
        <Stat label="植物覆盖" value={latest ? pct(latest.coverage) : '—'} />
        <Stat label="水温" value={tempLabel(world.env.temperature)} />
        <Stat label="累计出生" value={world.counters.births} />
        <Stat label="累计离去" value={world.counters.deaths} />
        <Stat label="水草 / 藻 / 菌" value={`${k.plants}/${k.algae}/${k.fungi}`} />
      </div>

      <div className="section-title">族群</div>
      <div className="species-list">
        {species.map((s) => (
          <div key={s.id} className="species-row">
            <i className="dot" style={{ background: hsl(s.hue, 0.55, 0.65) }} />
            <span>{s.name}</span>
            <span className="muted small">{s.trophic === 'carnivore' ? '掠食' : s.trophic === 'omnivore' ? '杂食' : '草食'}</span>
            <b>{s.population}</b>
          </div>
        ))}
        {species.length === 0 && <div className="muted small">水里暂时没有游动的生命。</div>}
      </div>

      <button className="section-title as-button" onClick={() => setChartOpen((v) => !v)}>
        历史趋势 <span className="muted small">{chartOpen ? '收起' : '展开'}</span>
      </button>
      {chartOpen && (
        <>
          <div className="seg-row">
            <Seg value={metric} set={setMetric} options={[['pop', '种群'], ['plants', '植物'], ['traits', '性状'], ['env', '环境']]} />
          </div>
          <div className="seg-row">
            <Seg value={win} set={setWin} options={WINDOWS} />
            <Seg value={axis} set={setAxis} options={[['sim', '模拟时间'], ['real', '真实时间']]} />
          </div>
          <TrendChart samples={samples} lines={lines} axis={axis} scale={metric === 'traits' ? 'shared' : 'own'} markers={markers} />
        </>
      )}
      {record.age > 0 && (
        <div className="muted small record">
          有史以来最长寿：{record.name}（{formatAge(record.age)}）
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function Seg<T extends string | number>({ value, set, options }: { value: T; set: (v: T) => void; options: readonly (readonly [T, string])[] }) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button key={String(v)} className={v === value ? 'on' : ''} onClick={() => set(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}
