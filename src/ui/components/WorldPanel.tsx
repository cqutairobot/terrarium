import { useEffect, useRef, useState } from 'react';
import type { Engine } from '../../engine/engine';
import type { SaveMeta } from '../../persist/storage';
import { formatDuration, wallTime } from '../format';
import { Seg } from './StatsPanel';

const QUALITY_NAMES = ['低', '中', '高'] as const;

/** Save, load, export, import, reset and create worlds. */
export function WorldPanel({ engine }: { engine: Engine }) {
  const world = engine.world;
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [seed, setSeed] = useState('');
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState<'reset' | 'new' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    engine.listSaves().then(setSaves, () => setSaves([]));
  };
  useEffect(refresh, [engine, engine.lastSavedAt, world]);

  return (
    <div className="panel-body">
      <div className="world-line">
        <span className="world-name">{world.name}</span>
      </div>
      <div className="kv">
        <span>种子</span>
        <b className="mono">{world.seed}</b>
        <span>诞生于</span>
        <b>{wallTime(world.createdAt)}</b>
        <span>模拟时长</span>
        <b>{formatDuration(world.time)}</b>
        <span>世界尺寸</span>
        <b>
          {world.width} × {world.height}
        </b>
        <span>存储</span>
        <b>{engine.storage.kind === 'indexeddb' ? '本机 IndexedDB · 每分钟自动保存' : '仅内存（浏览器禁止存储，请导出备份）'}</b>
        {engine.lastSavedAt > 0 && (
          <>
            <span>上次保存</span>
            <b>{wallTime(engine.lastSavedAt)}</b>
          </>
        )}
      </div>
      <div className="btn-row">
        <button className="btn" onClick={() => void engine.save('manual').then(refresh)}>
          保存当前世界
        </button>
        <button className="btn" onClick={() => engine.exportWorld()}>
          导出文件
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          导入文件
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

      <div className="section-title">存档</div>
      <div className="save-list">
        {saves.map((s) => (
          <div key={s.id} className="save-row">
            <div>
              <div>{s.kind === 'auto' ? `自动存档 · ${s.worldName}` : s.name}</div>
              <div className="muted small">
                {wallTime(s.savedAt)} · 模拟 {formatDuration(s.simTime)} · {s.population} 只 · 第 {s.generation} 代
              </div>
            </div>
            <div className="save-actions">
              <button className="btn small" onClick={() => void engine.load(s.id)}>
                读取
              </button>
              {s.kind === 'manual' && (
                <button className="btn small ghost" onClick={() => void engine.remove(s.id).then(refresh)}>
                  删除
                </button>
              )}
            </div>
          </div>
        ))}
        {saves.length === 0 && <div className="muted small">还没有存档。</div>}
      </div>

      <div className="section-title">新的开始</div>
      <div className="field-row">
        <input className="field" placeholder="种子（留空则随机）" value={seed} onChange={(e) => setSeed(e.target.value)} />
        <input className="field" placeholder="名字（可选）" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {confirm === null ? (
        <div className="btn-row">
          <button className="btn" onClick={() => setConfirm('new')}>
            创建新世界
          </button>
          <button className="btn ghost" onClick={() => setConfirm('reset')}>
            重置当前世界
          </button>
        </div>
      ) : (
        <div className="confirm">
          <div className="small">
            {confirm === 'new' ? '当前世界会被自动保存的新世界替换（手动存档不受影响）。确定吗？' : '当前世界将回到第一天，所有历史会重新开始。确定吗？'}
          </div>
          <div className="btn-row">
            <button
              className="btn warn"
              onClick={() => {
                if (confirm === 'new') engine.newWorld(seed, name);
                else engine.resetWorld();
                setConfirm(null);
                setSeed('');
                setName('');
              }}
            >
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
