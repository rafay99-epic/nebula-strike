/**
 * Planet surface round-trip: enter prompt near a planet, G to land,
 * terrain/crystals/sky exist, collect a crystal, climb past the ceiling,
 * G to return to space with wave + sector state intact.
 *
 * Run: bun run scripts/surface-test.ts
 */
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const server = await createServer({ root: process.cwd(), server: { port: 5195 } });
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
page.on('console', (msg) => {
  if (msg.type() === 'error' && !msg.text().includes('404')) errors.push(`[console] ${msg.text()}`);
});

await page.goto('http://localhost:5195', { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForFunction(() => (window as any).__NEBULA, { timeout: 20000 });
await page.evaluate(() => (window as any).__NEBULA.selectShip(0));
await page.waitForFunction(() => (window as any).__NEBULA?.enemies?.length > 0, { timeout: 20000 });

let pass = true;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) pass = false;
};

// remember the space combat state we must come back to
const before = await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  return { wave: g.wave, sector: g.sectorIndex, enemies: g.enemies.length, planets: g.env.planets.length };
});
check('sector has 5-6 visitable planets', before.planets >= 5, `${before.planets} planets`);

// --- approach a planet: prompt appears ---
await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  const planet = g.env.planets[0];
  const dir = planet.position.clone().normalize();
  g.player.group.position.copy(planet.position.clone().addScaledVector(dir, -(planet.visitRadius - 30)));
  g.player.velocity.set(0, 0, 0);
});
await new Promise((r) => setTimeout(r, 500));
const prompt = await page.evaluate(() => {
  const el = document.getElementById('planet-prompt')!;
  return { visible: !el.classList.contains('hidden'), text: el.textContent };
});
check('enter prompt appears near a planet', prompt.visible && /ENTER/.test(prompt.text ?? ''), prompt.text ?? '');

// --- press G → land ---
await page.keyboard.press('KeyG');
await page.waitForFunction(() => (window as any).__NEBULA.mode === 'surface', { timeout: 5000 });
await new Promise((r) => setTimeout(r, 1500)); // let it render a bit
const surf = await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  let meshes = 0;
  g.surface.scene.traverse((o: any) => { if (o.isMesh) meshes++; });
  return {
    planet: g.surface.def.name,
    type: g.surface.def.type,
    meshes,
    crystals: g.surface.crystals.length,
    hasFog: !!g.surface.scene.fog,
    hasSky: !!g.surface.scene.background,
    altOk: g.player.position.y > 0,
  };
});
check('surface world builds (terrain, sky, fog, crystals)',
  surf.meshes > 30 && surf.crystals === 12 && surf.hasFog && surf.hasSky && surf.altOk,
  `${surf.planet} (${surf.type}): ${surf.meshes} meshes, ${surf.crystals} crystals`);

await page.screenshot({ path: 'scripts/shot-surface.png' });

// --- collect a crystal ---
const collected = await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  const c = g.surface.crystals[0];
  g.player.group.position.copy(c.mesh.position);
  return g.score;
});
await new Promise((r) => setTimeout(r, 500));
const afterCrystal = await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  return { taken: g.surface.crystals[0].taken, score: g.score };
});
check('crystal collection scores points', afterCrystal.taken && afterCrystal.score > collected,
  `score ${collected} → ${afterCrystal.score}`);

// --- terrain glide: push the ship underground, it should be held above ---
await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  g.player.group.position.set(100, -500, 100);
  g.player.velocity.set(0, -50, 0);
});
await new Promise((r) => setTimeout(r, 400));
const aboveGround = await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  const f = g.surface.floorAt(g.player.position.x, g.player.position.z);
  return g.player.position.y >= f + 4;
});
check('terrain collision keeps the ship above ground', aboveGround);

// --- climb past the ceiling → leave prompt → G → back to space ---
await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  g.player.group.position.y = g.surface.ceiling + 40;
  g.player.velocity.set(0, 0, 0);
});
await new Promise((r) => setTimeout(r, 400));
const leavePrompt = await page.evaluate(() => {
  const el = document.getElementById('planet-prompt')!;
  return { visible: !el.classList.contains('hidden'), text: el.textContent };
});
check('leave prompt appears above the ceiling', leavePrompt.visible && /LEAVE/.test(leavePrompt.text ?? ''), leavePrompt.text ?? '');

await page.keyboard.press('KeyG');
await page.waitForFunction(() => (window as any).__NEBULA.mode === 'space', { timeout: 5000 });
await new Promise((r) => setTimeout(r, 500));
const after = await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  return {
    mode: g.mode,
    state: g.state,
    wave: g.wave,
    sector: g.sectorIndex,
    enemies: g.enemies.length,
    surfaceGone: g.surface === null,
    inSpaceScene: g.player.group.parent === g.scene,
  };
});
check('return to space preserves wave/sector/enemies',
  after.state === 'playing' && after.wave === before.wave && after.sector === before.sector
  && after.enemies === before.enemies && after.surfaceGone && after.inSpaceScene,
  `wave ${before.wave}→${after.wave}, enemies ${before.enemies}→${after.enemies}`);

check('no runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
await server.close();
console.log(pass ? 'SURFACE TEST PASSED' : 'SURFACE TEST FAILED');
process.exit(pass ? 0 : 1);
