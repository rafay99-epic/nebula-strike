/**
 * Planetary gravity verification:
 *  - Jupiter-class: main drive CANNOT climb; afterburner CAN
 *  - the afterburner hint appears when the pilot fights a losing climb
 *  - Mars-class: main drive climbs easily (differentiated physics)
 *  - atmospheric entry starts as a real gravitational plunge
 *  - planets exert gravity wells on ships in open space
 *
 * Run: bun run scripts/gravity-test.ts
 */
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const server = await createServer({ root: process.cwd(), server: { port: 5191 } });
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

await page.goto('http://localhost:5191', { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForFunction(() => (window as any).__NEBULA, { timeout: 20000 });
await page.evaluate(() => (window as any).__NEBULA.selectShip(0)); // Striker: thrust 55
await page.waitForFunction(() => (window as any).__NEBULA.enemies?.length > 0, { timeout: 20000 });

let pass = true;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) pass = false;
};

// --- space gravity well: park near a gas giant, engines off, get pulled ---
const drift = await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  const gas = g.env.planets.find((p: any) => p.def.type === 'gas');
  const dir = gas.position.clone().normalize();
  g.player.group.position.copy(gas.position.clone().addScaledVector(dir, -(gas.visitRadius * 1.5)));
  g.player.velocity.set(0, 0, 0);
  return true;
});
await new Promise((r) => setTimeout(r, 1500));
const wellPull = await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  const gas = g.env.planets.find((p: any) => p.def.type === 'gas');
  const toPlanet = gas.position.clone().sub(g.player.position).normalize();
  return g.player.velocity.dot(toPlanet);
});
check('space gravity well pulls a drifting ship toward the planet', drift && wellPull > 3,
  `${wellPull.toFixed(1)} m/s toward planet after 1.5s`);

// --- atmospheric entry is a plunge ---
const entry = await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  const gas = g.env.planets.find((p: any) => p.def.type === 'gas');
  g.enterPlanet(gas);
  return { vy: g.player.velocity.y, alt: g.player.position.y };
});
check('entering a heavy world starts as a gravitational plunge', entry.vy < -40,
  `entry velocity ${entry.vy.toFixed(0)} m/s at ${entry.alt.toFixed(0)}m`);
await new Promise((r) => setTimeout(r, 2500)); // let the plunge play out

const phase = async (boost: boolean, seconds: number) => {
  await page.evaluate(() => {
    const g = (window as any).__NEBULA;
    g.player.group.position.set(0, 300, 0);
    g.player.velocity.set(0, 0, 0);
    g.player.group.rotation.set(Math.PI / 2, 0, 0); // nose straight up
  });
  await page.keyboard.down('KeyW');
  if (boost) await page.keyboard.down('ShiftLeft');
  await new Promise((r) => setTimeout(r, seconds * 1000));
  const out = await page.evaluate(() => {
    const g = (window as any).__NEBULA;
    return { vy: g.player.velocity.y, y: g.player.position.y, comms: document.getElementById('comms')?.textContent ?? '' };
  });
  await page.keyboard.up('KeyW');
  if (boost) await page.keyboard.up('ShiftLeft');
  return out;
};

// --- Jupiter-class: main drive loses to gravity ---
const mainDrive = await phase(false, 3.0);
check('Jupiter-class: main drive cannot climb out', mainDrive.vy < 2 && mainDrive.y <= 305,
  `vy=${mainDrive.vy.toFixed(1)} m/s, alt 300→${mainDrive.y.toFixed(0)}m at full thrust`);
check('afterburner hint appears while fighting a losing climb',
  /AFTERBURNER/i.test(mainDrive.comms), mainDrive.comms.slice(0, 60));

// --- Jupiter-class: afterburner wins ---
const burner = await phase(true, 3.0);
check('Jupiter-class: afterburner climbs out', burner.vy > 8 && burner.y > 330,
  `vy=${burner.vy.toFixed(1)} m/s, alt 300→${burner.y.toFixed(0)}m on afterburner`);

// leave the gas giant
await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  g.player.group.position.y = g.surface.ceiling + 50;
  g.player.velocity.set(0, 0, 0);
});
await new Promise((r) => setTimeout(r, 400));
await page.keyboard.press('KeyG');
await page.waitForFunction(() => (window as any).__NEBULA.mode === 'space', { timeout: 5000 });

// --- Mars-class: same input, completely different planet ---
await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  const mars = g.env.planets.find((p: any) => p.def.type === 'rock');
  g.enterPlanet(mars);
});
await new Promise((r) => setTimeout(r, 2000));
const mars = await phase(false, 2.5);
check('Mars-class: main drive climbs easily in 3.7 m/s² gravity', mars.vy > 15 && mars.y > 330,
  `vy=${mars.vy.toFixed(1)} m/s, alt 300→${mars.y.toFixed(0)}m`);

check('no runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
await server.close();
console.log(pass ? 'GRAVITY TEST PASSED' : 'GRAVITY TEST FAILED');
process.exit(pass ? 0 : 1);
