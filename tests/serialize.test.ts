import { describe, expect, it } from 'vitest';
import { restoreWorld, snapshotWorld, type WorldSnapshot } from '../src/sim/serialize';
import { World } from '../src/sim/world';
import { stepFor } from './helpers';

function fingerprint(w: World): string {
  const s = snapshotWorld(w);
  s.savedAt = 0;
  return JSON.stringify(s);
}

describe('save and restore', () => {
  it('a restored world continues exactly like the original', () => {
    const a = new World({ seed: 'determinism', aspect: 16 / 9 });
    stepFor(a, 90);
    const json = JSON.stringify(snapshotWorld(a));
    const b = restoreWorld(JSON.parse(json) as WorldSnapshot);
    expect(fingerprint(b)).toBe(fingerprint(a));
    stepFor(a, 60);
    stepFor(b, 60);
    expect(b.creatures.length).toBe(a.creatures.length);
    expect(fingerprint(b)).toBe(fingerprint(a));
  });

  it('round-trips through JSON without losing the genome or registries', () => {
    const a = new World({ seed: 'roundtrip', aspect: 21 / 9 });
    stepFor(a, 30);
    const b = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(a))));
    expect(b.width).toBe(a.width);
    expect(b.name).toBe(a.name);
    expect([...b.species.keys()]).toEqual([...a.species.keys()]);
    expect([...b.families.keys()]).toEqual([...a.families.keys()]);
    const ca = a.creatures[0];
    const cb = b.creatureMap.get(ca.id)!;
    expect(cb.genome).toEqual(ca.genome);
    expect(cb.ph.maxSpeed).toBeCloseTo(ca.ph.maxSpeed, 12);
  });

  it('rejects saves from the future or garbage', () => {
    const a = new World({ seed: 'future', aspect: 16 / 9 });
    const s = snapshotWorld(a);
    expect(() => restoreWorld({ ...s, version: 999 })).toThrow();
    expect(() => restoreWorld({} as WorldSnapshot)).toThrow();
  });
});
