import { useEffect, useState } from 'react';
import type { Engine } from '../engine/engine';

export function App({ engine }: { engine: Engine }) {
  const [showTitle, setShowTitle] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setShowTitle(false), 5200);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="eden-ui">
      <div className={`eden-title ${showTitle ? 'is-visible' : ''}`} aria-hidden={!showTitle}>
        <div className="eden-title-main">浮生</div>
        <div className="eden-title-sub">{engine.world.name}</div>
      </div>
    </div>
  );
}
