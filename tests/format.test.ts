import { describe, expect, it } from 'vitest';
import { clockAt } from '../src/ui/format';
import { emptyWorld } from './helpers';

describe('world calendar', () => {
  it('starts on the first morning and turns the day at midnight', () => {
    const w = emptyWorld('calendar');
    const day = w.cfg.dayLength;
    expect(clockAt(w, 0)).toBe('第 1 个昼夜 · 07:26');
    // the sun's phase maps to 06:00 + phase × 24 h, so midnight comes at 0.69 of the first cycle
    const midnight = (18 / 24 - 0.06) * day;
    expect(clockAt(w, midnight - 1)).toBe('第 1 个昼夜 · 23:58');
    expect(clockAt(w, midnight + 1)).toBe('第 2 个昼夜 · 00:01');
    expect(clockAt(w, midnight + day)).toBe('第 3 个昼夜 · 00:00');
  });
});
