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
