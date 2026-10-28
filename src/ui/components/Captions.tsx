import { useEffect, useRef, useState } from 'react';
import type { Engine } from '../../engine/engine';
import { narrate, type StoryEvent } from '../../sim/history/narrator';

const SHOW_MS = 7000;

/** Quiet subtitles for the moments worth noticing. */
export function Captions({ engine }: { engine: Engine }) {
  const lastId = useRef(-1);
  const queue = useRef<StoryEvent[]>([]);
  const [current, setCurrent] = useState<StoryEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const world = engine.world;

  // a different world (load/new) starts from its latest entry
  useEffect(() => {
    const last = world.history.log.last();
    lastId.current = last ? last.id : 0;
    queue.current = [];
  }, [world]);

  // collect new notable events (runs on every engine publish)
  const log = world.history.log;
  const newest = log.last();
  useEffect(() => {
    if (!newest || newest.id <= lastId.current) return;
    for (const e of log) {
      if (e.id > lastId.current && e.i >= 2) queue.current.push(e);
    }
    lastId.current = newest.id;
    if (queue.current.length > 4) queue.current = queue.current.slice(-4);
  }, [newest, log]);

  useEffect(() => {
    if (current) return;
    const tick = setInterval(() => {
      const next = queue.current.shift();
      if (next) {
        setCurrent(next);
        setVisible(true);
      }
    }, 600);
    return () => clearInterval(tick);
  }, [current]);

  useEffect(() => {
    if (!current) return;
    const hide = setTimeout(() => setVisible(false), SHOW_MS);
    const clear = setTimeout(() => setCurrent(null), SHOW_MS + 1400);
    return () => {
      clearTimeout(hide);
      clearTimeout(clear);
    };
  }, [current]);

  if (!current) return null;
  return <div className={`caption tier-${current.i} ${visible ? 'is-visible' : ''}`}>{narrate(current)}</div>;
}
