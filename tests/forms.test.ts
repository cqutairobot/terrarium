import { describe, expect, it } from 'vitest';
import { FORM_ARCHETYPES } from '../src/sim/archetypes';
import { inCover, perceive, producerEfficiency } from '../src/sim/behavior/perception';
import { BIOMES } from '../src/sim/biomes';
import { Rng } from '../src/sim/core/rng';
import { comfortSpot, inShelter, lampLight, placeDecor, removeDecor, temperatureAt } from '../src/sim/decor';
import { breed, cloneGenome, compatibility, express, G, geneticDistance, genomeFromTemplate, type Genome, type Morph } from '../src/sim/genome';
import { speciesFor } from '../src/sim/migration';
import { restoreWorld, snapshotWorld } from '../src/sim/serialize';
import { introduceFounders, plantAnemone, plantMoss } from '../src/sim/systems/ecology';
import { updateFeeding } from '../src/sim/systems/feeding';
import { World } from '../src/sim/world';
import { addAdult, emptyWorld, herbGenome, predGenome, PRED_SPECIES, stepFor } from './helpers';

const balance = (w: World) => w.totalMatter() + w.ledger.heat - w.ledger.inflow - w.ledger.feed - w.ledger.moved;

function formGenome(morph: Morph, seed: string = morph): Genome {
  const arch = FORM_ARCHETYPES.find((a) => a.morph === morph)!;
  const g = genomeFromTemplate(arch.template, new Rng(seed), 0.01);
  g.morph = morph;
  return g;
}

