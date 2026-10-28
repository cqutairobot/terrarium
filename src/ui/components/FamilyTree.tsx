import { memo } from 'react';
import type { Engine } from '../../engine/engine';
import { hsl } from '../../render/color';
import type { LineageNode } from '../../sim/history/lineage';

const W = 340;
const PAD = 14;
const MAX_NODES = 700;

interface Placed {
  n: LineageNode;
  x: number;
  y: number;
  depth: number;
  alive: boolean;
}

/**
 * The bloodline of a watched creature: the kept genealogy from the root to
 * its living descendants (dead side branches fall away over time).
 * Redrawn only when `stamp` (a coarse clock) or the selection changes.
 */
export const FamilyTree = memo(function FamilyTree({ engine, root }: { engine: Engine; root: number; stamp: number; selected: number }) {
  const world = engine.world;
  const lin = world.history.lineage;
  const { nodes, parent } = lin.tree(root);
  const rootNode = nodes.find((n) => n.id === root);
  if (!rootNode || nodes.length < 2) return <div className="muted small">血脉还很短，等它的孩子们长大吧。</div>;

  const isAlive = (id: number) => {
    const c = world.creatureMap.get(id);
    return !!c && c.dying === 0;
  };
  const kids = new Map<number, LineageNode[]>();
  for (const n of nodes) {
    if (n.id === root) continue;
    const p = parent.get(n.id) ?? 0;
    if (!p) continue;
    let list = kids.get(p);
    if (!list) kids.set(p, (list = []));
    list.push(n);
  }
  for (const list of kids.values()) list.sort((a, b) => a.born - b.born);

  // with a huge tree, keep only the branches that still lead to someone alive
  const leadsToLife = new Map<number, boolean>();
  const live = (n: LineageNode): boolean => {
    const m = leadsToLife.get(n.id);
    if (m !== undefined) return m;
    let v = isAlive(n.id);
    for (const k of kids.get(n.id) ?? []) if (live(k)) v = true;
    leadsToLife.set(n.id, v);
    return v;
  };
  const prune = nodes.length > MAX_NODES;
  if (prune) live(rootNode);

  const placed: Placed[] = [];
  const edges: [Placed, Placed][] = [];
  let leaves = 0;
  let maxDepth = 0;
  const walk = (n: LineageNode, depth: number): Placed => {
    const p: Placed = { n, x: 0, y: depth, depth, alive: isAlive(n.id) };
    placed.push(p);
    maxDepth = Math.max(maxDepth, depth);
    const children = (kids.get(n.id) ?? []).filter((k) => !prune || leadsToLife.get(k.id));
    if (children.length === 0) p.x = leaves++;
    else {
      const placedKids = children.map((k) => walk(k, depth + 1));
      p.x = placedKids.reduce((a, k) => a + k.x, 0) / placedKids.length;
      for (const k of placedKids) edges.push([p, k]);
    }
    return p;
  };
  walk(rootNode, 0);

  const row = maxDepth > 24 ? 16 : maxDepth > 12 ? 22 : 30;
  const span = W - PAD * 2;
  const step = leaves > 1 ? span / (leaves - 1) : 0;
  const r = Math.max(1.6, Math.min(5, step * 0.38 || 5));
  const X = (x: number) => (leaves > 1 ? PAD + x * step : W / 2);
  const Y = (d: number) => PAD + d * row;
  const H = Y(maxDepth) + PAD;
  const living = placed.filter((p) => p.alive && p.n.id !== root).length;
  const selected = engine.renderer.selectedId;

  return (
    <div className="tree">
      <div className="tree-scroll">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="家族树">
          {edges.map(([a, b]) => {
            const y1 = Y(a.depth);
            const y2 = Y(b.depth);
            const my = (y1 + y2) / 2;
            return (
              <path
                key={`${a.n.id}-${b.n.id}`}
                d={`M${X(a.x)} ${y1} C${X(a.x)} ${my} ${X(b.x)} ${my} ${X(b.x)} ${y2}`}
                className={b.alive || leadsToLife.get(b.n.id) ? 'edge live' : 'edge'}
              />
            );
          })}
          {placed.map((p) => {
            const color = hsl(p.n.hue, 0.6, 0.66);
            const isRoot = p.n.id === root;
            const rr = isRoot ? Math.max(5, r * 1.3) : r;
            return (
              <g
                key={p.n.id}
                className={p.alive ? 'node alive' : 'node'}
                onClick={p.alive ? () => engine.select(p.n.id) : undefined}
                transform={`translate(${X(p.x)} ${Y(p.depth)})`}
              >
                <title>{`${p.n.name} · 第 ${p.n.gen} 代 · ${p.alive ? '在世' : '已离去'}`}</title>
                {p.alive && <circle r={rr * 2.3} fill={color} opacity={0.18} />}
                <circle r={rr} fill={p.alive ? color : 'rgba(10, 30, 36, 0.9)'} stroke={color} strokeOpacity={p.alive ? 0.9 : 0.45} strokeWidth={1} />
                {(isRoot || p.n.id === selected) && <circle r={rr + 3} fill="none" stroke={isRoot ? '#ffe08a' : '#9ff3e0'} strokeWidth={1} opacity={0.8} />}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="muted small tree-legend">
        向下延续 {maxDepth} 层 · 在世 {living} 只{prune ? ' · 只显示仍有后代在世的分支' : ''} · 点亮的圆点可以点击，在水中找到它
      </div>
    </div>
  );
});
