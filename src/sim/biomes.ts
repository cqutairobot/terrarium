import type { EnvSettings } from './config';
import type { GeneKey } from './genome';

/** The kinds of water a tank can be. */
export type BiomeId = 'shallows' | 'abyss' | 'reef';

export interface BiomeDef {
  id: BiomeId;
  name: string;
  desc: string;
  settings: Partial<EnvSettings>;
  /** Genes the first life is born with here, so it fits the water. */
  genes: Partial<Record<GeneKey, number>>;
  /** Life and plants that only this water starts with. */
  extras: { moss: number; anemones: number; forms: { arch: string; count: number }[] };
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  shallows: {
    id: 'shallows',
    name: '浅滩',
    desc: '温和明亮的浅水，水草茂盛。',
    settings: {},
    genes: {},
    extras: { moss: 0, anemones: 0, forms: [] },
  },
  abyss: {
    id: 'abyss',
    name: '寒冷深渊',
    desc: '又冷又暗的深水。这里的生命耐寒、夜里活动，苔藓铺满缸底，发光的海葵是唯一的灯。',
    settings: { temperature: 0.24, light: 0.72, nutrients: 1.25 },
    genes: { thermalPref: 0.12, nocturnality: 0.78, eyeSize: 0.75 },
    extras: {
      moss: 14,
      anemones: 5,
      forms: [
        { arch: 'jelly', count: 5 },
        { arch: 'snail', count: 4 },
      ],
    },
  },
  reef: {
    id: 'reef',
    name: '暖光珊瑚礁',
    desc: '温暖明亮的礁石水域，生命颜色鲜艳；海葵丛里藏着小虾。',
    settings: { temperature: 0.72, light: 1.25, nutrients: 0.95 },
    genes: { thermalPref: 0.88, brightness: 0.85 },
    extras: { moss: 0, anemones: 8, forms: [{ arch: 'shrimp', count: 8 }] },
  },
};

export function biomeOf(id: string | undefined): BiomeDef {
  return BIOMES[(id ?? 'shallows') as BiomeId] ?? BIOMES.shallows;
}
