import type { Creature } from '../entities/creature';
import type { World } from '../world';

/** A compact family-tree node. */
export interface LineageNode {
  id: number;
  pa: number;
  pb: number;
  gen: number;
  born: number;
  /** Sim time of death, -1 while alive. */
  died: number;
  hue: number;
  sp: number;
  name: string;
  /** Watched ancestors whose bloodline this creature carries. */
  tags: number[];
}

export const MAX_TAGS = 8;
/** Recently departed creatures stay in the tree this long (for parents/children views). */
const RECENT = 2700;

/**
 * Bounded genealogy. Only living creatures, watched roots, recent
 * departures and the ancestor paths that lead from a watched creature to
 * its living descendants are kept ("coalescent" pruning). That is enough to
 * trace a bloodline across dozens of generations without unbounded growth.
 */
export class Lineage {
  nodes = new Map<number, LineageNode>();
  /** Nodes kept no matter what (watched roots, codex first carriers). */
  pinned = new Set<number>();

  ensure(c: Creature): LineageNode {
    let n = this.nodes.get(c.id);
    if (!n) {
      n = {
        id: c.id,
        pa: c.parentA,
        pb: c.parentB,
        gen: c.generation,
        born: c.bornT,
        died: -1,
        hue: c.ph.rare.golden ? 0.13 : c.ph.hue,
        sp: c.speciesId,
        name: c.customName || c.name,
        tags: c.tags.slice(),
      };
      this.nodes.set(c.id, n);
    }
    return n;
  }

  markDeath(id: number, t: number): void {
    const n = this.nodes.get(id);
    if (n) n.died = t;
  }

  rename(id: number, name: string): void {
    const n = this.nodes.get(id);
    if (n) n.name = name;
  }

  /** Is `root` an ancestor of node `id` (searching both parents through kept nodes)? */
  isDescendant(id: number, root: number, memo: Map<number, boolean>): boolean {
    if (id === root) return true;
    const m = memo.get(id);
    if (m !== undefined) return m;
    memo.set(id, false);
    const n = this.nodes.get(id);
    let found = false;
    if (n) {
      if (n.pa && this.isDescendant(n.pa, root, memo)) found = true;
      else if (n.pb && this.isDescendant(n.pb, root, memo)) found = true;
    }
    memo.set(id, found);
    return found;
  }

  /** Start following a bloodline: tag the root and every living descendant we can trace. */
  tagLineage(world: World, root: Creature): number {
    this.pinned.add(root.id);
    const memo = new Map<number, boolean>();
    let tagged = 0;
    const add = (c: Creature) => {
      if (!c.tags.includes(root.id)) {
        c.tags.push(root.id);
        if (c.tags.length > MAX_TAGS) c.tags.shift();
      }
      const n = this.ensure(c);
      if (!n.tags.includes(root.id)) n.tags.push(root.id);
    };
    add(root);
    for (const c of world.creatures) {
      if (c === root || c.dying > 0) continue;
      this.ensure(c);
      if (c.generation <= root.generation) continue;
      if (this.isDescendant(c.id, root.id, memo)) {
        add(c);
        tagged++;
      }
    }
    // tag the recorded path nodes too, so pruning keeps them
    for (const [id, isDesc] of memo) {
      if (!isDesc) continue;
      const n = this.nodes.get(id);
      if (n && !n.tags.includes(root.id)) n.tags.push(root.id);
    }
    return tagged;
  }

  /** The parent through which `n` carries bloodline `tag`. */
  bloodParent(n: LineageNode, tag: number): number {
    if (n.pa === tag || this.nodes.get(n.pa)?.tags.includes(tag)) return n.pa;
    if (n.pb === tag || this.nodes.get(n.pb)?.tags.includes(tag)) return n.pb;
    return 0;
  }

  prune(world: World): void {
    const keep = new Set<number>(this.pinned);
    for (const c of world.creatures) {
      keep.add(c.id);
      for (const tag of c.tags) {
        let id = c.id;
        let guard = 0;
        while (id && id !== tag && guard++ < 2000) {
          const n = this.nodes.get(id);
          if (!n) break;
          const p = this.bloodParent(n, tag);
          if (!p) break;
          keep.add(p);
          id = p;
        }
      }
    }
    const cutoff = world.time - RECENT;
    for (const [id, n] of this.nodes) {
      if (keep.has(id)) continue;
      if (n.died < 0 || n.died > cutoff) continue;
      this.nodes.delete(id);
    }
  }

  /** Living creatures carrying a watched bloodline. */
  livingDescendants(world: World, root: number): Creature[] {
    return world.creatures.filter((c) => c.id !== root && c.dying === 0 && c.tags.includes(root));
  }

  /** Path from a descendant back to the watched root (inclusive), through kept nodes. */
  pathToRoot(id: number, root: number): LineageNode[] {
    const out: LineageNode[] = [];
    let cur = id;
    let guard = 0;
    while (cur && guard++ < 2000) {
      const n = this.nodes.get(cur);
      if (!n) break;
      out.push(n);
      if (cur === root) break;
      cur = this.bloodParent(n, root);
    }
    return out;
  }

  /** Kept nodes of a bloodline, with each node's parent inside the tree. */
  tree(root: number): { nodes: LineageNode[]; parent: Map<number, number> } {
    const nodes: LineageNode[] = [];
    const parent = new Map<number, number>();
    const r = this.nodes.get(root);
    if (r) nodes.push(r);
    for (const n of this.nodes.values()) {
      if (n.id === root || !n.tags.includes(root)) continue;
      nodes.push(n);
      parent.set(n.id, this.bloodParent(n, root));
    }
    return { nodes, parent };
  }

  save(): { nodes: LineageNode[]; pinned: number[] } {
    return { nodes: [...this.nodes.values()].map((n) => ({ ...n, tags: n.tags.slice() })), pinned: [...this.pinned] };
  }

  load(d: { nodes?: LineageNode[]; pinned?: number[] } | undefined): void {
    this.nodes = new Map((d?.nodes ?? []).map((n) => [n.id, n]));
    this.pinned = new Set(d?.pinned ?? []);
  }
}
