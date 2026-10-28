import type { Engine } from '../../engine/engine';
import { describeCondition } from '../../game/conditions';
import { CHAPTERS, dailyLevel, dailyUnlocked, levelUnlocked, nextLevel, starsOf } from '../../game/levels';
import { capOf, describeStar, type LevelRun } from '../../game/levels/run';
import type { LevelDef, ToolKind } from '../../game/levels/types';
import { localDate } from '../../game/requests';
import { FOOD_LABELS } from '../../sim/entities/food';
import { DISASTER_LABELS, type DisasterKind } from '../../sim/environment';

/** m:ss; a countdown rounds up (it reads 0:00 only when time is out), time spent rounds down. */
function mmss(seconds: number, spent = false): string {
  const s = Math.max(0, spent ? Math.floor(seconds) : Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Stars({ n, of = 3 }: { n: number; of?: number }) {
  return (
    <span className="stars" aria-label={`${n} 颗星`}>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < n ? 'on' : ''}>
          ★
        </i>
      ))}
    </span>
  );
}

/** Every tool a level gives, with how many uses. */
export function levelTools(def: LevelDef): { tool: ToolKind | 'env'; label: string; cap: number }[] {
  const out: { tool: ToolKind | 'env'; label: string; cap: number }[] = [];
  const t = def.tools;
  if (t.food !== undefined) out.push({ tool: 'food', label: FOOD_LABELS.pellet, cap: t.food });
  if (t.rich !== undefined) out.push({ tool: 'rich', label: FOOD_LABELS.rich, cap: t.rich });
  if (t.spore !== undefined) out.push({ tool: 'spore', label: FOOD_LABELS.spore, cap: t.spore });
  if (t.pair !== undefined) out.push({ tool: 'pair', label: '配对', cap: t.pair });
  if (t.release !== undefined) out.push({ tool: 'release', label: '放生', cap: t.release });
  if (t.call) out.push({ tool: 'call', label: t.call.label, cap: t.call.uses });
  for (const [k, n] of Object.entries(t.disasters ?? {}) as [DisasterKind, number][]) out.push({ tool: `disaster:${k}`, label: DISASTER_LABELS[k], cap: n });
  if (t.env) out.push({ tool: 'env', label: '调节环境', cap: Infinity });
  return out;
}

function usesLeft(run: LevelRun, tool: ToolKind | 'env'): string {
  if (tool === 'env') return '';
  const left = run.left(tool);
  return left === Infinity ? '' : ` ${left}`;
}

function chapterTitle(def: LevelDef): string {
  return def.chapter === 0 ? '每日挑战' : `第${'一二三四五六七八九'[def.chapter - 1] ?? def.chapter}章 · ${def.index}`;
}

/** The challenge's state along the top: time, goals, warnings, tools. */
export function LevelHud({ engine }: { engine: Engine }) {
  const run = engine.level!;
  const def = run.def;
  const w = engine.world;
  const left = run.status === 'playing' ? run.remaining(w) : def.timeLimit - run.endT;
  const loop = engine.loop;
  return (
    <div className="top-bar level-hud">
      <div className="level-title glass">
        <span className="muted small">{chapterTitle(def)}</span>
        <b>{def.name}</b>
        <span className={`level-clock ${left < 60 && run.status === 'playing' ? 'warm' : ''}`} title="剩余时间（按模拟时间计算，可以加速）">
          ⏱ {mmss(left)}
        </span>
        {loop.paused && engine.levelPhase === 'playing' && <span className="warm small">已暂停</span>}
        {!loop.paused && loop.timeScale !== 1 && <span className="small">{loop.timeScale}×</span>}
        <button className="btn small ghost" onClick={() => engine.restartLevel()} disabled={engine.levelPhase === 'intro'}>
          重来
        </button>
        <button className="btn small ghost" onClick={() => void engine.exitLevel()}>
          离开
        </button>
      </div>
      <div className="level-goals glass">
        {def.goals.map((g, i) => {
          const st = run.goals[i];
          // a goal judged at the end is only "holding" until then
          const done = st?.met && (!g.atEnd || run.status === 'won');
          return (
            <div key={i} className={`level-goal ${done ? 'met' : st?.met ? 'holding' : ''}`}>
              <span>
                {done ? '✓ ' : ''}
                {describeCondition(g.cond)}
                {g.atEnd ? <span className="muted">（时间到时）</span> : null}
              </span>
              <span className="goal-track">
                <span style={{ width: `${Math.round((st?.progress ?? 0) * 100)}%` }} />
              </span>
            </div>
          );
        })}
        {run.warnings.map((x) => (
          <div key={`${x.kind}-${x.at}`} className="level-warning">
            ⚠ {DISASTER_LABELS[x.kind]} · {mmss(x.at - run.elapsed(w))} 后到达
          </div>
        ))}
        <div className="level-tools muted small">
          {levelTools(def).map((t) => (
            <span key={t.tool}>
              {t.label}
              {usesLeft(run, t.tool)}
            </span>
          ))}
          {levelTools(def).length === 0 && <span>这一关只能观察</span>}
        </div>
      </div>
    </div>
  );
}

