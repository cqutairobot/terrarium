import { useState } from 'react';
import { REVIVE_PRICE, type Engine } from '../../engine/engine';
import { cardLimit } from '../../game/economy';
import { describeLife, displayName, RECORD_LABELS, type LifeStory } from '../../sim/history/stories';
import { clockAt, formatAge, wallTime } from '../format';
import { FamilyTree } from './FamilyTree';
import { Portrait } from './Portrait';
import { Seg } from './StatsPanel';
import { StoryTimeline } from './StoryTimeline';

type Tab = 'living' | 'gone' | 'records' | 'cards';

/** 生命档案馆: the lives you followed, and the ones the world itself remembers. */
export function ArchivePanel({ engine, focus, setFocus }: { engine: Engine; focus: number | null; setFocus: (id: number | null) => void }) {
  const h = engine.world.history;
  const [tab, setTab] = useState<Tab>(() => {
    const all = [...h.stories.values()];
    if (all.some((s) => s.watched && s.diedT < 0)) return 'living';
    if (all.some((s) => s.watched)) return 'gone';
    return all.length ? 'records' : 'living';
  });
  const story = focus !== null ? h.stories.get(focus) : undefined;
  if (story) return <StoryView engine={engine} s={story} back={() => setFocus(null)} />;

  const all = [...h.stories.values()];
  const lists: Record<Exclude<Tab, 'cards'>, LifeStory[]> = {
    living: all.filter((s) => s.watched && s.diedT < 0).sort((a, b) => b.watchedT - a.watchedT),
    gone: all.filter((s) => s.watched && s.diedT >= 0).sort((a, b) => b.diedT - a.diedT),
    records: all.filter((s) => s.auto).sort((a, b) => b.watchedT - a.watchedT),
  };
  const list = tab === 'cards' ? [] : lists[tab];
  const empty: Record<Exclude<Tab, 'cards'>, string> = {
    living: '还没有关注任何生命。点选水中的小生命，按下 ☆ 关注它，它的一生就会被记在这里。',
    gone: '你关注过的生命都还在水中游动。',
    records: '世界还很年轻，还没有谁创下纪录。',
  };

  return (
    <div className="panel-body">
      <div className="seg-row">
        <Seg
          value={tab}
          set={setTab}
          options={[
            ['living', `关注中 ${lists.living.length}`],
            ['gone', `已离去 ${lists.gone.length}`],
            ['records', `纪录 ${lists.records.length}`],
            ['cards', `生命卡 ${engine.profile.geneCards.length}`],
          ]}
        />
      </div>
      {tab === 'cards' && <Cards engine={engine} />}
      <div className="story-list">
        {list.map((s) => (
          <button key={s.id} className="story-row" onClick={() => setFocus(s.id)}>
            <Portrait genome={s.genome} width={64} height={42} id={s.id} />
            <span className="story-row-text">
              <b>{displayName(s)}</b>
              <span className="muted small">
                {s.species} · {describeLife(s)}
              </span>
              <span className="small soft">
                {tab === 'records' && s.auto
                  ? RECORD_LABELS[s.auto]
                  : s.descendants > 0
                    ? `后代 ${s.descendants} 只${s.living > 0 ? `，在世 ${s.living} 只` : ''}`
                    : s.children > 0
                      ? `${s.children} 个孩子`
                      : s.diedT < 0
                        ? '正在度过它的一生'
                        : `因${s.cause}离去`}
              </span>
            </span>
          </button>
        ))}
        {tab !== 'cards' && list.length === 0 && <div className="muted small">{empty[tab]}</div>}
      </div>
    </div>
  );
}

/** Genes kept by the player: revive one as an egg in the shown tank. */
function Cards({ engine }: { engine: Engine }) {
  const p = engine.profile;
  return (
    <div className="story-list">
      <div className="muted small">
        生命卡存着一只生命的基因。复苏会在当前水缸里孕育一颗带着同样基因的卵（✦ {REVIVE_PRICE}，卵用的是缸里的养分）。共 {p.geneCards.length} / {cardLimit(p)} 张。
      </div>
      {p.geneCards.map((card) => (
        <div key={card.id} className="story-row as-div">
          <Portrait genome={card.genome} width={64} height={42} />
          <span className="story-row-text">
            <b>{card.name}</b>
            <span className="muted small">
              {card.species} · 第 {card.generation} 代 · 存于 {wallTime(card.savedAt)}
            </span>
          </span>
          <span className="card-actions">
            <button className="btn small" onClick={() => void engine.reviveCard(card.id)} disabled={p.lumen < REVIVE_PRICE || engine.busy}>
              复苏
            </button>
            <button className="link quiet" onClick={() => engine.deleteCard(card.id)}>
              丢弃
            </button>
          </span>
        </div>
      ))}
      {p.geneCards.length === 0 && <div className="muted small">还没有生命卡。在观察卡上可以把喜欢的生命存成生命卡。</div>}
    </div>
  );
}

