import { useEffect, useRef } from 'react';
import { drawPortrait } from '../../render/portrait';
import type { Genome } from '../../sim/genome';

/** A creature drawn from its genome alone. */
export function Portrait({ genome, width = 96, height = 64, id, className = '' }: { genome: Genome; width?: number; height?: number; id?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = genome.g.map((v) => v.toFixed(3)).join(',') + '|' + genome.rare.join('');
  useEffect(() => {
    if (ref.current) drawPortrait(ref.current, genome, { id });
    // keyed by the genome's content: a new object with the same genes needs no redraw
  }, [key, id, width, height]);
  return <canvas ref={ref} className={`portrait ${className}`} style={{ width, height }} aria-hidden="true" />;
}
