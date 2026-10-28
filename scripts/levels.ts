/**
 * Plays every challenge level headlessly with two bots: one that does
 * nothing (it should lose) and one that follows the level's intended idea
 * (it should win). Prints how each attempt went, to tune difficulty.
 *   npx tsx scripts/levels.ts [--level 1-3] [--seeds 3] [--trace 60]
 */
import { LEVELS } from '../src/game/levels';
import { describeCondition, plantCoverage } from '../src/game/conditions';
import { PLANS, playLevel } from '../src/game/levels/bots';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const only = arg('level', '');
const seeds = Number(arg('seeds', '3'));
const trace = Number(arg('trace', '0'));
const policies = arg('policy', 'idle,plan').split(',');

function play(levelId: string, policy: string, variant: number) {
  const def0 = LEVELS.find((l) => l.id === levelId)!;
  const def = variant === 0 ? def0 : { ...def0, seed: `${def0.seed}#${variant}` };
  let nextTrace = trace;
  const t0 = performance.now();
  const { run, world } = playLevel(def, policy === 'plan' ? PLANS[def.id] : undefined, (ctx) => {
    if (!trace || ctx.t < nextTrace) return;
    nextTrace += trace;
    const k = ctx.world.counts();
    console.log(
      `    t=${ctx.t.toFixed(0).padStart(4)} cons=${k.consumers} pred=${k.predators} eggs=${k.eggs} plants=${(plantCoverage(ctx.world) * 100).toFixed(0)}% algae=${k.algae} temp=${ctx.world.env.temperature.toFixed(2)} goals=${ctx.run.goals.map((g) => g.value.toFixed(1)).join('/')}`,
    );
  });
  const k = world.counts();
  const ms = performance.now() - t0;
  const used = Object.entries(run.used)
    .map(([t, n]) => `${t}×${n}`)
    .join(' ');
  return { run, k, ms, used };
}

for (const def of LEVELS) {
  if (only && def.id !== only) continue;
  console.log(`\n${def.id} ${def.name} — ${def.goals.map((g) => describeCondition(g.cond) + (g.atEnd ? '（结束时）' : '')).join('；')}`);
  for (const policy of policies) {
    if (policy === 'plan' && !PLANS[def.id]) continue;
    for (let v = 0; v < seeds; v++) {
      const { run, k, ms, used } = play(def.id, policy, v);
      const verdict = run.status === 'won' ? `WON ${'★'.repeat(run.stars)}${'☆'.repeat(3 - run.stars)}` : `LOST (${run.reason})`;
      console.log(
        `  ${policy.padEnd(5)} #${v}: ${verdict.padEnd(16)} t=${run.endT.toFixed(0).padStart(4)}s cons=${k.consumers} pred=${k.predators} eggs=${k.eggs} plants=${k.plants} used[${used}] (${(ms / 1000).toFixed(1)}s)`,
      );
    }
  }
}
