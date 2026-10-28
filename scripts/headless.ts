/**
 * Headless long-run simulation for balancing and sanity checks.
 *   npm run sim -- --seed eden --hours 6 [--report 10]
 */
import { SIM_DT, World } from '../src/sim/world';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const seed = arg('seed', 'eden');
const hours = Number(arg('hours', '1'));
const reportMin = Number(arg('report', '10'));
const aspect = Number(arg('aspect', String(16 / 9)));

const world = new World({ seed, aspect });
const total = hours * 3600;
const reportEvery = reportMin * 60;
let nextReport = 0;
const t0 = performance.now();
const startMatter = world.totalMatter();

function pad(v: string | number, n: number): string {
  return String(v).padStart(n);
}

console.log(`world "${world.name}" seed=${seed} size=${world.width}x${world.height} hours=${hours}`);
console.log(
  ['  t(min)', 'cons', 'pred', 'eggs', 'plants', 'algae', 'fungi', 'nutr', 'detr', 'matter', 'temp', 'light', 'maxGen', 'births', 'deaths'].join(' '),
);
while (world.time < total) {
  world.step(SIM_DT);
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
      ].join(' '),
    );
  }
}
const elapsed = (performance.now() - t0) / 1000;
console.log(
  `done: ${hours}h simulated in ${elapsed.toFixed(1)}s (${((total / SIM_DT) / elapsed / 1000).toFixed(1)}k steps/s); matter ${startMatter.toFixed(0)} → ${world.totalMatter().toFixed(0)}, heat ${world.ledger.heat.toFixed(0)}, inflow ${world.ledger.inflow.toFixed(0)}`,
);
