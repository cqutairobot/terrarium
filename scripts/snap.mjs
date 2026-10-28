/**
 * Visual + runtime check with the pre-installed Playwright Chromium.
 *   npm run build && node scripts/snap.mjs [--seed eden] [--size 1920x1080] [--out snapshots]
 * Serves dist/ with `vite preview`, takes screenshots at several moments,
 * measures frame rate and reports console errors.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const seed = arg('seed', 'eden');
const sizes = arg('size', '1920x1080').split(',');
const out = arg('out', 'snapshots');
const port = Number(arg('port', '4173'));
const scenario = arg('scenario', 'basic');
mkdirSync(out, { recursive: true });

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
const stopServer = () => {
  try {
    server.kill('SIGTERM');
  } catch {
    /* already gone */
  }
};
process.on('exit', stopServer);
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server did not start')), 20000);
  server.stdout.on('data', (d) => {
    if (String(d).includes(String(port))) {
      clearTimeout(t);
      resolve();
    }
  });
  server.stderr.on('data', (d) => process.stderr.write(d));
});

const browser = await chromium.launch();
let failed = false;
try {
  for (const size of sizes) {
    const [w, h] = size.split('x').map(Number);
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`http://localhost:${port}/?seed=${encodeURIComponent(seed)}`);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/${size}-start.png` });

    const fps = await page.evaluate(
      () =>
        new Promise((resolve) => {
          let n = 0;
          const t0 = performance.now();
          const f = () => {
            n++;
            if (performance.now() - t0 < 3000) requestAnimationFrame(f);
            else resolve((n * 1000) / (performance.now() - t0));
          };
          requestAnimationFrame(f);
        }),
    );
    const info = await page.evaluate(() => {
      const e = window.__eden;
      return { creatures: e.world.creatures.length, producers: e.world.producers.length, time: e.world.time };
    });
    console.log(`[${size}] fps≈${fps.toFixed(1)} creatures=${info.creatures} producers=${info.producers} simTime=${info.time.toFixed(1)}`);

    // jump the world forward (simulated) to look at later moments
    const advance = async (seconds) =>
      page.evaluate((s) => {
        const e = window.__eden;
        const steps = Math.round(s * 30);
        for (let i = 0; i < steps; i++) e.world.step(1 / 30);
      }, seconds);
    await advance(150);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/${size}-later.png` });
    await advance(420);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/${size}-night.png` });
    if (scenario === 'zoom') {
      await page.evaluate(() => {
        const e = window.__eden;
        const c = e.world.creatures.find((x) => x.stage !== 'egg' && x.ph.trophic !== 'carnivore');
        if (c) {
          e.renderer.selectedId = c.id;
          e.renderer.followId = c.id;
        }
      });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${out}/${size}-follow.png` });
    }
    if (scenario === 'soul') {
      // life stories, archive, codex and the evolution views
      const shot = async (name) => {
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${out}/${size}-${name}.png` });
      };
      const id = await page.evaluate(() => {
        const e = window.__eden;
        const adults = e.world.creatures.filter((x) => x.stage === 'adult' && x.dying === 0 && x.ph.trophic !== 'carnivore');
        const c = adults.sort((a, b) => b.children - a.children)[0];
        e.rename(c.id, '小灯');
        e.select(c.id);
        return c.id;
      });
      await shot('card-now');
      await page.getByRole('button', { name: '一生', exact: true }).click();
      await shot('card-life');
      await page.getByRole('button', { name: '家族', exact: true }).click();
      await shot('card-kin');
      await advance(900);
      // a rare trait for the codex, as if one had just been born
      await page.evaluate(() => {
        const e = window.__eden;
        const c = e.world.creatures.find((x) => x.stage === 'adult' && x.dying === 0);
        c.genome.rare[0] = c.genome.rare[1] = 1;
        e.world.history.onRareBirth(c, { golden: true, translucent: false, twinTail: false, extraTentacles: 0, fluorescent: false, eyeType: 0, rainbow: false, mask: 1 });
      });
      await page.mouse.move(w / 2, h - 12);
      await page.waitForTimeout(900);
      await page.getByRole('button', { name: '生命档案馆' }).click();
      await shot('archive');
      const row = page.locator('.story-row').first();
      if (await row.count()) {
        await row.click();
        await shot('story');
      }
      await page.getByRole('button', { name: '生命图鉴' }).click();
      await shot('codex');
      await page.getByRole('button', { name: '生态统计' }).click();
      await page.locator('.panel-body').evaluate((el) => (el.scrollTop = el.scrollHeight));
      await shot('stats-evolution');
      await page.getByRole('button', { name: '世界编年史' }).click();
      await shot('chronicle');
      // the followed one leaves: the heirs are offered
      await page.evaluate((cid) => {
        const e = window.__eden;
        const alive = e.world.creatureMap.get(cid);
        const c = alive && alive.dying === 0 ? alive : e.world.creatures.find((x) => x.stage === 'adult' && x.children > 0 && x.dying === 0);
        e.follow(c.id);
        c.health = -1;
      }, id);
      await page.waitForTimeout(1500);
      await shot('follow-lost');
      const story = await page.evaluate((cid) => {
        const s = window.__eden.world.history.stories.get(cid);
        return s ? { events: s.events.length, descendants: s.descendants, living: s.living, depth: s.maxDepth } : null;
      }, id);
      console.log(`[${size}] watched story: ${JSON.stringify(story)}`);
    }
    if (errors.length) {
      failed = true;
      console.log(`[${size}] console errors:\n  ` + errors.slice(0, 10).join('\n  '));
    }
    await page.close();
  }
} finally {
  await browser.close();
  stopServer();
}
process.exit(failed ? 1 : 0);
