import type { Engine } from '../../engine/engine';
import type { CodexEntry } from '../../sim/history/history';
import { RARE_DEFS, rareTraitKeys } from '../../sim/rareTraits';
import { clockAt, formatDuration } from '../format';
import { Portrait } from './Portrait';

/** 生命图鉴: rare traits and combinations, as they first appeared in this world. */
export function CodexPanel({ engine }: { engine: Engine }) {
  const world = engine.world;
  const entries = [...world.history.codex.values()].sort((a, b) => a.firstT - b.firstT);
  const loci = new Set(entries.filter((e) => !e.key.includes('+')).map((e) => locusOf(e.key)));
  const unseen = RARE_DEFS.length - loci.size;

  return (
    <div className="panel-body">
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
    </div>
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
