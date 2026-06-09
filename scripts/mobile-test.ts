/**
 * Mobile support: emulates a phone (touch, coarse pointer, small viewport),
 * checks the touch UI appears, drives the virtual joystick + thrust/fire
 * buttons with synthetic pointer events, and verifies the ship responds.
 *
 * Run: bun run scripts/mobile-test.ts
 */
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const server = await createServer({ root: process.cwd(), server: { port: 5194 } });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=metal', '--enable-webgl', '--touch-events=enabled'],
});
const page = await browser.newPage();
// iPhone-ish: small landscape viewport with touch
await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const errors: string[] = [];
page.on('pageerror', (err) => errors.push(err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !msg.text().includes('404')) errors.push(`[console] ${msg.text()}`);
});

await page.goto('http://localhost:5194', { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForFunction(() => (window as any).__NEBULA, { timeout: 20000 });

let pass = true;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) pass = false;
};

// --- touch UI is active on coarse-pointer devices ---
const touchUi = await page.evaluate(() => {
  const ui = document.getElementById('touch-ui')!;
  return {
    enabled: !ui.classList.contains('hidden'),
    isTouchDetected: (window as any).__NEBULA.isTouch === true,
  };
});
check('touch UI enabled on mobile', touchUi.enabled && touchUi.isTouchDetected);

// --- pick a ship by tapping the card ---
await page.tap('#ship-0');
await page.waitForFunction(() => (window as any).__NEBULA.state === 'playing', { timeout: 5000 });
check('ship card tap starts the game', true);
await page.screenshot({ path: 'scripts/shot-mobile.png' });

// --- virtual joystick: synthetic pointer drag on the joystick zone ---
const quatBefore = await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  return [g.player.group.quaternion.x, g.player.group.quaternion.y, g.player.group.quaternion.z];
});
await page.evaluate(() => {
  const zone = document.getElementById('joy-zone')!;
  const opts = { bubbles: true, pointerId: 7, isPrimary: true, pointerType: 'touch' as const };
  zone.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: 150, clientY: 300 }));
  zone.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: 200, clientY: 260 }));
});
await new Promise((r) => setTimeout(r, 700));
await page.evaluate(() => {
  const zone = document.getElementById('joy-zone')!;
  zone.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, pointerType: 'touch' }));
});
const joyResult = await page.evaluate((before: number[]) => {
  const g = (window as any).__NEBULA;
  const q = g.player.group.quaternion;
  const delta = Math.abs(q.x - before[0]) + Math.abs(q.y - before[1]) + Math.abs(q.z - before[2]);
  return { delta, axesReset: g.input.vYaw === 0 && g.input.vPitch === 0 };
}, quatBefore);
check('virtual joystick steers the ship', joyResult.delta > 0.05 && joyResult.axesReset,
  `rotation delta=${joyResult.delta.toFixed(3)}`);

// --- thrust button moves the ship ---
const posBefore = await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  return g.player.position.length();
});
await page.evaluate(() => {
  document.getElementById('tb-thrust')!.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'touch' }));
});
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => {
  document.getElementById('tb-thrust')!.dispatchEvent(
    new PointerEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'touch' }));
});
const moved = await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  return g.player.position.length();
});
check('thrust button accelerates the ship', Math.abs(moved - posBefore) > 5,
  `moved ${Math.abs(moved - posBefore).toFixed(1)}m`);

// --- fire button spawns shots ---
await page.evaluate(() => {
  document.getElementById('tb-fire')!.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, pointerId: 11, pointerType: 'touch' }));
});
await new Promise((r) => setTimeout(r, 600));
const fired = await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  return g.weapons.shots.length > 0 || g.player.energy < g.player.maxEnergy - 1;
});
await page.evaluate(() => {
  document.getElementById('tb-fire')!.dispatchEvent(
    new PointerEvent('pointerup', { bubbles: true, pointerId: 11, pointerType: 'touch' }));
});
check('fire button shoots', fired);

// --- tap buttons reach the key path (nav cycle) ---
await page.evaluate(() => {
  document.getElementById('tb-nav')!.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, pointerId: 13, pointerType: 'touch' }));
});
await new Promise((r) => setTimeout(r, 400));
const navOn = await page.evaluate(() => (window as any).__NEBULA.navIndex === 0);
check('tap buttons trigger actions (nav)', navOn);

check('no runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
await server.close();
console.log(pass ? 'MOBILE TEST PASSED' : 'MOBILE TEST FAILED');
process.exit(pass ? 0 : 1);
