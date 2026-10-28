import { useState } from 'react';
import type { Engine } from '../../engine/engine';
import { celsius } from '../../sim/config';

/** Environment controls. Changes are eased in by the world, never abrupt. */
export function EnvPanel({ engine }: { engine: Engine }) {
  const s = engine.world.env.settings;
  const cfg = engine.world.cfg;
  const [advanced, setAdvanced] = useState(false);
  return (
    <div className="env-panel glass">
      <Slider label="光照" value={s.light} min={0.2} max={1.5} step={0.05} show={(v) => `${Math.round(v * 100)}%`} onChange={(v) => engine.setEnv({ light: v })} />
      <Slider label="营养丰富度" value={s.nutrients} min={0.3} max={2} step={0.05} show={(v) => `${Math.round(v * 100)}%`} onChange={(v) => engine.setEnv({ nutrients: v })} />
      <Slider label="环境温度" value={s.temperature} min={0} max={1} step={0.01} show={(v) => `${celsius(v).toFixed(0)}°C`} onChange={(v) => engine.setEnv({ temperature: v })} />
      <Slider label="自然突变概率" value={s.mutation} min={0.25} max={4} step={0.05} show={(v) => `×${v.toFixed(2)}`} onChange={(v) => engine.setEnv({ mutation: v })} />
      <label className="toggle-line">
        <input type="checkbox" checked={s.naturalWeather} onChange={(e) => engine.setEnv({ naturalWeather: e.target.checked })} />
        自然天气（偶尔的阵雨、冷暖变化与好时节）
      </label>
      <button className="link" onClick={() => setAdvanced((v) => !v)}>
        {advanced ? '收起高级参数' : '高级生态参数'}
      </button>
      {advanced && (
        <>
          <Slider label="繁殖拥挤阈值" value={cfg.softCap} min={80} max={280} step={5} show={(v) => `${Math.round(v)} 只`} onChange={(v) => engine.setConfig({ softCap: Math.round(v) })} />
          <Slider label="掠食者领地容量" value={cfg.predatorSoftCap} min={1} max={14} step={1} show={(v) => `${Math.round(v)} 只`} onChange={(v) => engine.setConfig({ predatorSoftCap: Math.round(v) })} />
          <Slider label="水草生长速率" value={cfg.plantGrowth} min={0.05} max={0.5} step={0.01} show={(v) => v.toFixed(2)} onChange={(v) => engine.setConfig({ plantGrowth: v })} />
          <Slider label="分解速度" value={cfg.decomposition} min={0.005} max={0.08} step={0.005} show={(v) => v.toFixed(3)} onChange={(v) => engine.setConfig({ decomposition: v })} />
          <Slider label="基础代谢" value={cfg.basalCoeff} min={0.08} max={0.4} step={0.01} show={(v) => v.toFixed(2)} onChange={(v) => engine.setConfig({ basalCoeff: v })} />
          <div className="muted small">这些参数会直接改变生态平衡，随世界一起保存。</div>
        </>
      )}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  show,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  show: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider">
      <span className="slider-label">
        {label}
        <b>{show(value)}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
