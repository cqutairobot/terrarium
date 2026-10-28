import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('simulation purity', () => {
  const simFiles = files(join(__dirname, '..', 'src', 'sim'));

  it('never uses unseeded randomness (worlds must replay from a seed)', () => {
    for (const f of simFiles) expect(readFileSync(f, 'utf8'), f).not.toMatch(/Math\.random/);
  });

  it('never touches the DOM or rendering code', () => {
    for (const f of simFiles) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/\bdocument\.|\bwindow\.|from '\.\.\/(\.\.\/)?render/);
    }
  });
});
