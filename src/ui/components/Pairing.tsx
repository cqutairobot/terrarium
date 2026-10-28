import type { Engine } from '../../engine/engine';
import { MEASURES } from '../../game/conditions';
import { hsl } from '../../render/color';
import { pct } from '../format';
import { Portrait } from './Portrait';

/** Waiting for the second creature of a pair. */
export function PairHint({ engine }: { engine: Engine }) {
  const c = engine.pairing ? engine.world.creatureMap.get(engine.pairing.firstId) : undefined;
  if (!c) return null;
  return <div className="aim-hint glass">点选另一只生物，和「{c.customName || c.name}」配对 · 点空白处或按 Esc 取消</div>;
}

function compatWords(v: number): string {
  if (v >= 0.8) return '很容易成功';
  if (v >= 0.4) return '可能要多试几次';
  if (v >= 0.1) return '很难成功';
  return '几乎不可能有孩子';
}

/** What two creatures' young would be like, before they are matched. */
export function PairOfferCard({ engine }: { engine: Engine }) {
  const o = engine.pairOffer!;
  const a = engine.world.creatureMap.get(o.a);
  const b = engine.world.creatureMap.get(o.b);
  if (!a || !b) return null;
  const f = o.forecast;
  const lens = engine.lens();
  const name = (c: typeof a) => c.customName || c.name;
  return (
    <div className="veil soft" onClick={() => engine.cancelPairing()}>
      <div className="pair-card glass" onClick={(e) => e.stopPropagation()}>
        <div className="catch-title">配对</div>
        <div className="pair-heads">
          <figure>
            <Portrait genome={a.genome} width={120} height={70} id={a.id} />
            <figcaption>{name(a)}</figcaption>
          </figure>
          <span className="pair-heart">♡</span>
          <figure>
            <Portrait genome={b.genome} width={120} height={70} id={b.id} />
            <figcaption>{name(b)}</figcaption>
          </figure>
        </div>
        <div className="small">
          相容度 <b>{pct(f.compat)}</b> · {compatWords(f.compat)}
        </div>
        <table className="pair-traits">
          <thead>
            <tr>
              <th />
              <th>{name(a)}</th>
              <th>{name(b)}</th>
              <th>孩子们（多数）</th>
            </tr>
          </thead>
          <tbody>
            {f.traits.map((t) => {
              const fmt = MEASURES[t.measure].fmt;
              return (
                <tr key={t.measure}>
                  <td>{t.label}</td>
                  <td>{fmt(t.a)}</td>
                  <td>{fmt(t.b)}</td>
                  <td className="pair-range">{t.low === t.high ? fmt(t.mid) : `${fmt(t.low)} – ${fmt(t.high)}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="pair-hues" title="孩子们可能的颜色">
          {f.hues.map((h, i) => (
            <i key={i} style={{ background: hsl(h, 0.55, 0.62) }} />
          ))}
        </div>
        {lens ? (
          f.rare.length > 0 ? (
            <div className="rare-line">
              {f.rare.map((r) => (
                <span key={r.key} className="chip gold">
                  ✦ {r.label} {pct(r.chance)}
                </span>
              ))}
            </div>
          ) : (
            <div className="muted small">基因透镜：这一对的孩子不太会出现稀有特征。</div>
          )
        ) : (
          <div className="muted small">有了「基因透镜」，就能看到孩子出现稀有特征的概率。</div>
        )}
        <div className="muted small">大约 {pct(f.surprise)} 的孩子会带着明显的新突变。</div>
        <div className="btn-row end">
          <button className="btn ghost" onClick={() => engine.cancelPairing()}>
            算了
          </button>
          <button className="btn" onClick={() => engine.confirmPair()}>
            结为伴侣
          </button>
        </div>
      </div>
    </div>
  );
}
