import { narrateStory, type LifeStory } from '../../sim/history/stories';
import { formatAge } from '../format';

/** A life, chapter by chapter, timed by the creature's own age. */
export function StoryTimeline({ story, max = 200 }: { story: LifeStory; max?: number }) {
  const events = story.events.slice(-max);
  return (
    <ol className="timeline">
      {events.map((e, i) => {
        const after = story.diedT >= 0 && e.t > story.diedT + 0.5;
        const when = after ? `身后 ${formatAge(e.t - story.diedT)}` : e.k === 'born' ? '出生' : formatAge(Math.max(0, e.t - story.bornT));
        return (
          <li key={i} className={`tl-${e.k}`}>
            <span className="tl-when">{when}</span>
            <span className="tl-text">{narrateStory(story, e)}</span>
          </li>
        );
      })}
    </ol>
  );
}