/** Before the clock starts: the story, the goals, the tools, the stars. */
export function LevelIntro({ engine }: { engine: Engine }) {
  const def = engine.level!.def;
  const tools = levelTools(def);
  return (
    <div className="veil">
      <div className="level-card glass">
        <div className="muted small">{chapterTitle(def)}</div>
        <div className="catch-title">{def.name}</div>
        <p className="level-story">{def.intro}</p>
        <div className="section-title">目标</div>
        <ul className="level-list">
          {def.goals.map((g, i) => (
            <li key={i}>
              {describeCondition(g.cond)}
              {g.atEnd ? '（时间到时判定）' : ''}
            </li>
          ))}
          <li className="muted">
            时限 {mmss(def.timeLimit)}（模拟时间，可以用 2× 或 5× 加速）
          </li>
        </ul>
        <div className="section-title">可以用的</div>
        <div className="level-tool-chips">
          {tools.map((t) => (
            <span key={t.tool} className="chip">
              {t.label}
              {t.cap !== Infinity ? ` × ${t.cap}` : ''}
            </span>
          ))}
          {tools.length === 0 && <span className="muted small">只能观察</span>}
        </div>
        <div className="section-title">星星</div>
        <ul className="level-list stars-list">
          <li>
            <Stars n={1} of={1} /> 完成目标
          </li>
          {def.stars.map((s, i) => (
            <li key={i}>
              <Stars n={1} of={1} /> {describeStar(s)}
            </li>
          ))}
        </ul>
        {def.hint && <div className="muted small level-hint">提示：{def.hint}</div>}
        <div className="btn-row end">
          <button className="btn ghost" onClick={() => void engine.exitLevel()}>
            返回水缸
          </button>
          <button className="btn" onClick={() => engine.beginLevel()}>
            开始
          </button>
        </div>
      </div>
    </div>
  );
}

/** How the attempt went. */
export function LevelResultCard({ engine, onHide }: { engine: Engine; onHide: () => void }) {
  const run = engine.level!;
  const def = run.def;
  const res = engine.levelResult;
  const won = run.status === 'won';
  const next = won ? nextLevel(def) : undefined;
  return (
    <div className="veil soft">
      <div className="level-card glass">
        <div className="muted small">{chapterTitle(def)}</div>
        <div className="catch-title">{won ? `「${def.name}」完成了` : `「${def.name}」没能完成`}</div>
        {won ? (
          <>
            <div className="level-result-stars">
              <Stars n={run.stars} />
            </div>
            <p className="level-story">{def.outro}</p>
            <ul className="level-list stars-list">
              <li className="ok">✓ 完成目标</li>
              {def.stars.map((s, i) => (
                <li key={i} className={run.starHits[i + 1] ? 'ok' : 'muted'}>
                  {run.starHits[i + 1] ? '✓' : '·'} {describeStar(s)}
                </li>
              ))}
            </ul>
            {res && res.lumen > 0 && (
              <div className="level-reward">
                新得到 {res.newStars} 颗星 · ✦ +{res.lumen} 灵光
              </div>
            )}
          </>
        ) : (
          <>
            <p className="level-story">{run.reason}。</p>
            {def.hint && <div className="muted small level-hint">提示：{def.hint}</div>}
          </>
        )}
        <div className="muted small">用时 {mmss(run.endT, true)}</div>
        <div className="btn-row end">
          <button className="link quiet" onClick={onHide}>
            看看水缸
          </button>
          <button className="btn ghost" onClick={() => void engine.exitLevel()}>
            返回水缸
          </button>
          <button className={`btn ${next ? 'ghost' : ''}`} onClick={() => engine.restartLevel()}>
            再试一次
          </button>
          {next && levelUnlocked(engine.profile, next) && (
            <button className="btn" onClick={() => void engine.startLevel(next)}>
              下一关
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The challenges, chapter by chapter, opening one after another. */
export function LevelsPanel({ engine }: { engine: Engine }) {
  const p = engine.profile;
  const today = localDate(Date.now());
  const daily = dailyLevel(today);
  const dailyOpen = dailyUnlocked(p);
  return (
    <div className="panel-body levels-panel">
      <p className="muted small">每一关都是一个生态难题，有胜有负。完成目标得一颗星，做得更好再得两颗；星星会换成灵光。挑战期间，你的水缸照常生活。</p>
      <button className={`level-row daily ${dailyOpen ? '' : 'locked'}`} disabled={!dailyOpen || engine.busy} onClick={() => void engine.startLevel(daily)}>
        <span className="level-no">今日</span>
        <span className="level-name">
          每日挑战 · {daily.name}
          {!dailyOpen && <span className="muted small"> （完成「{CHAPTERS[0].levels[2].name}」后开放）</span>}
        </span>
        <Stars n={starsOf(p, daily.id)} />
      </button>
      {CHAPTERS.map((ch) => {
        const got = ch.levels.reduce((a, l) => a + starsOf(p, l.id), 0);
        return (
          <div key={ch.id} className="chapter">
            <div className="section-title chapter-head">
              <span>
                第{'一二三四五六七八九'[ch.id - 1]}章 · {ch.name}
              </span>
              <span className="muted small">
                ★ {got} / {ch.levels.length * 3}
              </span>
            </div>
            {ch.levels.map((l) => {
              const open = levelUnlocked(p, l);
              const rec = p.levels[l.id];
              return (
                <button key={l.id} className={`level-row ${open ? '' : 'locked'}`} disabled={!open || engine.busy} onClick={() => void engine.startLevel(l)}>
                  <span className="level-no">{l.index}</span>
                  <span className="level-name">
                    {l.name}
                    {rec?.bestTime !== undefined && l.goals.every((g) => !g.atEnd) && <span className="muted small"> · 最快 {mmss(rec.bestTime, true)}</span>}
                  </span>
                  {open ? <Stars n={rec?.stars ?? 0} /> : <span className="muted small">未解锁</span>}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** A tool's uses left, for badges (empty when unlimited or not counted). */
export function toolBadge(engine: Engine, tool: ToolKind): string | null {
  const run = engine.level;
  if (!run || capOf(run.def, tool) === undefined) return null;
  const left = run.left(tool);
  return left === Infinity ? null : String(left);
}
