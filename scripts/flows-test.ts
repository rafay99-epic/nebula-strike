/**
 * Verifies missile homing at full lock, pause, and the game-over flow.
 * Run: bun run scripts/flows-test.ts
 */
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const server = await createServer({ root: process.cwd(), server: { port: 5197 } });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=metal', '--enable-webgl', '--window-size=1280,800'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors: string[] = [];
page.on('pageerror', (err) => errors.push(err.message));

await page.goto('http://localhost:5197', { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForFunction(() => (window as any).__NEBULA?.enemies?.length > 0, { timeout: 20000 });

let pass = true;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) pass = false;
};

// --- missile homing: full lock, fire once, missile should chase and hit ---
const aim = () =>
  page.evaluate(() => {
    const g = (window as any).__NEBULA;
    const t = g.targeting.target?.alive
      ? g.targeting.target
      : g.enemies.find((e: any) => e.alive);
    if (!t) return null;
    const p = g.player;
    const dir = t.position.clone().sub(p.position).normalize();
    p.group.position.copy(t.position.clone().addScaledVector(dir, -150));
    p.velocity.set(0, 0, 0);
    p.group.lookAt(t.position);
    p.group.rotateY(Math.PI);
    return { id: t.id, hull: t.hull, shield: t.shield };
  });

// build full lock on one target
let tracked = await aim();
const lockUntil = Date.now() + 6000;
while (Date.now() < lockUntil) {
  await aim();
  const lock = await page.evaluate(() => (window as any).__NEBULA.targeting.lockProgress);
  if (lock >= 1) break;
  await new Promise((r) => setTimeout(r, 120));
}
const lock = await page.evaluate(() => (window as any).__NEBULA.targeting.lockProgress);
check('full lock acquired for missile test', lock >= 1, `lock=${lock.toFixed(2)}`);

// fire ONE missile, then deliberately turn 60° away — homing must do the work
await page.keyboard.press('Digit3');
await page.keyboard.down('Space');
await new Promise((r) => setTimeout(r, 150));
await page.keyboard.up('Space');
await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  g.player.group.rotateY(1.0); // look away so straight flight would miss
});
const before = tracked;
await new Promise((r) => setTimeout(r, 4000));
const after = await page.evaluate((id: number) => {
  const g = (window as any).__NEBULA;
  const t = g.enemies.find((e: any) => e.id === id);
  return t ? { alive: t.alive, hull: t.hull, shield: t.shield } : { alive: false, hull: 0, shield: 0 };
}, before!.id);
const damaged = !after.alive || after.hull < before!.hull || after.shield < before!.shield;
check('locked missile homes in and damages target', damaged,
  `target #${before!.id}: hull ${before!.hull}→${after.hull}, shield ${before!.shield}→${after.shield}, alive=${after.alive}`);

// --- pause ---
await page.keyboard.press('KeyP');
await new Promise((r) => setTimeout(r, 300)); // let the frame loop process the key
const paused = await page.evaluate(() => ({
  state: (window as any).__NEBULA.state,
  overlay: !document.getElementById('pause-overlay')!.classList.contains('hidden'),
}));
check('pause halts the game and shows overlay', paused.state === 'paused' && paused.overlay);
await page.keyboard.press('KeyP');
await new Promise((r) => setTimeout(r, 300));

// --- game over ---
await page.evaluate(() => (window as any).__NEBULA.player.takeDamage(10000));
await new Promise((r) => setTimeout(r, 600));
const go = await page.evaluate(() => ({
  state: (window as any).__NEBULA.state,
  overlay: !document.getElementById('gameover-overlay')!.classList.contains('hidden'),
  text: document.getElementById('go-score')?.textContent ?? '',
}));
check('game over triggers with overlay + final score', go.state === 'gameover' && go.overlay, go.text);

await page.screenshot({ path: 'scripts/shot-gameover.png' });
check('no runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
await server.close();
console.log(pass ? 'FLOWS TEST PASSED' : 'FLOWS TEST FAILED');
process.exit(pass ? 0 : 1);