function StoryView({ engine, s, back }: { engine: Engine; s: LifeStory; back: () => void }) {
  const world = engine.world;
  const live = world.creatureMap.get(s.id);
  const alive = !!live && live.dying === 0;
  const [pa, paName, pb, pbName] = s.parents;
  const heirs = s.watched ? world.history.lineage.livingDescendants(world, s.id) : [];
  const parentLink = (id: number, name: string) => {
    const c = id ? world.creatureMap.get(id) : undefined;
    if (!id) return <span className="muted">来自远方</span>;
    if (c && c.dying === 0)
      return (
        <button className="link" onClick={() => engine.select(id)}>
          {name}
        </button>
      );
    const kept = world.history.stories.has(id);
    return kept ? <span>{name}</span> : <span className="muted">{name}</span>;
  };

  return (
    <div className="panel-body story-view">
      <button className="link back" onClick={back}>
        ← 档案馆
      </button>
      <div className="story-hero">
        <Portrait genome={s.genome} width={150} height={92} id={s.id} />
        <div>
          <div className="story-name">{displayName(s)}</div>
          {s.custom && <div className="muted small">原名 {s.name}</div>}
          <div className="muted small">
            {s.species} · {s.family ? `${s.family}家 · ` : ''}第 {s.generation} 代
          </div>
          {s.auto && <div className="chip gold story-record">✦ {RECORD_LABELS[s.auto]}</div>}
        </div>
      </div>

      <div className="kv small">
        <span>出生</span>
        <b>
          {clockAt(world, s.bornT)} · {s.place}
        </b>
        <span>父母</span>
        <b>
          {parentLink(pa, paName)} · {parentLink(pb, pbName)}
        </b>
        {s.diedT >= 0 ? (
          <>
            <span>离去</span>
            <b>
              {clockAt(world, s.diedT)} · 因{s.cause} · 享年{formatAge(s.age)}
            </b>
          </>
        ) : (
          <>
            <span>年龄</span>
            <b>{live ? formatAge(live.age) : '—'}</b>
          </>
        )}
        <span>孩子</span>
        <b>{live ? live.children : s.children} 个</b>
        {s.watched && (
          <>
            <span>血脉</span>
            <b>
              {s.descendants > 0 ? `后代 ${s.descendants} 只 · 延续到第 ${s.maxDepth} 代后裔` : '还没有后代'}
              {s.living > 0 ? ` · 在世 ${s.living} 只` : s.lineEnd >= 0 ? ' · 已经断绝' : ''}
            </b>
          </>
        )}
        <span>真实时间</span>
        <b>
          {wallTime(s.bornW)}
          {s.diedT >= 0 ? ` — ${wallTime(s.diedW)}` : ''}
        </b>
      </div>

      <div className="story-actions">
        {alive && (
          <>
            <button className="btn" onClick={() => engine.select(s.id)}>
              在水中找到它
            </button>
            <button className="btn" onClick={() => engine.follow(s.id)}>
              跟随
            </button>
          </>
        )}
        {heirs.length > 0 && (
          <button className="btn" onClick={() => engine.follow(heirs[(engine.version * 5) % heirs.length].id)}>
            跟随一个后代
          </button>
        )}
        {alive && !s.watched && (
          <button className="btn" onClick={() => engine.watch(s.id)}>
            ☆ 关注
          </button>
        )}
        {s.watched && (
          <button
            className="btn ghost"
            onClick={() => {
              if (s.auto || window.confirm(`不再关注「${displayName(s)}」？它的故事会从档案馆中移除。`)) {
                engine.unwatch(s.id);
                if (!s.auto) back();
              }
            }}
          >
            {s.auto ? '不再追踪血脉' : '取消关注'}
          </button>
        )}
      </div>

      <div className="section-title">一生</div>
      <StoryTimeline story={s} />

      {s.watched && (
        <>
          <div className="section-title">家族树</div>
          <FamilyTree engine={engine} root={s.id} stamp={Math.floor(world.time / 4)} selected={engine.renderer.selectedId} />
        </>
      )}
    </div>
  );
}
