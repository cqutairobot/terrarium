export type FoodKind = 'pellet' | 'rich' | 'spore';

export const FOOD_LABELS: Record<FoodKind, string> = {
  pellet: '营养颗粒',
  rich: '高能食物',
  spore: '发光孢子',
};

/** Food dropped into the tank by the observer. */
export interface Food {
  id: number;
  kind: FoodKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  energy: number;
  age: number;
  /** Seconds spent resting on the floor (it dissolves after a while). */
  landed: number;
}

export const FOOD_SPECS: Record<FoodKind, { energy: number; sink: number; radius: number }> = {
  pellet: { energy: 7, sink: 9, radius: 2.2 },
  rich: { energy: 26, sink: 16, radius: 3.6 },
  spore: { energy: 5, sink: -5, radius: 2.4 },
};
