// Takes the stills from the page as it opens from disk, in a 1440 x 900 window:
//   node docs/design/capability-tree-3d/c-cartographer/tools/shots.mjs [still]
// The gate, harbour and wrench stills are opened by a real mouse click at the mark's place on screen, and the panel's
// heading is checked, so a still cannot show a selection the page's own clicks would not make.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const out = (name) => resolve(here, '../stills', `${name}.png`);
const only = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(pathToFileURL(resolve(here, '../index.html')).href);
await page.waitForTimeout(300);
const reset = () => page.evaluate(() => { window.chart.select(null); window.chart.fit(); });
const heading = () => page.evaluate(() => document.querySelector('#panel h2')?.textContent);
const click = async (worldPoint) => { const [x, y] = await page.evaluate((p) => window.chart.toScreen(p), worldPoint); await page.mouse.click(x, y); };
const shot = async (name) => { if (only && only !== name) return; await page.waitForTimeout(120); await page.screenshot({ path: out(name) }); console.log('still', name, '|', await heading()); };
const frameAround = (ids, pad) => page.evaluate(([ids, pad]) => {
  const ps = ids.map((id) => window.chart.place(id));
  window.chart.frame(Math.min(...ps.map((p) => p.x - p.r)) - pad, Math.min(...ps.map((p) => p.y - p.r)) - pad, Math.max(...ps.map((p) => p.x + p.r)) + pad * 1.6, Math.max(...ps.map((p) => p.y + p.r)) + pad);
}, [ids, pad]);
const cap = (title) => page.evaluate((t) => window.chart.links().map((l) => [l.from, l.caller]).concat(window.chart.links().map((l) => [l.to, l.called])).find(([, n]) => n === t)[0], title);

// 1. At rest: the whole chart fitted beside the panel.
await reset(); await shot('resting');
// 2. The whole graph, zoomed out a step, sea and harbours included.
await reset(); await page.mouse.move(540, 450); await page.mouse.wheel(0, 220); await shot('whole-chart');
// 3. A close-up: the foundations, at a reading zoom.
await reset();
const data = await cap('3 · Data schema'), base = await cap('1 · Project libraries'), tx = await cap('2 · Library transactions'), cloud = await cap('8 · Cloud connection (GCP)');
await frameAround([data, base, tx, cloud], 60); await shot('close-up');
// 4. A gate's contracts open, its route lit: Library API's road down to Project libraries, clicked at its gate.
await reset();
const gateLink = await page.evaluate(() => window.chart.links().find((l) => l.caller === '7 · Library API' && l.called === '1 · Project libraries'));
await frameAround([base, await cap('7 · Library API')], 90);
await click(await page.evaluate((id) => window.chart.gate(id), gateLink.id));
await shot('gate');
// 5. Arrivals from other stories: The command line's harbour, its 14 roads lit, each to its own gate.
await reset();
const harbour = await page.evaluate(() => { const p = window.chart.place('in:' + window.DATA.arrivals.find((a) => a.story === 'The command line').storyId); return [p.x, p.y - 30]; });
await click(harbour); await shot('arrivals');
// 6. A wrench open: The library's commands, at its gate.
await reset();
const lc = await cap("17 · The library's commands");
await frameAround([lc, await cap('27 · Fixed data questions')], 80);
await page.click(`.wrench[data-id="${lc}"]`);
await shot('wrench');
// 7. A capability open: Work model's description and contracts.
await reset();
const wm = await cap('4 · Work model');
await frameAround([wm, await cap('10 · Work in flight'), await cap('6 · Knowledge artifacts')], 70);
await click(await page.evaluate((id) => { const p = window.chart.place(id); return [p.x, p.y + 10]; }, wm));
await shot('capability');
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
