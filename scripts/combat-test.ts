/**
 * Combat verification: aims the player at a live enemy via the exposed
 * game handle, fires each weapon, and asserts that targeting locks,
 * damage lands, kills score, and waves progress.
 *
 * Run: bun run scripts/combat-test.ts
 */
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const server = await createServer({ root: process.cwd(), server: { port: 5198 } });
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
  if (msg.type() === 'error' && !msg.text().includes('404')) errors.push(`[console.error] ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));

await page.goto('http://localhost:5198', { waitUntil: 'networkidle0', timeout: 30000 });

// wait for wave 1 to spawn
await page.waitForFunction(
  () => (window as any).__NEBULA?.enemies?.length > 0,
  { timeout: 20000 }
);

const aimAtNearestEnemy = () =>
  page.evaluate(() => {
    const g = (window as any).__NEBULA;
    const enemies = g.enemies.filter((e: any) => e.alive);
    if (!enemies.length) return null;
    const p = g.player;
    // stay on the targeting computer's current pick so lock can build
    let nearest = g.targeting.target?.alive ? g.targeting.target : enemies[0];
    if (!g.targeting.target) {
      let best = Infinity;
      for (const e of enemies) {
        const d = e.position.distanceTo(p.position);
        if (d < best) { best = d; nearest = e; }
      }
    }
    // park 120m away from the target, stationary, nose on it
    const dir = nearest.position.clone().sub(p.position).normalize();
    p.group.position.copy(nearest.position.clone().addScaledVector(dir, -120));
    p.velocity.set(0, 0, 0);
    p.group.lookAt(nearest.position);
    p.group.rotateY(Math.PI); // ship forward is -Z
    return { id: nearest.id, hull: nearest.hull, shield: nearest.shield, dist: 120 };
  });

const snapshot = () =>
  page.evaluate(() => {
    const g = (window as any).__NEBULA;
    return {
      score: g.score,
      wave: g.wave,
      enemies: g.enemies.filter((e: any) => e.alive).length,
      lock: g.targeting.lockProgress,
      targetId: g.targeting.target?.id ?? null,
      playerHull: g.player.hull,
      playerAlive: g.player.alive,
      state: g.state,
    };
  });

let pass = true;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) pass = false;
};

// continuously re-aim (like a player tracking the target) for `ms`
const trackFor = async (ms: number) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await aimAtNearestEnemy();
    await new Promise((r) => setTimeout(r, 120));
  }
};

// --- 1. targeting acquires & lock builds while tracking ---
await aimAtNearestEnemy();
await new Promise((r) => setTimeout(r, 400));
let s = await snapshot();
check('targeting acquires a target', s.targetId !== null, `target #${s.targetId}`);

await trackFor(3200);
s = await snapshot();
check('lock stability builds to full', s.lock >= 0.99, `lock=${s.lock.toFixed(2)}`);

// --- 2. each weapon deals damage / kills score points ---
const before = await snapshot();
for (const key of ['Digit1', 'Digit2', 'Digit3', 'Digit4'] as const) {
  await page.keyboard.press(key);
  await page.keyboard.down('Space');
  await trackFor(2500);
  await page.keyboard.up('Space');
}
s = await snapshot();
check('weapons destroy enemies (score increased)', s.score > before.score, `score ${before.score} → ${s.score}`);

// --- 3. keep killing until the wave clears and the next one starts ---
await page.keyboard.press('Digit1'); // pulse laser for the cleanup
const startWave = s.wave;
const deadline = Date.now() + 120000;
await page.keyboard.down('Space');
while (Date.now() < deadline) {
  const cur = await snapshot();
  if (cur.wave > startWave) break;
  if (!cur.playerAlive) break;
  const aimed = await aimAtNearestEnemy();
  if (aimed) {
    await new Promise((r) => setTimeout(r, 120));
  } else {
    await new Promise((r) => setTimeout(r, 1000)); // intermission
  }
}
await page.keyboard.up('Space');
s = await snapshot();
check('wave clears and next wave spawns', s.wave > startWave, `wave ${startWave} → ${s.wave}, enemies=${s.enemies}`);
check('player survived combat test', s.playerAlive, `hull=${Math.round(s.playerHull)}`);

await page.screenshot({ path: 'scripts/shot-combat-test.png' });

check('no runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
await server.close();
console.log(pass ? 'COMBAT TEST PASSED' : 'COMBAT TEST FAILED');
process.exit(pass ? 0 : 1);
