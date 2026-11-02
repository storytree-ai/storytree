// Takes the stills from the built page, opened from disk, through the map's own controls: a right-drag orbits (the map's
// spin and tilt), clicks open the mock's panel. Run from the checkout root after build.mjs:
//   node --import tsx docs/design/capability-tree-3d/b-timber/tools/capture.mjs
// (set CAPTURE_CHROMIUM to a Chromium binary if Playwright's own is not installed, as the capture kit reads it).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from '../../../../../apps/desktop/src/capture/launch.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const folder = path.resolve(here, '..');
const stills = path.join(folder, 'stills');
mkdirSync(stills, { recursive: true });
const page0 = pathToFileURL(path.join(folder, 'index.html')).href;
const browser = await launch();
const errors = [];
const settle = (page) => page.waitForTimeout(1500);

async function open(size, query = '') {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1, colorScheme: 'dark' });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(page0 + query);
  await page.waitForFunction(() => document.body.dataset.timber === 'ready', undefined, { timeout: 90000 });
  await page.waitForTimeout(4000);
  return page;
}
/** Where a mock object (by name, or a track's middle point) is on screen. */
const onScreen = (page, name, mid = false) => page.evaluate(({ name, mid }) => {
  const { scene, camera, gl } = window.__globe;
  const o = scene.getObjectByName(name);
  const V = camera.position.constructor;
  const local = mid ? o.userData.points[Math.floor(o.userData.points.length / 2)].clone() : new V(0, 3, 0);
  const world = o.localToWorld(local.clone ? local : new V(local.x, local.y, local.z)).project(camera);
  const box = gl.domElement.getBoundingClientRect();
  return { x: box.left + ((world.x + 1) / 2) * box.width, y: box.top + ((1 - world.y) / 2) * box.height };
}, { name, mid });
const click = async (page, at) => { await page.evaluate(() => { const p = document.querySelector('.timber-panel'); if (p) p.hidden = true; }); await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.up(); await settle(page); };

const wide = { width: 1440, height: 960 };
const page = await open(wide);
const summary = await page.evaluate(() => window.__timber);
await page.screenshot({ path: path.join(stills, 'resting.png') });
const mockShot = await page.screenshot();

// A wrench's arc list.
const wrench = await page.evaluate(() => { let n; window.__globe.scene.traverse((o) => { if (o.name.startsWith('wrench:')) n = o.name; }); return n; });
await click(page, await onScreen(page, wrench));
const wrenchPanel = await page.locator('.timber-panel').innerText();
await page.screenshot({ path: path.join(stills, 'wrench-arcs.png') });

// A pathway's contracts: the middle of a track between two touching fields, where no other track runs.
const track = await page.evaluate(() => {
  const { scene } = window.__globe; const tracks = [];
  scene.traverse((o) => { if (o.userData.kind === 'track' && o.userData.route.length === 2) tracks.push(o.name); });
  return tracks;
});
let pathwayPanel = '';
for (const name of track) {
  await click(page, await onScreen(page, name, true));
  pathwayPanel = await page.locator('.timber-panel').innerText().catch(() => '');
  if (/\nPATHWAY\n/i.test(pathwayPanel)) break;
}
await page.screenshot({ path: path.join(stills, 'pathway-contracts.png') });

// A gate's contracts, a territory's description and contracts, and the road off the coast.
// The busiest gate that holds no wrench, so the click lands on the gate itself.
const gate = await page.evaluate(() => {
  const { scene } = window.__globe; const wrenches = []; const gates = [];
  scene.traverse((o) => { if (o.userData.kind === 'wrench') wrenches.push(o.position); if (o.userData.kind === 'gate') gates.push(o); });
  return gates.filter((g) => wrenches.every((w) => Math.hypot(w.x - g.position.x, w.z - g.position.z) > 45))
    .sort((a, b) => b.userData.links.length - a.userData.links.length)[0].name;
});
const gateAt = await onScreen(page, gate);
await click(page, gateAt);
const gatePanel = await page.locator('.timber-panel').innerText();
await page.screenshot({ path: path.join(stills, 'gate-contracts.png') });
await click(page, await page.evaluate(() => {
  document.querySelector('.timber-panel').hidden = true;
  const r = document.querySelector('.timber-label.road-out').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}));
