import { useEffect, useRef, useState } from 'react';
import type { Engine } from '../../engine/engine';
import { maxEnergyOf } from '../../sim/behavior/perception';
import { celsius } from '../../sim/config';
import { STATE_LABELS, type Creature } from '../../sim/entities/creature';
import { GENE_DEFS } from '../../sim/genome';
import { matchesSpec } from '../../game/conditions';
import { capOf } from '../../game/levels/run';
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
  const [moving, setMoving] = useState(false);
  const open = useRef(false);
  // a challenge's creatures stay in the challenge
  const otherTanks = engine.level ? [] : engine.profile.tanks.filter((t) => t.id !== engine.tankId);
  useEffect(() => {
    open.current = false;
    setEditing(false);
    setMoving(false);
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
            <div className="card-name">{c.customName || c.name}</div>
          )}
          <div className="muted small card-meta" title={`${c.customName ? `原名${c.name} · ` : ''}#${c.id} · ${species?.name ?? '未知族群'}${family ? ` · ${family.name}家` : ''}`}>
            {c.customName ? `原名${c.name} · ` : ''}#{c.id} · {species?.name ?? '未知族群'}
            {family ? ` · ${family.name}家` : ''}
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
        {otherTanks.length > 0 && (
          <button className={`icon-btn ${moving ? 'on' : ''}`} title="搬到另一个水缸" onClick={() => setMoving(!moving)} disabled={c.dying > 0 || engine.busy}>
            <Icon.move />
          </button>
        )}
        <button className={`icon-btn ${following ? 'on' : ''}`} title={following ? '停止跟随' : '镜头跟随'} onClick={() => engine.follow(following ? 0 : c.id)}>
          <Icon.follow />
        </button>
        <button className="icon-btn" title="关闭" onClick={() => engine.select(0)}>
          <Icon.close />
        </button>
      </div>

      <RequestMatch engine={engine} c={c} />

      {moving && (
        <div className="move-menu">
          <span className="muted small">它会带着自己的故事，搬到另一个水缸里继续生活：</span>
          {otherTanks.map((t) => (
            <button key={t.id} className="btn small" onClick={() => void engine.moveCreature(c.id, t.id)} disabled={engine.busy}>
              搬到「{t.name}」<span className="muted"> · {t.population} 只</span>
            </button>
          ))}
        </div>
      )}

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
  // hidden alleles are only seen through the gene lens
  const carried = engine.lens() ? RARE_DEFS.map((d, i) => ({ d, n: alleleCount(c.genome.rare, i) })).filter((x) => x.n > 0) : [];
  const level = engine.level;
  const releases = level ? capOf(level.def, 'release') : null;
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
        <span>伴侣</span>
        <b>
          <Partner engine={engine} c={c} />
        </b>
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
      {c.dying === 0 && (!level || (releases !== undefined && !egg)) && (
        <div className="btn-row card-tools">
          {!level && (
            <button className="btn small ghost" onClick={() => engine.saveCard(c.id)}>
              存为生命卡
            </button>
          )}
          {!egg && (!level || releases !== undefined) && (
            <button className="btn small ghost" onClick={() => void engine.release(c.id)} disabled={!!level && level.left('release') <= 0}>
              放生{level ? `（还剩 ${level.left('release')} 次）` : ''}
            </button>
          )}
        </div>
      )}
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

/** This creature is just what someone asked for. */
function RequestMatch({ engine, c }: { engine: Engine; c: Creature }) {
  if (engine.level) return null;
  const r = engine.profile.requests.open.find((x) => x.kind === 'deliver' && x.spec && matchesSpec(c, x.spec));
  if (!r) return null;
  return (
    <div className="request-match">
      <span>
        它正是{r.from}想要的「{r.goal}」
      </span>
      <button className="btn small" onClick={() => void engine.deliverRequest(r.id, c.id)}>
        交出去 · ✦ {r.reward}
      </button>
    </div>
  );
}

/** The partner the player matched it with, or a way to match it. */
function Partner({ engine, c }: { engine: Engine; c: Creature }) {
  const p = c.bondId ? engine.world.creatureMap.get(c.bondId) : undefined;
  if (p && p.dying === 0)
    return (
      <>
        <button className="link" onClick={() => engine.select(p.id)}>
          {p.customName || p.name}
        </button>{' '}
        <button className="link quiet" onClick={() => engine.breakBond(c.id)}>
          解除
        </button>
      </>
    );
  if (c.stage === 'egg' || c.dying > 0) return <span className="muted">—</span>;
  const level = engine.level;
  if (level && capOf(level.def, 'pair') === undefined) return <span className="muted">—</span>;
  return (
    <button className="link" onClick={() => engine.startPairing(c.id)} disabled={!!level && level.left('pair') <= 0}>
      为它配对…{level ? `（还剩 ${level.left('pair')} 次）` : ''}
    </button>
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
