import { useEffect, useRef, useState } from 'react';
import { has } from '../../game/economy';
import { BIOMES, type BiomeId } from '../../sim/biomes';
import { DECOR_LABELS, MAX_DECOR } from '../../sim/decor';
import type { Engine } from '../../engine/engine';
import { tankLimit } from '../../game/profile';
import type { SaveMeta } from '../../persist/storage';
import { formatDuration, wallTime } from '../format';
import { Seg } from './StatsPanel';

const QUALITY_NAMES = ['低', '中', '高'] as const;

/** The tanks, snapshots, files and settings. */
export function WorldPanel({ engine }: { engine: Engine }) {
  const world = engine.world;
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [seed, setSeed] = useState('');
  const [name, setName] = useState('');
  const [biome, setBiome] = useState<BiomeId>('shallows');
  const waters = (Object.keys(BIOMES) as BiomeId[]).filter((b) => b === 'shallows' || has(engine.profile, `biome:${b}`));
  const [confirm, setConfirm] = useState<{ kind: 'reset' } | { kind: 'load' | 'delete'; id: string; label: string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tanks = engine.profile.tanks;
  const tankName = (id?: string) => tanks.find((t) => t.id === id)?.name ?? '已移走的水缸';

  const refresh = () => {
    engine.listSaves().then(setSaves, () => setSaves([]));
  };
  useEffect(refresh, [engine, engine.lastSavedAt, world]);

  const doConfirm = () => {
    if (!confirm) return;
    if (confirm.kind === 'reset') engine.resetWorld();
    else if (confirm.kind === 'load') void engine.load(confirm.id);
    else void engine.deleteTank(confirm.id);
    setConfirm(null);
  };

  return (
    <div className="panel-body">
      <div className="world-line">
        <span className="world-name">{world.name}</span>
        <span className="muted small">正在看的水缸</span>
      </div>
      <div className="kv">
        <span>种子</span>
        <b className="mono">{world.seed}</b>
        <span>诞生于</span>
        <b>{wallTime(world.createdAt)}</b>
        <span>模拟时长</span>
        <b>{formatDuration(world.time)}</b>
        <span>存储</span>
        <b>{engine.storage.kind === 'indexeddb' ? '本机 IndexedDB · 自动保存' : '仅内存（浏览器禁止存储，请导出备份）'}</b>
        {engine.lastSavedAt > 0 && (
          <>
            <span>上次保存</span>
            <b>{wallTime(engine.lastSavedAt)}</b>
          </>
        )}
      </div>

      <div className="section-title">
        我的水缸 <span className="muted small">{tanks.length} / {tankLimit(engine.profile)}</span>
      </div>
      <div className="save-list">
        {tanks.map((t) => {
          const active = t.id === engine.tankId;
          return (
            <div key={t.id} className={`save-row ${active ? 'current' : ''}`}>
              <div>
                {renaming?.id === t.id ? (
                  <input
                    className="field"
                    autoFocus
                    maxLength={16}
                    value={renaming.text}
                    onChange={(e) => setRenaming({ id: t.id, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void engine.renameTank(t.id, renaming.text);
                        setRenaming(null);
                      } else if (e.key === 'Escape') setRenaming(null);
                    }}
                    onBlur={() => setRenaming(null)}
                  />
                ) : (
                  <div>
                    {active ? world.name : t.name}
                    {active && <span className="muted small"> · 正在看</span>}
                  </div>
                )}
                <div className="muted small">
                  {active ? world.consumerCount + world.predatorCount : t.population} 只 · 第 {active ? world.counters.generationsMax : t.generation} 代 ·{' '}
                  {active ? '此刻' : `上次见到 ${wallTime(t.lastWall)}`}
                </div>
              </div>
              <div className="save-actions">
                {!active && (
                  <button className="btn small" onClick={() => void engine.switchTank(t.id)} disabled={engine.busy}>
                    去看看
                  </button>
                )}
                <button className="btn small ghost" onClick={() => setRenaming({ id: t.id, text: active ? world.name : t.name })}>
                  改名
                </button>
                {!active && (
                  <button className="btn small ghost" onClick={() => setConfirm({ kind: 'delete', id: t.id, label: t.name })}>
                    放下
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {engine.canAddTank() ? (
        <>
          <div className="field-row">
            <input className="field" placeholder="种子（留空则随机）" value={seed} onChange={(e) => setSeed(e.target.value)} />
            <input className="field" placeholder="名字（可选）" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {waters.length > 1 && (
            <div className="biome-pick">
              {waters.map((b) => (
                <button key={b} className={`chip-btn ${biome === b ? 'on' : ''}`} title={BIOMES[b].desc} onClick={() => setBiome(b)}>
                  {BIOMES[b].name}
                </button>
              ))}
            </div>
          )}
          {waters.length > 1 && <div className="muted small">{BIOMES[biome].desc}</div>}
          <div className="btn-row">
            <button
              className="btn"
              onClick={() => {
                void engine.createTank(seed, name, undefined, biome);
                setSeed('');
                setName('');
              }}
              disabled={engine.busy}
            >
              养一个新水缸
            </button>
          </div>
        </>
      ) : (
        <div className="muted small">水缸已经满了。放下一个旧水缸，才能再养一个新的。</div>
      )}

      {engine.world.decor.length > 0 && (
        <>
          <div className="section-title">
            <span>这个水缸的装饰</span>
            <span className="muted small">
              {engine.world.decor.length} / {MAX_DECOR}
            </span>
          </div>
          <div className="decor-list">
            {engine.world.decor.map((d) => (
              <div key={d.id} className="decor-row">
                <span>{DECOR_LABELS[d.kind]}</span>
                <span className="muted small">离左边 {Math.round((d.x / engine.world.width) * 100)}%</span>
                <button className="link quiet" onClick={() => void engine.removeDecoration(d.id)}>
                  收起
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-title">快照与文件</div>
      <div className="btn-row">
        <button className="btn" onClick={() => void engine.save('manual').then(refresh)}>
          给这个水缸拍个快照
        </button>
        <button className="btn" onClick={() => engine.exportWorld()}>
          导出文件
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={!engine.canAddTank()}>
          导入为新水缸
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(ev) => {
            const f = ev.target.files?.[0];
            if (f) void engine.importWorld(f).then(refresh);
            ev.target.value = '';
          }}
        />
      </div>
      <div className="save-list">
        {saves.map((s) => (
          <div key={s.id} className="save-row">
            <div>
              <div>{s.name}</div>
              <div className="muted small">
                {tankName(s.tankId)} · {wallTime(s.savedAt)} · 模拟 {formatDuration(s.simTime)} · {s.population} 只 · 第 {s.generation} 代
              </div>
            </div>
            <div className="save-actions">
              <button className="btn small" onClick={() => setConfirm({ kind: 'load', id: s.id, label: s.name })}>
                回到这里
              </button>
              <button className="btn small ghost" onClick={() => void engine.remove(s.id).then(refresh)}>
                删除
              </button>
            </div>
          </div>
        ))}
        {saves.length === 0 && <div className="muted small">还没有快照。快照可以让水缸回到某一刻。</div>}
      </div>
      <div className="btn-row">
        <button className="btn ghost" onClick={() => setConfirm({ kind: 'reset' })}>
          让这个水缸从头开始
        </button>
      </div>

      {confirm && (
        <div className="confirm">
          <div className="small">
            {confirm.kind === 'reset'
              ? '这个水缸会回到第一天，里面的生命和历史都会重新开始。确定吗？'
              : confirm.kind === 'load'
                ? `这个水缸会回到快照「${confirm.label}」的那一刻，之后发生的事会消失。确定吗？`
                : `放下水缸「${confirm.label}」？里面的生命会一起离开，无法找回（快照不受影响）。`}
          </div>
          <div className="btn-row">
            <button className="btn warn" onClick={doConfirm}>
              确定
            </button>
            <button className="btn ghost" onClick={() => setConfirm(null)}>
              再想想
            </button>
          </div>
        </div>
      )}

      <Settings engine={engine} />
    </div>
  );
}

/** Display, power and sound preferences for this device. */
function Settings({ engine }: { engine: Engine }) {
  const p = engine.prefs;
  return (
    <>
      <div className="section-title">显示与声音</div>
      <div className="seg-row">
        <span className="muted small setting-label">画质</span>
        <Seg
          value={p.quality}
          set={(v) => engine.setPref('quality', v)}
          options={[
            ['auto', `自动${p.quality === 'auto' ? `（${QUALITY_NAMES[engine.renderer.quality]}）` : ''}`],
            [0, '低'],
            [1, '中'],
            [2, '高'],
          ]}
        />
      </div>
      <label className="toggle-line">
        <input type="checkbox" checked={p.powerSave} onChange={(e) => engine.setPref('powerSave', e.target.checked)} />
        节能模式（每秒 30 帧，适合长时间当作壁纸）
      </label>
      <label className="toggle-line">
        <input type="checkbox" checked={p.sound} onChange={() => void engine.toggleSound()} />
        环境声音（水声、气泡和轻柔的铃音，全部实时合成）
      </label>
      {p.sound && (
        <div className="slider">
          <div className="slider-label">
            <span>音量</span>
            <b>{Math.round(p.volume * 100)}%</b>
          </div>
          <input type="range" min={0} max={1} step={0.01} value={p.volume} onChange={(e) => engine.setPref('volume', Number(e.target.value))} />
        </div>
      )}
      <label className="toggle-line">
        <input type="checkbox" checked={p.offlineProgress} onChange={(e) => engine.setPref('offlineProgress', e.target.checked)} />
        离开时水缸继续演化（回来时补上，最多 2 个模拟小时）
      </label>
      <label className="toggle-line">
        <input type="checkbox" checked={p.captions} onChange={(e) => engine.setPref('captions', e.target.checked)} />
        在画面上轻轻显示重要事件
      </label>
      <label className="toggle-line">
        <input type="checkbox" checked={p.hideCursor} onChange={(e) => engine.setPref('hideCursor', e.target.checked)} />
        鼠标静止 3 秒后隐藏
      </label>
      <div className="muted small hint-block">
        快捷键：H 隐藏界面 · F 全屏 · M 声音 · 空格 暂停 · 1–4 流速 · Esc 返回。
        <br />
        在网址后加上 <span className="mono">?wallpaper</span> 打开，会直接进入纯净的壁纸模式；配合 Plash（macOS）或 Lively Wallpaper（Windows）这类工具，可以把这个网页放在桌面上。
      </div>
    </>
  );
}
