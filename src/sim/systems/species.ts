import { wrap01 } from '../core/math';
import type { Creature } from '../entities/creature';
import { G, geneticDistance, morphDiet, N_GENES, trophicOf } from '../genome';
import { speciesName } from '../names';
import type { World } from '../world';

/** Circular mean for hue genes. */
function meanHue(values: number[]): number {
  let sx = 0;
  let sy = 0;
  for (const v of values) {
    sx += Math.cos(v * Math.PI * 2);
    sy += Math.sin(v * Math.PI * 2);
  }
  return wrap01(Math.atan2(sy, sx) / (Math.PI * 2));
}

export function meanGenes(members: readonly Creature[]): number[] {
  const out = new Array<number>(N_GENES).fill(0);
  for (const c of members) for (let i = 0; i < N_GENES; i++) out[i] += c.genome.g[i];
  for (let i = 0; i < N_GENES; i++) out[i] /= Math.max(1, members.length);
  out[G.hue] = meanHue(members.map((c) => c.genome.g[G.hue]));
  out[G.accentHue] = meanHue(members.map((c) => c.genome.g[G.accentHue]));
  return out;
}

/**
 * Species bookkeeping: refresh centroids, and split a species in two when
 * its members have drifted into two clearly separated genetic clusters
 * (2-medoids clustering). Reproductive isolation itself is emergent —
 * mating success already falls off with genetic distance.
 */
export function updateSpecies(world: World): void {
  const groups = new Map<number, Creature[]>();
  for (const c of world.creatures) {
    if (c.dying > 0 || c.stage === 'egg') continue;
    let g = groups.get(c.speciesId);
    if (!g) groups.set(c.speciesId, (g = []));
    g.push(c);
  }
  for (const [sid, members] of groups) {
    const rec = world.species.get(sid);
    if (!rec) continue;
    rec.centroid = meanGenes(members);
    rec.hue = rec.centroid[G.hue];
    rec.trophic = trophicOf(morphDiet(rec.morph, rec.centroid[G.diet]));
    if (members.length >= 16) trySplit(world, sid, members);
  }
}

function trySplit(world: World, sid: number, members: Creature[]): void {
  const rng = world.rng;
  const farthest = (from: Creature): Creature => {
    let best = from;
    let bd = -1;
    for (const c of members) {
      const d = geneticDistance(from.genome, c.genome);
      if (d > bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  };
  let ma = farthest(members[rng.int(members.length)]);
  let mb = farthest(ma);
  let ca: Creature[] = [];
  let cb: Creature[] = [];
  for (let iter = 0; iter < 4; iter++) {
    ca = [];
    cb = [];
    for (const c of members) {
      if (geneticDistance(c.genome, ma.genome) <= geneticDistance(c.genome, mb.genome)) ca.push(c);
      else cb.push(c);
    }
    if (ca.length === 0 || cb.length === 0) return;
    ma = medoid(ca, rng.int(1 << 30));
    mb = medoid(cb, rng.int(1 << 30));
  }
  const d = geneticDistance(ma.genome, mb.genome);
  const small = ca.length < cb.length ? ca : cb;
  if (d <= world.cfg.speciationDistance || small.length < 6) return;

  const parent = world.species.get(sid)!;
  const id = world.newId();
  const centroid = meanGenes(small);
  const taken = new Set([...world.species.values()].map((s) => s.name));
  const v = (k: keyof typeof G) => centroid[G[k]];
  world.species.set(id, {
    id,
    name: speciesName(
      {
        hue: v('hue'),
        finSize: v('finSize'),
        tentacles: v('tentacles'),
        tailLength: v('tailLength'),
        eyeSize: v('eyeSize'),
        armor: v('armor'),
        perception: v('perception'),
        size: v('size'),
        diet: v('diet'),
        morph: parent.morph,
      },
      taken,
    ),
    hue: v('hue'),
    trophic: trophicOf(morphDiet(parent.morph, v('diet'))),
    foundedAt: world.time,
    parentSpecies: parent.id,
    centroid,
    population: small.length,
    peak: small.length,
    totalBorn: 0,
    extinctAt: null,
    milestones: [],
    ...(parent.morph ? { morph: parent.morph } : {}),
  });
  parent.population -= small.length;
  for (const c of small) c.speciesId = id;
  // eggs follow their mother line
  const moved = new Set(small.map((c) => c.id));
  for (const c of world.creatures) if (c.stage === 'egg' && moved.has(c.parentA)) c.speciesId = id;
  world.events.push({ t: 'speciation', species: id, parent: parent.id, members: small.length });
}

/** Member that minimizes total distance to the others (sampled for big clusters). */
function medoid(cluster: Creature[], salt: number): Creature {
  const n = cluster.length;
  const step = n > 48 ? Math.ceil(n / 48) : 1;
  let best = cluster[0];
  let bs = Infinity;
  for (let i = salt % step; i < n; i += step) {
    let s = 0;
    for (let j = 0; j < n; j += step) s += geneticDistance(cluster[i].genome, cluster[j].genome);
    if (s < bs) {
      bs = s;
      best = cluster[i];
    }
  }
  return best;
}