describe('body plans', () => {
  it('pass down whole and never mix', () => {
    const a = formGenome('jelly', 'a');
    const b = formGenome('jelly', 'b');
    const rng = new Rng('breed');
    for (let i = 0; i < 20; i++) expect(breed(a, b, rng, { rate: 0.5, sigmaScale: 1, macroChance: 0.1 }, 1).genome.morph).toBe('jelly');
    expect(cloneGenome(a).morph).toBe('jelly');
    // a fish and a jelly with the very same genes still cannot pair
    const fish = { g: a.g.slice(), rare: a.rare.slice() };
    expect(compatibility(a, fish, 0.22)).toBe(0);
    expect(geneticDistance(a, fish)).toBeGreaterThanOrEqual(1);
    expect(compatibility(a, b, 0.22)).toBeGreaterThan(0.5);
  });

  it('shape what a body can do', () => {
    const base = herbGenome('same');
    const as = (m: Morph | undefined) => express({ ...cloneGenome(base), morph: m });
    const fish = as(undefined);
    const snail = as('snail');
    const shrimp = as('shrimp');
    const jelly = as('jelly');
    expect(fish.morph).toBe('fish');
    expect(snail.maxSpeed).toBeLessThan(fish.maxSpeed * 0.3);
    expect(snail.defense).toBeGreaterThan(fish.defense + 0.3);
    expect(shrimp.radius).toBeLessThan(fish.radius);
    expect(jelly.tentacleCount).toBeGreaterThanOrEqual(6);
    // diets follow the body: bells and shells graze, a shrimp eats what settles but never hunts
    const meat = { ...cloneGenome(base), morph: 'snail' as Morph };
    meat.g[G.diet] = 0.95;
    expect(express(meat).trophic).toBe('herbivore');
    meat.morph = 'shrimp';
    expect(express(meat).trophic).toBe('omnivore');
  });

  it('a snail keeps to the floor, a shrimp cleans it, a bell strains the water', () => {
    const w = emptyWorld('forms');
    const snail = addAdult(w, formGenome('snail'), 600, 300);
    stepFor(w, 2);
    expect(snail.y).toBeCloseTo(w.groundAt(snail.x) - snail.ph.radius * snail.growth * 0.6, 0);
    // something has settled under the shrimp, and there is food in the water around the bell
    const shrimp = addAdult(w, formGenome('shrimp'), 900, w.groundAt(900) - 12, 1, 0.3);
    const jelly = addAdult(w, formGenome('jelly'), 400, 500, 1, 0.3);
    const i = w.env.cellIndex(shrimp.x, shrimp.y);
    const j = w.env.cellIndex(jelly.x, jelly.y);
    w.env.detritus[i] += 40;
    w.env.nutrient[j] += 40;
    // a fish beside the shrimp gets nothing from the floor
    const fish = addAdult(w, herbGenome('fish'), 910, w.groundAt(910) - 12, 1, 0.3);
    const before = balance(w);
    const detritus = w.env.detritus[i];
    const water = w.env.nutrient[j];
    const e0 = { shrimp: shrimp.energy, jelly: jelly.energy, fish: fish.energy };
    for (const c of [shrimp, jelly, fish]) c.state = 'wander';
    updateFeeding(w, shrimp, 1);
    updateFeeding(w, jelly, 1);
    updateFeeding(w, fish, 1);
    expect(w.env.detritus[i]).toBeLessThan(detritus);
    expect(shrimp.energy).toBeGreaterThan(e0.shrimp);
    expect(jelly.energy).toBeGreaterThan(e0.jelly);
    expect(w.env.nutrient[j]).toBeLessThan(water);
    expect(fish.energy).toBe(e0.fish);
    expect(balance(w)).toBeCloseTo(before, 6);
  });

  it('a bell stings: only a starving hunter goes after one', () => {
    const w = emptyWorld('sting');
    const hunter = addAdult(w, predGenome('h'), 500, 400, PRED_SPECIES, 0.5);
    addAdult(w, formGenome('jelly'), 560, 400);
    w.rebuildGrids();
    expect(perceive(w, hunter).prey).toBeNull();
    hunter.energy = hunter.ph.maxEnergy * 0.05;
    expect(perceive(w, hunter).prey?.ph.morph).toBe('jelly');
  });

  it('newcomers of a body plan found a species named for it, and travellers keep to their own kind', () => {
    const w = emptyWorld('names');
    for (const [key, word] of [
      ['jelly', '水母'],
      ['shrimp', '虾'],
      ['snail', '螺'],
    ] as const) {
      const born = introduceFounders(w, key, 3, { adult: true });
      expect(born.length).toBe(3);
      const sp = w.species.get(born[0].speciesId)!;
      expect(sp.morph).toBe(key);
      expect(sp.name.endsWith(word)).toBe(true);
      expect(new Set(born.map((c) => c.ph.morph))).toEqual(new Set([key]));
    }
    w.rebuildGrids();
    // a jelly arriving from elsewhere joins the jellies, never a fish species
    const jellySpecies = [...w.species.values()].find((s) => s.morph === 'jelly')!;
    jellySpecies.population = 3;
    jellySpecies.centroid = w.creatures.find((c) => c.ph.morph === 'jelly')!.genome.g.slice();
    expect(speciesFor(w, formGenome('jelly', 'traveller'))).toBe(jellySpecies.id);
  });
});

describe('decorations', () => {
  it('warm and cool the water around them, hide the small, and light the plants', () => {
    const w = emptyWorld('decor');
    const base = temperatureAt(w, 300, w.groundAt(300) - 30);
    placeDecor(w, 'warmStone', 300);
    placeDecor(w, 'coolStone', 1300);
    placeDecor(w, 'shelter', 800);
    const lamp = placeDecor(w, 'lamp', 1600)!;
    expect(temperatureAt(w, 300, w.groundAt(300) - 30)).toBeGreaterThan(base + 0.15);
    expect(temperatureAt(w, 1300, w.groundAt(1300) - 30)).toBeLessThan(base - 0.15);
    expect(temperatureAt(w, 300, 100)).toBeCloseTo(base, 6);
    expect(inShelter(w, 800, w.groundAt(800) - 20)).toBe(true);
    expect(inCover(w, 800, w.groundAt(800) - 20)).toBe(true);
    expect(inShelter(w, 800, 200)).toBe(false);
    expect(lampLight(w, 1600, w.groundAt(1600) - 60)).toBeGreaterThan(0.3);
    expect(lampLight(w, 200, 200)).toBe(0);
    expect(removeDecor(w, lamp.id)).toBe(true);
    expect(w.decor.length).toBe(3);
  });

  it('draw a creature in hurting water toward a stone that helps', () => {
    const w = emptyWorld('comfort');
    w.env.temperature = 0.1;
    const warmLover = herbGenome('warm');
    warmLover.g[G.thermalPref] = 0.8;
    const c = addAdult(w, warmLover, 500, 600);
    expect(comfortSpot(w, c)).toBeNull();
    const stone = placeDecor(w, 'warmStone', 700)!;
    expect(comfortSpot(w, c)).toBe(stone);
    // the stone would only make it worse for one that loves the cold
    const coldLover = herbGenome('cold');
    coldLover.g[G.thermalPref] = 0.0;
    const d = addAdult(w, coldLover, 520, 600);
    w.env.temperature = 0.6;
    expect(comfortSpot(w, d)).toBeNull();
  });

  it('are kept with the world, as is its kind of water', () => {
    const w = new World({ seed: 'keep', aspect: 16 / 9, biome: 'reef' });
    placeDecor(w, 'lamp', 500);
    placeDecor(w, 'shelter', 900);
    const back = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(w))));
    expect(back.biome).toBe('reef');
    expect(back.decor.map((d) => d.kind)).toEqual(['lamp', 'shelter']);
    // an older save has neither
    const old = snapshotWorld(new World({ seed: 'old', aspect: 16 / 9 }));
    delete old.decor;
    delete old.biome;
    const r = restoreWorld(old);
    expect(r.biome).toBe('shallows');
    expect(r.decor).toEqual([]);
  });
});

