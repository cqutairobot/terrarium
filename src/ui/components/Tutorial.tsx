import { useEffect } from 'react';
import type { Engine } from '../../engine/engine';
import { TUTORIAL } from '../../game/tutorial';

/** A small guide for the first visit; each step notices when it has been done. */
export function Tutorial({ engine, panel }: { engine: Engine; panel: string | null }) {
  const t = engine.profile.tutorial;
  const step = TUTORIAL[t.step];
  const done = step?.done?.({ world: engine.world, feeds: engine.feeds, selectedId: engine.renderer.selectedId, panel }) ?? false;
  useEffect(() => {
    if (done) engine.advanceTutorial();
    // a step already done when it appears moves on at once
  }, [done, t.step, engine]);
  if (t.done || !step) return null;
  return (
    <div className="tutorial glass">
      <div className="tutorial-step muted small">
        {t.step + 1} / {TUTORIAL.length}
      </div>
      <div className="tutorial-text">{step.text}</div>
      <div className="tutorial-foot">
        <button className="link quiet" onClick={() => engine.skipTutorial()}>
          跳过引导
        </button>
        {!step.done && (
          <button className="btn small" onClick={() => engine.advanceTutorial()}>
            {t.step === TUTORIAL.length - 1 ? '好' : '下一步'}
          </button>
        )}
      </div>
    </div>
  );
}
