// Takes the mock's stills from the built page (run build.mjs first) in the desktop capture kit's Chromium, at a 1440 x 900
// window. Each click is a real click at the mark's place on the page (read from the scene), and the panel's heading it
// opens is checked; shots.json records each click, what was laid (the layer's counts) and the page's errors.
// Run from the checkout root: node --import tsx docs/design/capability-tree-3d/d-overlay/tools/shots.mjs [--retake]
// Without --retake the stills go to the kit's scratch folder; with it, into stills/.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCapture } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.dirname(here);
const data = JSON.parse(readFileSync(path.join(dist, 'data.json'), 'utf8'));
const id = title => data.capabilities.find(c => c.title === title).id;
const VIEW = { width: 1440, height: 900 };
await withCapture({ folder: path.join(dist, 'stills'), dist }, async ({ browser, origin, out, settle }) => {
  const report = { clicks: [] };
  const open = async query => {
    const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 1, colorScheme: 'dark' });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.stack ?? e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${origin}/index.html${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 120000 }).catch(e => { console.error(errors); throw e; });
    for (let k = 0; k < 200 && !query.includes('real') && await page.evaluate(() => document.body.dataset.framed) !== 'yes'; k++) await settle(page, 3);
    await settle(page, 12);
    return { page, errors };
  };
  const shot = async (page, name) => { await settle(page, 8); await page.screenshot({ path: path.join(out, `${name}.png`) }); console.error(`took ${name}.png`); };
  /** Clicks the mark, and checks the panel's heading. */
  const click = async (page, kind, mark, heading) => {
    const at = await page.evaluate(([kind, mark]) => window.mock.layer.point(kind, mark), [kind, mark]);
    assert.ok(at, `no ${kind} ${mark} on the page`);
    await page.mouse.click(at.x, at.y);
    await settle(page, 4);
    const shown = (await page.locator('.mock-picked h3').first().textContent()).trim();
    report.clicks.push({ kind, mark, at: { x: Math.round(at.x), y: Math.round(at.y) }, heading: shown });
    console.error(`clicked ${kind} at ${Math.round(at.x)},${Math.round(at.y)}: ${shown}`);
    assert.match(shown, heading);
  };
  const wheel = async (page, at, clicks) => {
    await page.mouse.move(at.x, at.y);
    for (let k = 0; k < Math.abs(clicks); k++) { await page.mouse.wheel(0, clicks > 0 ? -300 : 300); await settle(page, 2); }
  };
  const keys = async (page, key, times) => { for (let k = 0; k < times; k++) { await page.keyboard.press(key); await settle(page, 2); } };
  const where = (page, kind, mark) => page.evaluate(([kind, mark]) => window.mock.layer.point(kind, mark), [kind, mark]);

  const { page, errors } = await open('');
  report.layer = await page.evaluate(() => window.mock.layer.stats);
  const lines = await page.evaluate(() => [...window.mock.layer.lines.values()]);
  await shot(page, 'resting');
  // A link inside the story: Library API calls Work model. Its line lights gold, Work model's contracts open.
  await click(page, 'line', `${id('7 · Library API')}->${id('4 · Work model')}`, /^7 · Library API calls 4 · Work model$/);
  await shot(page, 'line-contracts');
  // A territory: its description and contracts.
  await click(page, 'territory', id('10 · Work in flight'), /^10 · Work in flight$/);
  await shot(page, 'territory');
  // The wrench on Library API, the capability open work names that has the most entrances.
  await click(page, 'wrench', id('7 · Library API'), /^Work wanting 7 · Library API$/);
  await shot(page, 'wrench-open');
  // The landing where the road from the other islands comes ashore: one of its lines picked, then the landing close up.
  const fan = lines.filter(l => l.kind === 'arrival').sort((a, b) => b.links.length - a.links.length)[0];
  await click(page, 'line', fan.id, /links into 7 · Library API$/);
  await shot(page, 'arrival-line');
  await wheel(page, await where(page, 'landing', String(fan.dock)), 13);
  await shot(page, 'arrival-landing');
  await page.mouse.click(1000, 120);
  await wheel(page, { x: 540, y: 470 }, -13);
  // The road out: Connection by address calls Keys, its line running straight to the dock where the lane leaves.
  const leaving = lines.find(l => l.kind === 'out');
  await click(page, 'line', leaving.id, /calls Keys · /);
  await wheel(page, await where(page, 'dock', String(leaving.dock)), 11);
  await shot(page, 'road-out');
  await page.close();

  // A few entrance markers close up: where Project libraries, Library transactions and Library API meet, by the wheel.
  const near = await open('');
  await wheel(near.page, await where(near.page, 'mark', `${id('2 · Library transactions')}->${id('1 · Project libraries')}`), 15);
  await shot(near.page, 'close-up');
  // Zoomed out to the whole island and its neighbours' roads.
  await wheel(near.page, { x: 540, y: 470 }, -26);
  await shot(near.page, 'whole-island');
  report.errors = [...errors, ...near.errors];
  await near.page.close();
  // Orbited: turned with E and tipped one step nearer level with F, by the map's own keys.
  const turned = await open('');
  await turned.page.mouse.click(300, 120);
  await keys(turned.page, 'e', 3);
  await keys(turned.page, 'f', 1);
  await shot(turned.page, 'orbited');
  report.errors.push(...turned.errors);
  await turned.page.close();

  const real = await open('?real');
  await shot(real.page, 'real-today');
  report.realErrors = real.errors;
  await real.page.close();
  // The side by side: the map's island today, and the same island with the overlay.
  const pair = await browser.newPage({ viewport: { width: 1440, height: 500 }, deviceScaleFactor: 1 });
  const img = name => `data:image/png;base64,${readFileSync(path.join(out, `${name}.png`)).toString('base64')}`;
  await pair.setContent(`<body style="margin:0;background:#0e1418;color:#e8eef0;font:600 15px system-ui;display:flex;gap:12px;padding:10px">
    ${[['real-today', 'The map today: The library selected'], ['resting', 'Round 7: links as lines through the territories']].map(([n, t]) =>
      `<figure style="margin:0"><div style="width:702px;height:450px;overflow:hidden"><img src="${img(n)}" style="width:1440px;transform:scale(0.645) translate(-90px, -180px);transform-origin:0 0"></div><figcaption style="padding-top:6px">${t}</figcaption></figure>`).join('')}</body>`);
  await pair.screenshot({ path: path.join(out, 'side-by-side.png') });
  await pair.close();
  writeFileSync(path.join(out, 'shots.json'), JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(report.errors, []);
});