describe('moss and anemones', () => {
  it('moss creeps along the floor and feeds grazers; anemones feed no one but hide the small', () => {
    const w = new World({ seed: 'moss', aspect: 16 / 9, lifeless: true });
    expect(plantMoss(w, 6)).toBe(6);
    expect(plantAnemone(w, 700)).toBe(true);
    w.rebuildGrids();
    const anemone = w.producers.find((p) => p.kind === 'anemone')!;
    const small = addAdult(w, formGenome('shrimp'), 700, anemone.y - 12);
    expect(producerEfficiency(small, 'anemone')).toBe(0);
    expect(producerEfficiency(small, 'moss')).toBeGreaterThan(0);
    anemone.biomass = 30;
    w.rebuildGrids();
    expect(inCover(w, small.x, small.y, small.ph.radius)).toBe(true);
    const before = balance(w);
    const n0 = w.counts().moss;
    stepFor(w, 900);
    expect(w.counts().moss).toBeGreaterThan(n0);
    // nothing appears or vanishes from nowhere while it all grows
    expect(Math.abs(balance(w) - before)).toBeLessThan(1e-6 * Math.max(1, before));
  });
});

describe('kinds of water', () => {
  it('a biome sets the climate and its first life fits the water', () => {
    const abyss = new World({ seed: 'deep', aspect: 16 / 9, biome: 'abyss' });
    expect(abyss.env.settings.temperature).toBe(BIOMES.abyss.settings.temperature);
    const fish = abyss.creatures.filter((c) => c.ph.morph === 'fish' && c.ph.trophic !== 'carnivore');
    expect(fish.length).toBeGreaterThan(0);
    for (const c of fish) expect(c.genome.g[G.thermalPref]).toBeLessThan(0.3);
    const k = abyss.counts();
    expect(k.moss).toBeGreaterThan(0);
    expect(k.anemones).toBeGreaterThan(0);
    expect(abyss.creatures.some((c) => c.ph.morph === 'jelly')).toBe(true);
    expect(abyss.creatures.some((c) => c.ph.morph === 'snail')).toBe(true);
    const reef = new World({ seed: 'deep', aspect: 16 / 9, biome: 'reef' });
    expect(reef.creatures.some((c) => c.ph.morph === 'shrimp')).toBe(true);
    for (const c of reef.creatures.filter((c) => c.ph.morph === 'fish' && c.ph.trophic !== 'carnivore')) expect(c.genome.g[G.thermalPref]).toBeGreaterThan(0.7);
    // the shallows start just as they always did
    const shallows = new World({ seed: 'deep', aspect: 16 / 9 });
    expect(shallows.biome).toBe('shallows');
    expect(shallows.counts().moss + shallows.counts().anemones).toBe(0);
    expect(shallows.creatures.every((c) => c.ph.morph === 'fish')).toBe(true);
  });
});
