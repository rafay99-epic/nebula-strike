/**
 * Headless smoke test: serves the built game, loads it in Chrome,
 * watches for console/page errors, simulates flying + shooting,
 * and saves screenshots for visual inspection.
 *
 * Run: bun run scripts/smoke.ts
 */
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const server = await createServer({ root: process.cwd(), server: { port: 5199 } });
await server.listen();

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=metal', '--enable-webgl', '--window-size=1280,800'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

const errors: string[] = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));

await page.goto('http://localhost:5199', { waitUntil: 'networkidle0', timeout: 30000 });

// let the game boot and run a couple of seconds
await new Promise((r) => setTimeout(r, 2500));

const hasCanvas = await page.evaluate(() => {
  const canvas = document.querySelector('#app canvas') as HTMLCanvasElement | null;
  if (!canvas) return 'NO CANVAS';
  const gl = canvas.getContext('webgl2');
  return `canvas ${canvas.width}x${canvas.height}`;
});
console.log('canvas check:', hasCanvas);

await page.screenshot({ path: 'scripts/shot-boot.png' });

// simulate gameplay: thrust + turn + fire for a few seconds
await page.keyboard.down('KeyW');
await page.keyboard.down('Space');
await new Promise((r) => setTimeout(r, 1800));
await page.keyboard.down('KeyA');
await new Promise((r) => setTimeout(r, 1200));
await page.keyboard.up('KeyA');
// switch weapons and keep firing
await page.keyboard.press('Digit2');
await new Promise((r) => setTimeout(r, 1200));
await page.keyboard.press('Digit3');
await new Promise((r) => setTimeout(r, 1200));
await page.keyboard.press('Digit4');
await new Promise((r) => setTimeout(r, 800));
await page.keyboard.press('KeyT');
await new Promise((r) => setTimeout(r, 1000));
await page.keyboard.up('Space');
await page.keyboard.up('KeyW');

await page.screenshot({ path: 'scripts/shot-combat.png' });

// wait until first wave is definitely active, fly a bit more
await new Promise((r) => setTimeout(r, 3000));
await page.screenshot({ path: 'scripts/shot-late.png' });

const hudState = await page.evaluate(() => ({
  wave: document.getElementById('wave-num')?.textContent,
  hostiles: document.getElementById('hostiles')?.textContent,
  score: document.getElementById('score')?.textContent,
  hull: document.getElementById('val-hull')?.textContent,
  energy: document.getElementById('val-energy')?.textContent,
  speed: document.getElementById('val-speed')?.textContent,
}));
console.log('HUD state:', JSON.stringify(hudState));

if (errors.length) {
  console.log('ERRORS DETECTED:');
  for (const e of [...new Set(errors)]) console.log(' ', e);
} else {
  console.log('no console/page errors ✓');
}

await browser.close();
await server.close();
process.exit(errors.length ? 1 : 0);
