import { useEffect, useRef, useState } from 'react';
import type { Engine } from '../../engine/engine';
import { maxEnergyOf } from '../../sim/behavior/perception';
import { celsius } from '../../sim/config';
import { STATE_LABELS, type Creature } from '../../sim/entities/creature';
import { GENE_DEFS } from '../../sim/genome';
import { displayName } from '../../sim/history/stories';
import { alleleCount, RARE_DEFS, rareKeyLabel, rareTraitKeys } from '../../sim/rareTraits';
import { familyDepth } from '../../sim/registry';
import { healthMax } from '../../sim/systems/life';
import { hsl } from '../../render/color';
import { Icon } from '../icons';
import { formatAge, personality, STAGE_LABELS, TROPHIC_LABELS } from '../format';
import { Seg } from './StatsPanel';
import { StoryTimeline } from './StoryTimeline';

type Tab = 'now' | 'life' | 'kin';

/** Everything an observer can learn about one creature. */
export function CreatureCard({ engine, c, openStory }: { engine: Engine; c: Creature; openStory: (id: number) => void }) {
  const world = engine.world;
  const ph = c.ph;
  const species = world.species.get(c.speciesId);
  const family = world.families.get(c.familyId);
  const following = engine.renderer.followId === c.id;
  const watched = world.history.isWatched(c.id);
  const [tab, setTab] = useState<Tab>('now');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const open = useRef(false);
  useEffect(() => {
    open.current = false;
    setEditing(false);
  }, [c.id]);

  const close = (save: boolean) => {
    if (!open.current) return;
    open.current = false;
    setEditing(false);
    if (save && draft.trim() !== (c.customName ?? '')) engine.rename(c.id, draft);
  };

  return (
    <div className="creature-card glass">
      <div className="card-head">
        <div className="portrait-dot" style={{ background: hsl(ph.rare.golden ? 0.12 : ph.hue, ph.sat, ph.light) }} />
        <div className="card-title">
          {editing ? (
            <input
              className="name-input"
              autoFocus
              maxLength={12}
              value={draft}
              placeholder={c.name}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') close(true);
                if (e.key === 'Escape') close(false);
              }}
              onBlur={() => close(true)}
            />
          ) : (
            <div className="card-name">
              {c.customName || c.name}
              {c.customName && <span className="muted small"> （{c.name}）</span>}
            </div>
          )}
          <div className="muted small">
            #{c.id} · {species?.name ?? '未知族群'} · {family ? `${family.name}家` : ''}
          </div>
        </div>
        <button
          className={`icon-btn ${watched ? 'on gold' : ''}`}
          title={watched ? '已关注（点击打开它的档案）' : '关注它，记下它的一生'}
          onClick={() => (watched ? openStory(c.id) : engine.watch(c.id))}
          disabled={c.dying > 0}
        >
          <Icon.watch />
        </button>
        <button
          className="icon-btn"
          title="给它取个名字"
          onClick={() => {
            setDraft(c.customName ?? '');
            open.current = true;
            setEditing(true);
          }}
          disabled={c.dying > 0}
        >
          <Icon.edit />
        </button>
        <button className={`icon-btn ${following ? 'on' : ''}`} title={following ? '停止跟随' : '镜头跟随'} onClick={() => engine.follow(following ? 0 : c.id)}>
          <Icon.follow />
        </button>
        <button className="icon-btn" title="关闭" onClick={() => engine.select(0)}>
          <Icon.close />
        </button>
      </div>

      <div className="card-tabs">
        <Seg
          value={tab}
          set={setTab}
          options={[
            ['now', '此刻'],
            ['life', '一生'],
            ['kin', '家族'],
          ]}
        />
      </div>

      {tab === 'now' && <NowTab engine={engine} c={c} />}
      {tab === 'life' && <LifeTab engine={engine} c={c} watched={watched} openStory={openStory} />}
      {tab === 'kin' && <KinTab engine={engine} c={c} watched={watched} openStory={openStory} familyDepthN={family ? familyDepth(family) : 0} />}
    </div>
  );
}

