import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const server = await createServer({ root: process.cwd(), server: { port: 5192 } });
await server.listen();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--enable-webgl', '--window-size=1280,800'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5192', { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForFunction(() => (window as any).__NEBULA, { timeout: 20000 });
await page.evaluate(() => (window as any).__NEBULA.selectShip(0));
await page.waitForFunction(() => (window as any).__NEBULA.enemies?.length > 0, { timeout: 20000 });

// orbit shot: park near the terra planet in space
await page.evaluate(() => {
  const g = (window as any).__NEBULA;
  const terra = g.env.planets.find((p: any) => p.def.type === 'terra');
  const dir = terra.position.clone().normalize();
  g.player.group.position.copy(terra.position.clone().addScaledVector(dir, -(terra.def.radius * 2.6)));
  g.player.velocity.set(0, 0, 0);
  g.player.group.lookAt(terra.position);
  g.player.group.rotateY(Math.PI);
});
await new Promise((r) => setTimeout(r, 1600));
await page.screenshot({ path: 'scripts/shot-orbit-terra.png' });

for (const type of ['terra', 'rock', 'ice', 'lava', 'gas']) {
  await page.evaluate((t: string) => {
    const g = (window as any).__NEBULA;
    const planet = g.env.planets.find((p: any) => p.def.type === t);
    g.enterPlanet(planet);
  }, type);
  await new Promise((r) => setTimeout(r, 1800));
  // scenic vantage: cruise altitude looking across the terrain
  await page.evaluate(() => {
    const g = (window as any).__NEBULA;
    const s = g.surface;
    const y = s.def.type === 'gas' ? 160 : Math.max(s.floorAt(0, 380), s.floorAt(0, 0)) + 55;
    g.player.group.position.set(0, y, 380);
    g.player.velocity.set(0, 0, -10);
    g.player.group.quaternion.identity();
  });
  await new Promise((r) => setTimeout(r, 1600));
  await page.screenshot({ path: `scripts/shot-planet-${type}.png` });
  await page.evaluate(() => (window as any).__NEBULA.exitPlanet());
  await new Promise((r) => setTimeout(r, 600));
}
console.log(errors.length ? `ERRORS: ${[...new Set(errors)].join(' | ')}` : 'all planet types rendered, no errors');
await browser.close();
await server.close();
