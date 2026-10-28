/**
 * Headless long-run simulation for balancing and sanity checks.
 *   npm run sim -- --seed eden --hours 6 [--report 10] [--watch 3]
 * --watch N follows N creatures every simulated hour (exercises life stories and
 * lineage pruning) and prints the history's memory footprint at the end.
 */
import { restoreWorld, snapshotWorld } from '../src/sim/serialize';
import { SIM_DT, World } from '../src/sim/world';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const seed = arg('seed', 'eden');
const hours = Number(arg('hours', '1'));
const reportMin = Number(arg('report', '10'));
const aspect = Number(arg('aspect', String(16 / 9)));
const watchEach = Number(arg('watch', '0'));
let nextWatch = 60;

const world = new World({ seed, aspect });
const total = hours * 3600;
const reportEvery = reportMin * 60;
let nextReport = 0;
const tally: Record<string, number> = {};
const t0 = performance.now();
const startMatter = world.totalMatter();

function pad(v: string | number, n: number): string {
  return String(v).padStart(n);
}

console.log(`world "${world.name}" seed=${seed} size=${world.width}x${world.height} hours=${hours}`);
console.log(
  ['  t(min)', 'cons', 'pred', 'eggs', 'plants', 'algae', 'fungi', 'nutr', 'detr', 'matter', 'temp', 'light', 'maxGen', 'births', 'deaths', 'kills', 'starve', 'age', 'species', 'resp'].join(' '),
);
while (world.time < total) {
  world.step(SIM_DT);
  if (watchEach > 0 && world.time >= nextWatch) {
    nextWatch += 3600;
    const adults = world.creatures.filter((c) => c.dying === 0 && c.stage === 'adult');
    for (let i = 0; i < watchEach && adults.length; i++) {
      const c = adults.splice(Math.floor(world.rng.next() * adults.length), 1)[0];
      if (i === 0) world.history.rename(c, '小灯' + Math.round(world.time / 3600));
      else world.history.watch(c);
    }
  }
  for (const e of world.lastEvents) {
    if (e.t === 'death') tally[e.cause] = (tally[e.cause] ?? 0) + 1;
    else if (e.t === 'respawn') tally.respawn = (tally.respawn ?? 0) + 1;
  }
  if (world.time >= nextReport) {
    nextReport += reportEvery;
    const k = world.counts();
    let maxGen = 0;
    for (const c of world.creatures) maxGen = Math.max(maxGen, c.generation);
    console.log(
      [
        pad((world.time / 60).toFixed(0), 8),
        pad(k.consumers, 4),
        pad(k.predators, 4),
        pad(k.eggs, 4),
        pad(k.plants, 6),
        pad(k.algae, 5),
        pad(k.fungi, 5),
        pad(world.env.totalNutrient().toFixed(0), 6),
        pad(world.env.totalDetritus().toFixed(0), 6),
        pad(world.totalMatter().toFixed(0), 6),
        pad(world.env.temperature.toFixed(2), 4),
        pad(world.env.light.toFixed(2), 5),
        pad(maxGen, 6),
        pad(world.counters.births, 6),
        pad(world.counters.deaths, 6),
        pad(tally.predation ?? 0, 5),
        pad(tally.starvation ?? 0, 6),
        pad(tally.age ?? 0, 4),
        pad([...world.species.values()].filter((s) => s.extinctAt === null).length, 7),
        pad(tally.respawn ?? 0, 4),
      ].join(' '),
    );
  }
}
const elapsed = (performance.now() - t0) / 1000;
{
  const h = world.history;
  const stories = [...h.stories.values()];
  const snap = snapshotWorld(world);
  const json = JSON.stringify(snap);
  const historyJson = JSON.stringify(snap.history);
  const r = restoreWorld(JSON.parse(json));
  console.log(
    `history: chronicle ${h.chronicle.length}, log ${h.log.length}, codex ${h.codex.size}, lineage ${h.lineage.nodes.size} nodes (${h.lineage.pinned.size} pinned), ` +
      `stories ${stories.length} (watched ${stories.filter((s) => s.watched).length}, records ${stories.filter((s) => s.auto).length}, ` +
      `longest bloodline ${Math.max(0, ...stories.map((s) => s.maxDepth))} gens, ${stories.reduce((a, s) => a + s.events.length, 0)} story lines)`,
  );
  console.log(
    `save: ${(json.length / 1024).toFixed(0)} KB total, history ${(historyJson.length / 1024).toFixed(0)} KB; restored ${r.creatures.length} creatures, ${r.history.stories.size} stories; heap ${(process.memoryUsage().heapUsed / 1048576).toFixed(0)} MB`,
  );
}
console.log(
  `done: ${hours}h simulated in ${elapsed.toFixed(1)}s (${((total / SIM_DT) / elapsed / 1000).toFixed(1)}k steps/s); matter ${startMatter.toFixed(0)} → ${world.totalMatter().toFixed(0)}, heat ${world.ledger.heat.toFixed(0)}, inflow ${world.ledger.inflow.toFixed(0)}`,
);