function NowTab({ engine, c }: { engine: Engine; c: Creature }) {
  const world = engine.world;
  const ph = c.ph;
  const egg = c.stage === 'egg';
  const maxE = maxEnergyOf(c);
  const energy = egg ? 1 : c.energy / Math.max(1e-6, maxE);
  const health = egg ? 1 : c.health / Math.max(1e-6, healthMax(c));
  const rare = rareTraitKeys(ph.rare);
  const carried = RARE_DEFS.map((d, i) => ({ d, n: alleleCount(c.genome.rare, i) })).filter((x) => x.n > 0);
  return (
    <>
      <div className="chips">
        <span className="chip">第 {c.generation} 代</span>
        <span className="chip">{STAGE_LABELS[c.stage]}</span>
        <span className="chip accent">{c.dying > 0 ? '正在离去' : STATE_LABELS[c.state]}</span>
        {!egg && <span className="chip">{TROPHIC_LABELS[ph.trophic]}</span>}
      </div>

      {!egg && (
        <>
          <Bar label="能量" value={energy} color="#9ff3e0" note={`饥饿度 ${Math.round((1 - energy) * 100)}%`} />
          <Bar label="生命" value={health} color="#ffb3c1" />
        </>
      )}
      <div className="kv small">
        <span>年龄</span>
        <b>{egg ? `${Math.ceil(c.eggTimer)} 秒后孵化` : `${formatAge(c.age)} / 寿命约 ${formatAge(ph.lifespan)}`}</b>
        <span>已存活</span>
        <b>{egg ? '尚未出生' : formatAge(world.time - c.bornT)}</b>
        <span>性格</span>
        <b>{personality(c).join(' · ')}</b>
        <span>所在</span>
        <b>{world.history.placeNow(c)}</b>
      </div>

      <div className="section-title">遗传特征</div>
      <div className="trait-grid">
        <Trait label="体型" value={ph.radius.toFixed(1)} />
        <Trait label="速度" value={ph.maxSpeed.toFixed(0)} />
        <Trait label="感知" value={ph.senseRadius.toFixed(0)} />
        <Trait label="代谢" value={`×${ph.metabolismMult.toFixed(2)}`} />
        <Trait label="攻击" value={ph.attack.toFixed(0)} />
        <Trait label="防御" value={`${Math.round(ph.defense * 100)}%`} />
        <Trait label="繁殖阈值" value={`${Math.round(ph.reproThreshold * 100)}%`} />
        <Trait label="繁殖冷却" value={`${Math.round(ph.reproCooldown)}秒`} />
        <Trait label="适温" value={`${celsius(ph.thermalPref).toFixed(0)}°C`} />
      </div>
      <div className="dna" title="基因组 DNA：每一条代表一个基因">
        {c.genome.g.map((v, i) => (
          <i
            key={i}
            title={`${GENE_DEFS[i].label} ${v.toFixed(2)}`}
            style={{ height: `${20 + v * 80}%`, background: GENE_DEFS[i].circular ? hsl(v, 0.6, 0.65) : hsl(0.47 + v * 0.12, 0.45, 0.4 + v * 0.35) }}
          />
        ))}
      </div>
      {(rare.length > 0 || carried.length > 0) && (
        <div className="rare-line">
          {rare.map((k) => (
            <span key={k} className="chip gold">
              ✦ {rareKeyLabel(k)}
            </span>
          ))}
          {carried
            .filter((x) => !rare.some((k) => k.startsWith(x.d.key) || (x.d.key === 'specialEyes' && k.startsWith('eyes'))))
            .map((x) => (
              <span key={x.d.key} className="chip faint" title="隐性携带：外表看不出来，但能传给后代">
                携带 {x.d.label}
              </span>
            ))}
        </div>
      )}
    </>
  );
}

function LifeTab({ engine, c, watched, openStory }: { engine: Engine; c: Creature; watched: boolean; openStory: (id: number) => void }) {
  const h = engine.world.history;
  const story = watched ? h.stories.get(c.id) : h.previewStory(c);
  if (!story) return null;
  return (
    <div className="life-tab">
      {!watched && (
        <div className="watch-cta">
          <span className="small soft">只看得到它留下的痕迹。关注它，之后的每一件事都会被记下来，连同它的血脉。</span>
          <button className="btn" onClick={() => engine.watch(c.id)} disabled={c.dying > 0}>
            ☆ 关注它
          </button>
        </div>
      )}
      <StoryTimeline story={story} max={40} />
      {watched && (
        <button className="link" onClick={() => openStory(c.id)}>
          在生命档案馆中打开 →
        </button>
      )}
    </div>
  );
}

