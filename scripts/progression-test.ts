/**
 * Verifies the expansion systems: ship selection, flight-assist toggle,
 * music startup, sector clearing, jump-gate warp into sector 2,
 * planet survey bonuses, and the nav marker.
 *
 * Run: bun run scripts/progression-test.ts
 */
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const server = await createServer({ root: process.cwd(), server: { port: 5196 } });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=metal', '--enable-webgl', '--window-size=1280,800', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors: string[] = [];
page.on('pageerror', (err) => errors.push(err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !msg.text().includes('404')) errors.push(`[console] ${msg.text()}`);
});

await page.goto('http://localhost:5196', { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForFunction(() => (window as any).__NEBULA, { timeout: 20000 });

let pass = true;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) pass = false;
};

// --- ship selection: heavy gunboat ---
await page.evaluate(() => (window as any).__NEBULA.selectShip(2));
const ship = await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  return { name: g.player.def.name, hull: g.player.maxHull, state: g.state };
});
check('ship select applies the chosen hull', ship.name === 'HK-9 BASTION' && ship.hull === 160 && ship.state === 'playing',
  `${ship.name}, hull=${ship.hull}`);

// --- music starts on first interaction ---
await page.keyboard.press('KeyW');
await new Promise((r) => setTimeout(r, 600));
const musicOn = await page.evaluate(() => (window as any).__NEBULA.music.started);
check('ambient music engine starts', musicOn);

// --- flight assist toggle ---
await page.keyboard.press('KeyX');
await new Promise((r) => setTimeout(r, 300));
const assistOff = await page.evaluate(() => (window as any).__NEBULA.player.assist === false);
await page.keyboard.press('KeyX');
await new Promise((r) => setTimeout(r, 300));
const assistOn = await page.evaluate(() => (window as any).__NEBULA.player.assist === true);
check('flight assist toggles newtonian mode', assistOff && assistOn);

// --- nav cycle points at a planet ---
await page.keyboard.press('KeyN');
await new Promise((r) => setTimeout(r, 300));
const nav = await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  const marker = document.getElementById('nav-marker')!;
  return { idx: g.navIndex, visible: !marker.classList.contains('hidden') };
});
check('nav marker activates', nav.idx === 0 && nav.visible);

// --- clear all waves of sector 1 via the debug kill path ---
const deadline = Date.now() + 90000;
let gateUp = false;
while (Date.now() < deadline) {
  const st = await page.evaluate(() => {
    const g = (window as any).__NEBULA;
    return { enemies: g.enemies.filter((e: any) => e.alive).length, gate: !!g.gatePos, wave: g.wave };
  });
  if (st.gate) { gateUp = true; break; }
  if (st.enemies > 0) await page.evaluate(() => (window as any).__NEBULA.debugKillAll());
  await new Promise((r) => setTimeout(r, 500));
}
check('sector 1 clears and jump gate spawns', gateUp);

// --- fly into the gate → warp to sector 2 ---
await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  g.player.group.position.copy(g.gatePos);
});
await page.waitForFunction(() => (window as any).__NEBULA.state === 'warping', { timeout: 5000 }).catch(() => {});
const warped = await page
  .waitForFunction(() => {
    const g = (window as any).__NEBULA;
    return g.state === 'playing' && g.sectorIndex === 1;
  }, { timeout: 10000 })
  .then(() => true).catch(() => false);
const sectorInfo = await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  return {
    sector: g.sectorIndex,
    name: g.sector.name,
    label: document.getElementById('sector-label')?.textContent,
    planets: g.env.planets.length,
    asteroids: g.env.asteroids.length,
  };
});
check('warp lands in sector 2 with a rebuilt environment', warped && sectorInfo.planets > 0 && sectorInfo.asteroids > 50,
  `${sectorInfo.label}, planets=${sectorInfo.planets}, colliders=${sectorInfo.asteroids}`);

await page.screenshot({ path: 'scripts/shot-sector2.png' });

// --- planet survey ---
const survey = await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  const planet = g.env.planets[0];
  const before = g.score;
  // park just inside the survey radius
  const dir = planet.position.clone().normalize();
  g.player.group.position.copy(planet.position.clone().addScaledVector(dir, -(planet.visitRadius - 20)));
  g.player.velocity.set(0, 0, 0);
  return { before, name: planet.def.name };
});
await new Promise((r) => setTimeout(r, 800));
const surveyResult = await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  return { visited: g.env.planets[0].visited, score: g.score };
});
check('visiting a planet grants the survey bonus', surveyResult.visited && surveyResult.score >= survey.before + 500,
  `${survey.name}: score ${survey.before} → ${surveyResult.score}`);

await page.screenshot({ path: 'scripts/shot-planet.png' });

check('no runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
await server.close();
console.log(pass ? 'PROGRESSION TEST PASSED' : 'PROGRESSION TEST FAILED');
process.exit(pass ? 0 : 1);