const roadPanel = await page.locator('.timber-panel').innerText();
await page.screenshot({ path: path.join(stills, 'road-contracts.png') });
const field = await page.evaluate(() => {
  const { scene, camera, gl } = window.__globe; const V = camera.position.constructor;
  const t = scene.getObjectByName('territory:capability_5e0362aae607'); const g = t.geometry.getAttribute('position');
  const c = new V(g.getX(0) + g.getX(1) + g.getX(2), 0, g.getZ(0) + g.getZ(1) + g.getZ(2)).divideScalar(3);
  const w = t.localToWorld(c).project(camera); const box = gl.domElement.getBoundingClientRect();
  return { x: box.left + ((w.x + 1) / 2) * box.width, y: box.top + ((1 - w.y) / 2) * box.height };
});
await click(page, field);
const fieldPanel = await page.locator('.timber-panel').innerText();
await page.screenshot({ path: path.join(stills, 'territory.png') });
await page.locator('.timber-close').click();

// Orbited: the map's own right-drag spins and tilts the sheet; then a wheel step zooms in.
const mid = { x: wide.width / 2, y: wide.height / 2 };
await page.mouse.move(mid.x, mid.y);
await page.mouse.down({ button: 'right' });
for (let i = 1; i <= 20; i++) await page.mouse.move(mid.x + i * 16, mid.y - i * 3);
await page.mouse.up({ button: 'right' });
await settle(page);
await page.screenshot({ path: path.join(stills, 'orbited.png') });
await page.mouse.wheel(0, -400);
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(stills, 'orbited-zoomed.png') });
await page.close();

// The resting view at the story panel's size (30rem wide).
const panel = await open({ width: 480, height: 900 });
// The map frames a narrow window off to one side: a plain drag (the map's own pan) brings the island to the middle.
const island = await panel.evaluate(() => {
  const { scene, camera, gl } = window.__globe; const V = camera.position.constructor;
  const w = scene.getObjectByName('territory-land').localToWorld(new V()).project(camera); const box = gl.domElement.getBoundingClientRect();
  return { x: box.left + ((w.x + 1) / 2) * box.width, y: box.top + ((1 - w.y) / 2) * box.height };
});
await panel.mouse.move(island.x, island.y);
await panel.mouse.down();
for (let i = 1; i <= 15; i++) await panel.mouse.move(island.x + ((240 - island.x) * i) / 15, island.y + ((450 - island.y) * i) / 15);
await panel.mouse.up();
await settle(panel);
await panel.screenshot({ path: path.join(stills, 'resting-panel.png') });
await panel.close();

// The real map's island today beside the mock, at the same size and framing.
const real = await open(wide, '?real');
const realShot = await real.screenshot();
await real.close();
const pair = await browser.newPage({ viewport: { width: 2 * 1440 + 24, height: 960 + 56 } });
const img = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
await pair.setContent(`<body style="margin:0;background:#101418;color:#e7e8ea;font:600 20px system-ui;display:grid;grid-template-columns:1440px 1440px;gap:24px">
  <div><div style="padding:14px 18px">The map today: the real story-node island, as drawn (index.html?real)</div><img src="${img(realShot)}"></div>
  <div><div style="padding:14px 18px">Mock B: the same island with timber fences, farm gates, tracks, roads and a wrench</div><img src="${img(mockShot)}"></div></body>`);
await pair.screenshot({ path: path.join(stills, 'side-by-side.png') });
await browser.close();

writeFileSync(path.join(here, 'capture-report.json'), JSON.stringify({ summary, panels: { wrench: wrenchPanel, pathway: pathwayPanel, gate: gatePanel, road: roadPanel, territory: fieldPanel }, errors }, null, 2) + '\n');
if (errors.length > 0) { console.error(errors); process.exit(1); }
console.log(JSON.stringify(summary));
