import type { BiomeId } from '../sim/biomes';
import type { Morph } from '../sim/genome';
import { RARE_KEY_LABELS } from '../sim/rareTraits';
import type { World } from '../sim/world';
import type { Profile } from './profile';

/**
 * 全局图鉴: everything the player has met across all of their tanks, kept
 * in the profile so it outlives any one tank.
 */
export interface Collection {
  /** Rare traits by codex key: who showed it first, where, when (wall clock). */
  rare: Record<string, { name: string; tank: string; at: number }>;
  forms: Partial<Record<Morph, number>>;
  waters: Partial<Record<BiomeId, number>>;
  /** Species met, oldest first (kept to a few hundred). */
  species: { name: string; morph: Morph; hue: number; tank: string; at: number }[];
}

export const MAX_SPECIES_KEPT = 300;

export function newCollection(): Collection {
  return { rare: {}, forms: {}, waters: {}, species: [] };
}

/** Every rare trait (and variant) there is to find. */
export const ALL_RARE_KEYS = Object.keys(RARE_KEY_LABELS);
export const ALL_FORMS: Morph[] = ['fish', 'jelly', 'shrimp', 'snail'];
export const ALL_WATERS: BiomeId[] = ['shallows', 'abyss', 'reef'];

/** Note a rare trait seen for the first time anywhere. */
export function recordRare(p: Profile, key: string, name: string, tank: string, now: number): boolean {
  if (key.includes('+') || p.collection.rare[key]) return false;
  p.collection.rare[key] = { name, tank, at: now };
  return true;
}

/**
 * Note what lives in a tank the player keeps: its kind of water, its body
 * plans, its species. Returns whether anything new was added.
 */
export function recordTank(p: Profile, world: World, now: number): boolean {
  const col = p.collection;
  let changed = false;
  if (!col.waters[world.biome]) {
    col.waters[world.biome] = now;
    changed = true;
  }
  for (const c of world.creatures) {
    if (c.dying > 0 || c.stage === 'egg' || col.forms[c.ph.morph]) continue;
    col.forms[c.ph.morph] = now;
    changed = true;
  }
  if (col.species.length < MAX_SPECIES_KEPT) {
    const known = new Set(col.species.map((s) => s.name));
    for (const sp of world.species.values()) {
      if (sp.population <= 0 || known.has(sp.name)) continue;
      col.species.push({ name: sp.name, morph: sp.morph ?? 'fish', hue: sp.hue, tank: world.name, at: now });
      known.add(sp.name);
      changed = true;
      if (col.species.length >= MAX_SPECIES_KEPT) break;
    }
  }
  return changed;
}

/** How much of what can be found has been found (0–1), and the parts. */
export function completion(p: Profile): { rare: number; forms: number; waters: number; overall: number } {
  const col = p.collection;
  const rare = ALL_RARE_KEYS.filter((k) => col.rare[k]).length / ALL_RARE_KEYS.length;
  const forms = ALL_FORMS.filter((k) => col.forms[k]).length / ALL_FORMS.length;
  const waters = ALL_WATERS.filter((k) => col.waters[k]).length / ALL_WATERS.length;
  return { rare, forms, waters, overall: (rare * ALL_RARE_KEYS.length + forms * ALL_FORMS.length + waters * ALL_WATERS.length) / (ALL_RARE_KEYS.length + ALL_FORMS.length + ALL_WATERS.length) };
}
