import { useEffect } from 'react';
import type { Engine } from '../../engine/engine';
import { Portrait } from './Portrait';

/** How long a discovery card stays if the player does nothing. */
const STAY_MS = 20000;

/** A wonder seen for the first time ever: who carries it, and a way to keep its story. */
export function SpotlightCard({ engine }: { engine: Engine }) {
  const s = engine.spotlight!;
  const c = engine.world.creatureMap.get(s.id);
  const watched = engine.world.history.isWatched(s.id);
  useEffect(() => {
    const t = setTimeout(() => engine.dismissSpotlight(), STAY_MS);
    return () => clearTimeout(t);
  }, [s, engine]);
  return (
    <div className="spotlight glass" role="status">
      <Portrait genome={s.genome} width={150} height={90} id={s.id} />
      <div className="spotlight-text">
        <div className="spotlight-kicker">✦ 新的奇迹</div>
        <div className="spotlight-title">{s.trait}</div>
        <div className="small soft">「{s.name}」是你见过的第一只拥有{s.trait}的生命。它的基因会传下去，也可能悄悄消失。</div>
        <div className="btn-row">
          {c && c.dying === 0 && !watched && (
            <button
              className="btn small"
              onClick={() => {
                engine.watch(s.id);
                engine.dismissSpotlight();
              }}
            >
              关注它的一生
            </button>
          )}
          <button className="btn small ghost" onClick={() => engine.dismissSpotlight()}>
            好
          </button>
        </div>
      </div>
    </div>
  );
}