function KinTab({
  engine,
  c,
  watched,
  openStory,
  familyDepthN,
}: {
  engine: Engine;
  c: Creature;
  watched: boolean;
  openStory: (id: number) => void;
  familyDepthN: number;
}) {
  const world = engine.world;
  const h = world.history;
  const lin = h.lineage;
  const family = world.families.get(c.familyId);
  const kids = c.kids.map((id) => world.creatureMap.get(id)).filter((k): k is Creature => !!k && k.dying === 0);
  const grand = [c.parentA, c.parentB].flatMap((p) => {
    const live = world.creatureMap.get(p);
    const n = lin.nodes.get(p);
    return live ? [live.parentA, live.parentB] : n ? [n.pa, n.pb] : [];
  });
  const roots = c.tags
    .filter((t) => t !== c.id)
    .map((t) => h.stories.get(t))
    .filter((s): s is NonNullable<typeof s> => !!s);
  const story = h.stories.get(c.id);

  return (
    <div className="kin small">
      {family && (
        <div>
          {family.name}家 · 创始者 {family.founderName} · 延续 {familyDepthN} 代 · 在世 {family.living} 只
        </div>
      )}
      <div>
        父母：
        <KinName engine={engine} id={c.parentA} /> · <KinName engine={engine} id={c.parentB} />
      </div>
      {grand.some((g) => g > 0) && (
        <div>
          祖父母：
          {grand.map((g, i) => (
            <span key={i}>
              {i > 0 ? ' · ' : ''}
              <KinName engine={engine} id={g} />
            </span>
          ))}
        </div>
      )}
      <div>
        孩子：{c.children} 个{kids.length > 0 ? '，在世的有 ' : ''}
        {kids.slice(0, 10).map((k, i) => (
          <span key={k.id}>
            {i > 0 ? '、' : ''}
            <button className="link" onClick={() => engine.select(k.id)}>
              {k.customName || k.name}
            </button>
          </span>
        ))}
        {kids.length > 10 ? ` 等 ${kids.length} 只` : ''}
      </div>
      {roots.length > 0 && (
        <div className="bloodline">
          {roots.map((s) => (
            <div key={s.id}>
              是
              <button className="link" onClick={() => openStory(s.id)}>
                「{displayName(s)}」
              </button>
              的第 {Math.max(1, c.generation - s.generation)} 代后裔
              {s.diedT >= 0 ? '（它已经离去）' : ''}
            </div>
          ))}
        </div>
      )}
      {watched && story ? (
        <div>
          后代 {story.descendants} 只 · 在世 {story.living} 只{' '}
          <button className="link" onClick={() => openStory(c.id)}>
            查看家族树 →
          </button>
        </div>
      ) : (
        <div className="muted">关注它之后，它的每一个后代都会被记进它的血脉，几十代之后也能找回来。</div>
      )}
    </div>
  );
}

function KinName({ engine, id }: { engine: Engine; id: number }) {
  const world = engine.world;
  if (!id) return <span className="muted">来自远方</span>;
  const c = world.creatureMap.get(id);
  if (c && c.dying === 0)
    return (
      <button className="link" onClick={() => engine.select(c.id)}>
        {c.customName || c.name}
      </button>
    );
  const n = world.history.lineage.nodes.get(id);
  return <span className="muted">{n ? n.name : `#${id}`}（已离去）</span>;
}

function Bar({ label, value, color, note }: { label: string; value: number; color: string; note?: string }) {
  return (
    <div className="bar">
      <span className="bar-label">{label}</span>
      <span className="bar-track">
        <span className="bar-fill" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
      </span>
      <span className="bar-note small muted">{note ?? `${Math.round(value * 100)}%`}</span>
    </div>
  );
}

function Trait({ label, value }: { label: string; value: string }) {
  return (
    <div className="trait">
      <span className="muted">{label}</span>
      <b>{value}</b>
    </div>
  );
}
