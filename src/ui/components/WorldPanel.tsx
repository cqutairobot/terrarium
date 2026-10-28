import { useEffect, useRef, useState } from 'react';
import type { Engine } from '../../engine/engine';
import type { SaveMeta } from '../../persist/storage';
import { formatDuration, wallTime } from '../format';

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
    </div>
  );
}
