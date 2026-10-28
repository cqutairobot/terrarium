import { useEffect, useRef } from 'react';
import type { Sample } from '../../sim/history/series';
import { formatDuration, wallTime } from '../format';

export interface ChartLine {
  label: string;
  color: string;
  get: (s: Sample) => number;
  format?: (v: number) => string;
}

interface Props {
  samples: Sample[];
  lines: ChartLine[];
  axis: 'sim' | 'real';
  /** 'own': each line scaled to itself; 'shared': one scale for all. */
  scale?: 'own' | 'shared';
  height?: number;
  markers?: { t: number; w: number; color: string; label: string }[];
}

/** A small, quiet line chart drawn on canvas. */
export function TrendChart({ samples, lines, axis, scale = 'own', height = 130, markers = [] }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const padL = 6;
    const padR = 6;
    const padT = 8;
    const padB = 18;
    const iw = w - padL - padR;
    const ih = h - padT - padB;
    g.strokeStyle = 'rgba(190, 255, 236, 0.08)';
    g.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = padT + (ih * i) / 3;
      g.beginPath();
      g.moveTo(padL, y);
      g.lineTo(w - padR, y);
      g.stroke();
    }
    if (samples.length < 2) {
      g.fillStyle = 'rgba(223, 246, 240, 0.45)';
      g.font = '12px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('还在积累数据……', w / 2, padT + ih / 2 + 4);
      return;
    }
    const xOf = (s: Sample) => (axis === 'sim' ? s.t : s.w);
    const x0 = xOf(samples[0]);
    const x1 = xOf(samples[samples.length - 1]);
    const sx = (v: number) => padL + ((v - x0) / Math.max(1e-9, x1 - x0)) * iw;
    let sharedMin = Infinity;
    let sharedMax = -Infinity;
    if (scale === 'shared') {
      for (const l of lines) {
        for (const s of samples) {
          const v = l.get(s);
          sharedMin = Math.min(sharedMin, v);
          sharedMax = Math.max(sharedMax, v);
        }
      }
    }
    // event markers
    for (const m of markers) {
      const mx = sx(axis === 'sim' ? m.t : m.w);
      if (mx < padL || mx > w - padR) continue;
      g.strokeStyle = m.color;
      g.globalAlpha = 0.5;
      g.setLineDash([2, 3]);
      g.beginPath();
      g.moveTo(mx, padT);
      g.lineTo(mx, padT + ih);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
    for (const l of lines) {
      let lo = sharedMin;
      let hi = sharedMax;
      if (scale === 'own') {
        lo = Infinity;
        hi = -Infinity;
        for (const s of samples) {
          const v = l.get(s);
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
        lo = Math.min(lo, 0);
      }
      const range = hi - lo || 1;
      const sy = (v: number) => padT + ih - ((v - lo) / range) * ih;
      g.strokeStyle = l.color;
      g.lineWidth = 1.6;
      g.lineJoin = 'round';
      g.beginPath();
      samples.forEach((s, i) => {
        const x = sx(xOf(s));
        const y = sy(l.get(s));
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.stroke();
      // soft fill under the first line
      if (l === lines[0]) {
        g.lineTo(sx(x1), padT + ih);
        g.lineTo(sx(x0), padT + ih);
        g.closePath();
        const grad = g.createLinearGradient(0, padT, 0, padT + ih);
        grad.addColorStop(0, l.color.replace(/rgb\((.*)\)/, 'rgba($1, 0.18)'));
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fill();
      }
    }
    g.fillStyle = 'rgba(223, 246, 240, 0.42)';
    g.font = '10px system-ui, sans-serif';
    g.textAlign = 'left';
    const label = (s: Sample) => (axis === 'sim' ? formatDuration(s.t) : wallTime(s.w));
    g.fillText(label(samples[0]), padL, h - 4);
    g.textAlign = 'right';
    g.fillText(label(samples[samples.length - 1]), w - padR, h - 4);
  }, [samples, lines, axis, scale, height, markers]);

  const last = samples[samples.length - 1];
  return (
    <div className="chart">
      <canvas ref={ref} style={{ width: '100%', height }} />
      <div className="chart-legend">
        {lines.map((l) => (
          <span key={l.label} className="chart-key">
            <i style={{ background: l.color }} />
            {l.label}
            {last ? <b>{l.format ? l.format(l.get(last)) : Math.round(l.get(last))}</b> : null}
          </span>
        ))}
      </div>
    </div>
  );
}
