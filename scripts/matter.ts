/**
 * Where the tank's matter sits over a long run (balance diagnostics).
 *   npx tsx scripts/matter.ts --seed eden --hours 12 --every 60 [--watch 3]
 */
import { SIM_DT, World } from '../src/sim/world';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const world = new World({ seed: arg('seed', 'eden'), aspect: Number(arg('aspect', String(16 / 9))) });
const hours = Number(arg('hours', '12'));
const every = Number(arg('every', '60')) * 60;
const watchEach = Number(arg('watch', '0'));
let nextWatch = 60;
let next = 0;
const f = (v: number) => v.toFixed(0).padStart(7);
console.log(['   min', '  nutr', '  detr', ' plants', '  algae', '  fungi', ' consS', ' consE', ' predS', ' predE', '   eggs', 'corpses', '   food', '  seeds', ' cons', 'meanR', 'plantN'].join(' '));
while (world.time < hours * 3600) {
  world.step(SIM_DT);
  if (watchEach > 0 && world.time >= nextWatch) {
    // same choices as scripts/headless.ts, so both runs follow the same history
    nextWatch += 3600;
    const adults = world.creatures.filter((c) => c.dying === 0 && c.stage === 'adult');
    for (let i = 0; i < watchEach && adults.length; i++) {
      const c = adults.splice(Math.floor(world.rng.next() * adults.length), 1)[0];
      if (i === 0) world.history.rename(c, '小灯' + Math.round(world.time / 3600));
      else world.history.watch(c);
    }
  }
  if (world.time >= next) {
    next += every;
    const sum = { plant: 0, algae: 0, fungus: 0 };
    for (const p of world.producers) sum[p.kind] += p.biomass;
    let consS = 0, consE = 0, predS = 0, predE = 0, eggs = 0, n = 0, r = 0;
    for (const c of world.creatures) {
      if (c.stage === 'egg') { eggs += c.energy + c.structure; continue; }
      if (c.ph.trophic === 'carnivore') { predS += c.structure; predE += c.energy; }
      else { consS += c.structure; consE += c.energy; n++; r += c.ph.radius; }
    }
    console.log([
      (world.time / 60).toFixed(0).padStart(6), f(world.env.totalNutrient()), f(world.env.totalDetritus()), f(sum.plant), f(sum.algae), f(sum.fungus),
      f(consS), f(consE), f(predS), f(predE), f(eggs), f(world.corpses.reduce((a, c) => a + c.biomass, 0)), f(world.foods.reduce((a, x) => a + x.energy, 0)),
      f(world.seeds.reduce((a, s) => a + s.energy, 0)), String(n).padStart(5), (n ? r / n : 0).toFixed(2).padStart(5), String(world.producers.filter((p) => p.kind === 'plant').length).padStart(6),
    ].join(' '));
  }
}
