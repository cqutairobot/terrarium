import { useState } from 'react';
import type { Engine } from '../../engine/engine';
import { ACHIEVEMENTS } from '../../game/achievements';
import { ALL_FORMS, ALL_RARE_KEYS, ALL_WATERS, completion } from '../../game/collection';
import { hsl } from '../../render/color';
import { BIOMES } from '../../sim/biomes';
import { MORPH_LABELS } from '../../sim/genome';
import type { CodexEntry } from '../../sim/history/history';
import { RARE_DEFS, RARE_KEY_LABELS, rareTraitKeys } from '../../sim/rareTraits';
import { clockAt, formatDuration } from '../format';
import { Portrait } from './Portrait';
import { Seg } from './StatsPanel';

type Tab = 'tank' | 'all' | 'achievements';

/** 生命图鉴: this tank's wonders, everything met in every tank, and achievements. */
export function CodexPanel({ engine }: { engine: Engine }) {
  const [tab, setTab] = useState<Tab>('tank');
  return (
    <div className="panel-body">
      <div className="seg-row">
        <Seg
          value={tab}
          set={setTab}
          options={[
            ['tank', '这个水缸'],
            ['all', '全部收藏'],
            ['achievements', '成就'],
          ]}
        />
      </div>
      {tab === 'tank' && <TankCodex engine={engine} />}
      {tab === 'all' && <CollectionView engine={engine} />}
      {tab === 'achievements' && <AchievementsView engine={engine} />}
    </div>
  );
}

/** Rare traits and combinations, as they first appeared in the tank on show. */
function TankCodex({ engine }: { engine: Engine }) {
  const world = engine.world;
  const entries = [...world.history.codex.values()].sort((a, b) => a.firstT - b.firstT);
  const loci = new Set(entries.filter((e) => !e.key.includes('+')).map((e) => locusOf(e.key)));
  const unseen = RARE_DEFS.length - loci.size;
  return (
    <>
      <div className="muted small">
        稀有的外观来自真实的稀有基因：它们会遗传，也可能悄悄消失。它们不会让生命更强，只是让它们与众不同。
      </div>
      <div className="codex-grid">
        {entries.map((e) => (
          <CodexCard key={e.key} engine={engine} e={e} />
        ))}
      </div>
      {entries.length === 0 && <div className="muted small codex-empty">这个世界还没有出现过奇迹。也许某一天，某一个孩子会带着它出生。</div>}
      {unseen > 0 && <div className="muted small codex-hint">还有一些奇迹，尚未在这个世界出现过。</div>}
      <div className="muted small">（统计于{clockAt(world, world.time)}）</div>
    </>
  );
}

/** Everything met across all tanks, and how much is still to find. */
function CollectionView({ engine }: { engine: Engine }) {
  const col = engine.profile.collection;
  const done = completion(engine.profile);
  const species = [...col.species].reverse();
  return (
    <>
      <div className="collect-head">
        <span>收藏完成度</span>
        <b>{Math.round(done.overall * 100)}%</b>
      </div>
      <div className="goal-track collect-bar">
        <span style={{ width: `${Math.round(done.overall * 100)}%` }} />
      </div>
      <div className="section-title">
        <span>稀有特征</span>
        <span className="muted small">
          {ALL_RARE_KEYS.filter((k) => col.rare[k]).length} / {ALL_RARE_KEYS.length}
        </span>
      </div>
      <div className="collect-grid">
        {ALL_RARE_KEYS.map((k) => {
          const r = col.rare[k];
          return (
            <div key={k} className={`collect-item ${r ? 'found' : ''}`} title={r && r.name ? `最早是「${r.name}」，在「${r.tank}」` : ''}>
              <b>{r ? `✦ ${RARE_KEY_LABELS[k]}` : '？？？'}</b>
              <span className="muted small">{r ? (r.name ? `${r.name} · ${r.tank}` : '很久以前') : '还没见过'}</span>
            </div>
          );
        })}
      </div>
      <div className="section-title">
        <span>身体</span>
        <span className="muted small">
          {ALL_FORMS.filter((k) => col.forms[k]).length} / {ALL_FORMS.length}
        </span>
      </div>
      <div className="collect-grid">
        {ALL_FORMS.map((m) => (
          <div key={m} className={`collect-item ${col.forms[m] ? 'found' : ''}`}>
            <b>{col.forms[m] ? MORPH_LABELS[m] : '？？？'}</b>
            <span className="muted small">{col.forms[m] ? '养过' : '还没养过'}</span>
          </div>
        ))}
      </div>
      <div className="section-title">
        <span>水域</span>
        <span className="muted small">
          {ALL_WATERS.filter((k) => col.waters[k]).length} / {ALL_WATERS.length}
        </span>
      </div>
      <div className="collect-grid">
        {ALL_WATERS.map((b) => (
          <div key={b} className={`collect-item ${col.waters[b] ? 'found' : ''}`} title={BIOMES[b].desc}>
            <b>{BIOMES[b].name}</b>
            <span className="muted small">{col.waters[b] ? '养过' : '还没去过'}</span>
          </div>
        ))}
      </div>
      <div className="section-title">
        <span>见过的族群</span>
        <span className="muted small">{col.species.length}</span>
      </div>
      <div className="met-species">
        {species.slice(0, 60).map((s) => (
          <span key={s.name} className="species-chip" title={`在「${s.tank}」遇见`}>
            <i style={{ background: hsl(s.hue, 0.55, 0.6) }} />
            {s.name}
          </span>
        ))}
        {species.length > 60 && <span className="muted small">还有 {species.length - 60} 个</span>}
        {species.length === 0 && <span className="muted small">还没有记下任何族群。</span>}
      </div>
    </>
  );
}

