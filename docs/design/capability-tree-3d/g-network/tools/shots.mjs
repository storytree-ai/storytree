// Takes round 10's styled stills from the built page (run build.mjs first) in the desktop capture kit's Chromium, at a
// 1440 x 900 window. Each click is a real click where the mark stands on the page (read from the scene), and the panel's
// heading it opens is checked; shots.json records each click, what was laid (the layer's counts) and the page's errors.
// Run from the checkout root: node --import tsx docs/design/capability-tree-3d/g-network/tools/shots.mjs [--retake]
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
  /** Clicks the mark where it stands, and checks the panel's heading. */
  const click = async (page, kind, mark, heading) => {
    const at = await page.evaluate(([kind, mark]) => window.mock.layer.point(kind, mark), [kind, mark]);
    assert.ok(at, `no ${kind} ${mark} on the page`);
    await page.mouse.click(at.x, at.y);
    await settle(page, 4);
    const shown = (await page.locator('.mock-picked h3').first().textContent()).trim();
    report.clicks.push({ kind, mark, at: { x: Math.round(at.x), y: Math.round(at.y) }, heading: shown });
    console.error(`clicked ${kind} at ${Math.round(at.x)},${Math.round(at.y)}: ${shown}`);
    assert.match(shown, heading);
    return at;
  };
  const wheel = async (page, at, clicks) => { await page.mouse.move(at.x, at.y); for (let k = 0; k < Math.abs(clicks); k++) { await page.mouse.wheel(0, clicks > 0 ? -300 : 300); await settle(page, 2); } };

  const { page, errors } = await open('');
  report.layer = await page.evaluate(() => window.mock.layer.stats);
  const links = await page.evaluate(() => [...window.mock.layer.links.values()]);
  const title = c => data.capabilities.find(x => x.id === c)?.title;
  // 1. At rest: The library selected.
  await shot(page, 'resting');
  // 2. A gate's contracts open, its line lit: a link between neighbours, clicked on its entrance gate.
  const between = links.find(l => l.fromTitle === '11 · Waits' && l.toTitle === '10 · Work in flight') ?? links.find(l => l.dir === 'inside');
  const gateAt = await click(page, 'gate', between.key, new RegExp(`calls ${between.toTitle}$`));
  await shot(page, 'gate-contracts');
  // 3. Gates and entrances close up, around that gate.
  await wheel(page, gateAt, 8);
  await shot(page, 'gates-close');
  await wheel(page, gateAt, -8);
  // 4. A link lit along the shared roads: Library API's arrivals (the busiest), clicked on its own entrance gate; then a
  // link inside the story that travels shared road (the one sharing most of its way), clicked on its own gate too.
  const api = links.find(l => l.dir === 'down' && l.to === id('7 · Library API'));
  await click(page, 'gate', api.key, /calls 7 · Library API$/);
  await shot(page, 'link-lit');
  const roads = await page.evaluate(() => [...window.mock.layer.roads].map(([road, keys]) => ({ road, keys })));
  const sharing = links.filter(l => l.dir === 'inside').map(l => ({ l, n: roads.filter(r => r.keys.includes(l.key) && r.keys.length > 1).length })).sort((a, b) => b.n - a.n)[0].l;
  await click(page, 'gate', sharing.key, new RegExp(`calls ${sharing.toTitle.replace(/[()]/g, '\\$&')}$`));
  await shot(page, 'link-lit-inside');
  // 4a. The road that carries most, clicked: the panel lists the links it carries.
  const busiest = roads.reduce((a, b) => b.keys.length > a.keys.length ? b : a);
  await click(page, 'road', busiest.road, new RegExp(`^A road carrying ${busiest.keys.length} links$`));
  await shot(page, 'road-shared');
  // 4b. The mouth, close up: where the sea road comes ashore and the trunk branches inland.
  // Dragged to the middle of the map's side first (the map's own pan), then zoomed there; a fresh page after, at rest.
  const mouth = await page.evaluate(() => window.mock.layer.point('mouth', ''));
  await page.mouse.click(300, 60); await settle(page, 2);
  await page.mouse.move(mouth.x, mouth.y); await page.mouse.down(); await page.mouse.move(544, 450, { steps: 16 }); await page.mouse.up(); await settle(page, 6);
  await wheel(page, { x: 544, y: 450 }, 9);
  await shot(page, 'mouth-close');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 120000 });
  for (let k = 0; k < 200 && await page.evaluate(() => document.body.dataset.framed) !== 'yes'; k++) await settle(page, 3);
  await settle(page, 12);
  // 4c. The settlement where most links meet, close up, clicked for its territory.
  const town = report.layer.towns.reduce((a, b) => b.roads > a.roads ? b : a);
  const townAt = await click(page, 'town', id(town.capability), new RegExp(`^${town.capability.replace(/[()]/g, '\\$&')}$`));
  await wheel(page, townAt, 15);
  await shot(page, 'town-close');
  await wheel(page, townAt, -15);
  // 5. A wrench open.
  const wrenched = await page.evaluate(() => [...window.mock.layer.wrenches.keys()]);
  if (wrenched.length) { await click(page, 'wrench', wrenched[0], new RegExp(`^Work wanting ${title(wrenched[0]).replace(/[()]/g, '\\$&')}`)); await shot(page, 'wrench'); }
  // 6. Click a territory for its description and contracts.
  await click(page, 'territory', id('4 · Work model'), /^4 · Work model$/);
  await shot(page, 'territory');
  // 7. The whole island and its roads, by the wheel.
  await page.mouse.click(300, 60); await settle(page, 2);
  await wheel(page, { x: 540, y: 450 }, -5);
  await shot(page, 'whole-island');
  await page.close();
  // 8. A second angle: turned by a right-drag across the map (its own turn), then tipped nearer level with F.
  const turned = await open('');
  await turned.page.mouse.move(540, 600); await turned.page.mouse.down({ button: 'right' });
  await turned.page.mouse.move(360, 600, { steps: 16 }); await turned.page.mouse.up({ button: 'right' });
  await settle(turned.page, 6);
  for (let k = 0; k < 1; k++) { await turned.page.keyboard.press('f'); await settle(turned.page, 2); }
  await shot(turned.page, 'orbited');
  report.errors = [...errors, ...turned.errors];
  await turned.page.close();
  // 9. The map today, The library selected, nothing added; and the two side by side.
  const real = await open('?real&layout=today');
  await shot(real.page, 'real-today');
  report.realErrors = real.errors;
  await real.page.close();
  // Round 9's resting still beside round 10's, the map today first.
  const pair = await browser.newPage({ viewport: { width: 1440, height: 360 }, deviceScaleFactor: 1 });
  const img = file => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
  await pair.setContent(`<body style="margin:0;background:#0e1418;color:#e8eef0;font:600 14px system-ui;display:flex;gap:10px;padding:10px">
    ${[[path.join(out, 'real-today.png'), 'The map today'], [path.join(dist, '../f-roads/stills/resting.png'), 'Round 9: a road per link, a ring road round the coast'], [path.join(out, 'resting.png'), 'Round 10: one shared network, branching from the mouth']].map(([f, t]) =>
      `<figure style="margin:0"><div style="width:466px;height:310px;overflow:hidden"><img src="${img(f)}" style="width:1440px;transform:scale(0.43);transform-origin:-60px 0"></div><figcaption style="padding-top:6px">${t}</figcaption></figure>`).join('')}</body>`);
  await pair.screenshot({ path: path.join(out, 'side-by-side.png') });
  await pair.close();
  writeFileSync(path.join(out, 'shots.json'), JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(report.errors, []);
});
