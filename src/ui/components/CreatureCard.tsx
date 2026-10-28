import type { Engine } from '../../engine/engine';
import { maxEnergyOf } from '../../sim/behavior/perception';
import { celsius } from '../../sim/config';
import { STATE_LABELS, type Creature } from '../../sim/entities/creature';
import { GENE_DEFS } from '../../sim/genome';
import { alleleCount, RARE_DEFS, rareKeyLabel, rareTraitKeys } from '../../sim/rareTraits';
import { healthMax } from '../../sim/systems/life';
import { hsl } from '../../render/color';
import { Icon } from '../icons';
import { formatAge, personality, STAGE_LABELS, TROPHIC_LABELS } from '../format';

/** Everything an observer can learn about one creature. */
export function CreatureCard({ engine, c }: { engine: Engine; c: Creature }) {
  const world = engine.world;
  const ph = c.ph;
  const species = world.species.get(c.speciesId);
  const family = world.families.get(c.familyId);
  const egg = c.stage === 'egg';
  const maxE = maxEnergyOf(c);
  const energy = egg ? 1 : c.energy / Math.max(1e-6, maxE);
  const health = egg ? 1 : c.health / Math.max(1e-6, healthMax(c));
  const following = engine.renderer.followId === c.id;
  const parentA = c.parentA ? world.creatureMap.get(c.parentA) : undefined;
  const parentB = c.parentB ? world.creatureMap.get(c.parentB) : undefined;
  const kids = c.kids.map((id) => world.creatureMap.get(id)).filter((k): k is Creature => !!k && k.dying === 0);
  const rare = rareTraitKeys(ph.rare);
  const carried = RARE_DEFS.map((d, i) => ({ d, n: alleleCount(c.genome.rare, i) })).filter((x) => x.n > 0);

  return (
    <div className="creature-card glass">
      <div className="card-head">
        <div className="portrait-dot" style={{ background: hsl(ph.rare.golden ? 0.12 : ph.hue, ph.sat, ph.light) }} />
        <div className="card-title">
          <div className="card-name">{c.customName || c.name}</div>
          <div className="muted small">
            #{c.id} · {species?.name ?? '未知族群'} · {family ? `${family.name}家` : ''}
          </div>
        </div>
        <button className={`icon-btn ${following ? 'on' : ''}`} title={following ? '停止跟随' : '镜头跟随'} onClick={() => engine.follow(following ? 0 : c.id)}>
          <Icon.follow />
        </button>
        <button className="icon-btn" title="关闭" onClick={() => engine.select(0)}>
          <Icon.close />
        </button>
      </div>

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

      <div className="section-title">家人</div>
      <div className="kin small">
        <div>
          父母：
          <KinName engine={engine} id={c.parentA} c={parentA} /> · <KinName engine={engine} id={c.parentB} c={parentB} />
        </div>
        <div>
          孩子：{c.children} 个{kids.length > 0 ? '，在世的有 ' : ''}
          {kids.slice(0, 8).map((k, i) => (
            <span key={k.id}>
              {i > 0 ? '、' : ''}
              <button className="link" onClick={() => engine.select(k.id)}>
                {k.customName || k.name}
              </button>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function KinName({ engine, id, c }: { engine: Engine; id: number; c: Creature | undefined }) {
  if (!id) return <span className="muted">来自远方</span>;
  if (!c || c.dying > 0) return <span className="muted">#{id}（已离去）</span>;
  return (
    <button className="link" onClick={() => engine.select(c.id)}>
      {c.customName || c.name}
    </button>
  );
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