/** 成就: what has been done, and what is still to do. */
function AchievementsView({ engine }: { engine: Engine }) {
  const got = engine.profile.achievements;
  const list = [...ACHIEVEMENTS].sort((a, b) => Number(!got[a.id]) - Number(!got[b.id]) || (got[a.id] ?? 0) - (got[b.id] ?? 0));
  const n = ACHIEVEMENTS.filter((a) => got[a.id]).length;
  return (
    <>
      <div className="collect-head">
        <span>已达成</span>
        <b>
          {n} / {ACHIEVEMENTS.length}
        </b>
      </div>
      <div className="achievement-list">
        {list.map((a) => (
          <div key={a.id} className={`achievement ${got[a.id] ? 'done' : ''}`}>
            <div>
              <b>{got[a.id] ? '✦ ' : ''}{a.name}</b>
              <div className="muted small">{a.desc}</div>
            </div>
            <span className="small">{got[a.id] ? new Date(got[a.id]).toLocaleDateString('zh-CN') : `✦ ${a.reward}`}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function locusOf(key: string): string {
  if (key.startsWith('eyes')) return 'specialEyes';
  if (key.startsWith('multiTentacle')) return 'multiTentacle';
  return key;
}

function CodexCard({ engine, e }: { engine: Engine; e: CodexEntry }) {
  const world = engine.world;
  const parts = e.key.split('+');
  const status =
    e.living > 0
      ? `此刻有 ${e.living} 只在水中游动`
      : e.alleleLost
        ? '已经失传'
        : e.vanishedAt >= 0
          ? `外表消失了 ${formatDuration(world.time - e.vanishedAt)}，基因或许还藏在某些生命里`
          : '暂时看不到它';
  return (
    <div className={`codex-card ${e.living > 0 ? 'present' : 'absent'}`}>
      <Portrait genome={e.genome} width={120} height={72} id={e.firstId} />
      <div className="codex-name">✦ {e.label}</div>
      <div className="small soft">
        首次出现：{e.firstName}，第 {e.firstGen} 代{e.species ? ` · ${e.species}` : ''}
      </div>
      <div className="muted small">{clockAt(world, e.firstT)}</div>
      <div className="small soft">
        累计 {e.total} 只 · 最多同时 {e.peak} 只
        {e.returnCount > 0 ? ` · 曾 ${e.returnCount} 次重新出现` : ''}
      </div>
      <div className="small codex-status">{status}</div>
      {e.living > 0 && (
        <button className="link" onClick={() => engine.findCarrier((c) => parts.every((k) => rareTraitKeys(c.ph.rare).includes(k)))}>
          找到一只
        </button>
      )}
    </div>
  );
}
