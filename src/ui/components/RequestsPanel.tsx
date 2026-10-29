import type { Engine } from '../../engine/engine';
import { specChecks, specCloseness } from '../../game/conditions';
import { candidatesFor, ecologyStatus, type Request } from '../../game/requests';
import { Portrait } from './Portrait';

const LEVELS = ['', '简单', '要花点心思', '很难'];

/** 委托: wishes from people around the tank, answered with real creatures and real tank states. */
export function RequestsPanel({ engine }: { engine: Engine }) {
  // The drawer closes after rendering when a challenge starts. Do not observe
  // its temporary world under the garden tank's id during that transition.
  if (engine.level) return null;
  const board = engine.profile.requests;
  return (
    <div className="panel-body">
      <div className="muted small">
        委托都来自你水缸里真实的生命：把符合要求的生命交给提出委托的人（它会离开水缸，去新的地方生活），或者让水缸自己达到某种样子。已完成 {board.completed} 个。
      </div>
      <div className="request-list">
        {board.open.map((r) => (
          <RequestCard key={r.id} engine={engine} r={r} />
        ))}
      </div>
    </div>
  );
}

function RequestCard({ engine, r }: { engine: Engine; r: Request }) {
  const world = engine.world;
  return (
    <div className={`request ${r.daily ? 'daily' : ''}`}>
      <div className="request-head">
        <span className="request-from">
          {r.daily ? '今日委托 · ' : ''}
          {r.from}
        </span>
        <span className="request-reward">
          <span className="muted small">{LEVELS[r.difficulty]} · </span>✦ {r.reward}
        </span>
      </div>
      <div className="request-goal">想要{r.kind === 'deliver' ? '' : '：'}{r.goal}</div>
      <div className="muted small">{r.text}</div>
      {r.kind === 'deliver' ? <Delivery engine={engine} r={r} /> : <EcologyBar engine={engine} r={r} />}
      <div className="request-foot">
        <button className="link quiet" onClick={() => engine.skipRequest(r.id)}>
          换一个
        </button>
        <span className="muted small">在「{world.name}」里看</span>
      </div>
    </div>
  );
}

function Delivery({ engine, r }: { engine: Engine; r: Request }) {
  const world = engine.world;
  const ready = candidatesFor(world, r);
  if (ready.length > 0)
    return (
      <div className="request-candidates">
        {ready.slice(0, 3).map((c) => (
          <div key={c.id} className="candidate">
            <Portrait genome={c.genome} width={54} height={34} id={c.id} />
            <button className="link" onClick={() => engine.select(c.id)}>
              {c.customName || c.name}
            </button>
            <button className="btn small" onClick={() => void engine.deliverRequest(r.id, c.id)}>
              交给{r.from.slice(-2)}
            </button>
          </div>
        ))}
        {ready.length > 3 && <span className="muted small">还有 {ready.length - 3} 只也符合</span>}
      </div>
    );
  // the nearest miss, so the player knows what to breed toward
  const spec = r.spec!;
  const near = world.creatures
    .filter((c) => c.dying === 0 && c.stage !== 'egg')
    .map((c) => ({ c, k: specCloseness(c, spec) }))
    .sort((a, b) => b.k - a.k)[0];
  if (!near) return <div className="muted small">水缸里还没有能接近的生命。</div>;
  return (
    <div className="near-miss">
      <span className="muted small">最接近的是</span>
      <button className="link" onClick={() => engine.select(near.c.id)}>
        {near.c.customName || near.c.name}
      </button>
      <span className="checks">
        {specChecks(near.c, spec).map((x) => (
          <span key={x.label} className={x.ok ? 'ok' : 'no'}>
            {x.ok ? '✓' : '·'} {x.label}
          </span>
        ))}
      </span>
    </div>
  );
}

function EcologyBar({ engine, r }: { engine: Engine; r: Request }) {
  const st = ecologyStatus(engine.world, engine.profile.requests, r, engine.tankId);
  return (
    <div className="catch-bar request-bar" title={`${Math.round(st.progress * 100)}%`}>
      <span style={{ width: `${st.progress * 100}%` }} />
    </div>
  );
}
