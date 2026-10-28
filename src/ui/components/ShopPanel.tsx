import type { Engine } from '../../engine/engine';
import { canBuy, owned, priceOf, SHOP, type ShopGroup } from '../../game/economy';

const GROUPS: ShopGroup[] = ['工具', '水缸', '生命', '水草'];

/** Spend lumen on tools, tanks and new life. */
export function ShopPanel({ engine }: { engine: Engine }) {
  const p = engine.profile;
  return (
    <div className="panel-body">
      <div className="lumen-head">
        <span className="lumen-big">✦ {Math.floor(p.lumen)}</span>
        <span className="muted small">灵光来自水缸里真实发生的事：完成委托、第一次的发现、新族群的诞生、世代的里程碑，以及一个热闹的水缸本身的生机。</span>
      </div>
      {GROUPS.map((g) => (
        <div key={g}>
          <div className="section-title">{g}</div>
          <div className="shop-list">
            {SHOP.filter((i) => i.group === g).map((item) => {
              const check = canBuy(p, item);
              const n = owned(p, item.id);
              const done = item.kind === 'unlock' && n > 0;
              return (
                <div key={item.id} className={`shop-item ${done ? 'owned' : ''}`}>
                  <div>
                    <div className="shop-name">
                      {item.name}
                      {item.kind === 'repeatable' && n > 0 ? <span className="muted small"> · 已有 {n}</span> : null}
                    </div>
                    <div className="muted small">{item.desc}</div>
                  </div>
                  <button className="btn small" onClick={() => void engine.buy(item.id)} disabled={!check.ok}>
                    {done ? '已拥有' : check.why === '已到上限' ? '已到上限' : `✦ ${priceOf(p, item)}`}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
