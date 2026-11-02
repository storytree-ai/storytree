// Takes the mock's stills from the built page (run build.mjs first) in the desktop capture kit's Chromium, at a 1440 x 900
// window. Each click is a real click at the mark's place on the page (read from the scene), and the panel's heading it
// opens is checked; shots.json records each click, what was laid (the layer's counts) and the page's errors.
// Run from the checkout root: node --import tsx docs/design/capability-tree-3d/a-stone/tools/shots.mjs [--retake]
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
  // The rest view frames itself on the plan as the map paints, so it is painted until it has.
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
  const keys = async (page, key, times) => { for (let k = 0; k < times; k++) { await page.keyboard.press(key); await settle(page, 2); } };

  const { page, errors } = await open('');
  report.layer = await page.evaluate(() => window.mock.layer.stats);
  await shot(page, 'resting');
  // The wrench on Cloud connection: the one open increment that names one of The library's capabilities today.
  await click(page, 'wrench', id('8 · Cloud connection (GCP)'), /^Work wanting 8 · Cloud connection/);
  await shot(page, 'wrench-arcs');
  // A link between neighbours is a gate in their shared wall: Rounds calls Lapsed questions.
  const gate = await page.evaluate(k => window.mock.layer.find('path', k), `${id('26 · Rounds')}->${id('25 · Lapsed questions')}`);
  assert.equal(gate?.kind, 'gate', 'Rounds and Lapsed questions are neighbours, so their link is a gate');
  await click(page, 'gate', gate.id, /^26 · Rounds calls 25 · Lapsed questions$/);
  await shot(page, 'gate');
  // A link whose ends cannot touch runs through a corridor: the first the layer lists.
  const [from, to] = report.layer.corridorLinks_[0].split(' -> ');
  const corridor = `${id(from)}->${id(to)}`;
  await click(page, 'path', corridor, new RegExp(`^${from.replace(/[()]/g, '.')} calls ${to.replace(/[()]/g, '.')}$`));
  await shot(page, 'pathway-contracts');
  await click(page, 'territory', id('4 · Work model'), /^4 · Work model$/);
  await shot(page, 'territory');
  await click(page, 'road', `${id('15 · Connection by address')}->${data.capabilities.find(c => c.title === '15 · Connection by address').dependsOn.find(d => d.story !== data.story.title).id}`, /calls Keys · /);
  await shot(page, 'road-off-the-coast');
  // Sample work: two made-up arcs wanting Work in flight, so one wrench lists more than one arc.
  await page.locator('.mock-check input').check();
  await settle(page, 4);
  await click(page, 'wrench', `${id('10 · Work in flight')}:sample`, /^Work wanting 10 · Work in flight/);
  await shot(page, 'sample-wrench-arcs');
  await page.locator('.mock-check input').uncheck();
  await click(page, 'territory', id('9 · Knowledge entrances'), /^9 · Knowledge entrances$/);
  // Close up, by the wheel over the corridor beside it, where gates and walls meet.
  const near = await page.evaluate(k => window.mock.layer.point('path', k), corridor);
  await page.mouse.move(near.x, near.y);
  for (let k = 0; k < 14; k++) { await page.mouse.wheel(0, -300); await settle(page, 2); }
  await shot(page, 'close-up');
  // Panned out to the whole island, by the wheel.
  for (let k = 0; k < 22; k++) { await page.mouse.wheel(0, 300); await settle(page, 2); }
  await shot(page, 'whole-island');
  await page.close();
  // Orbited: turned 45 degrees with E, and tipped two steps nearer level with F, by the map's own keys.
  const turned = await open('');
  await turned.page.mouse.click(300, 60);
  await keys(turned.page, 'e', 3);
  await keys(turned.page, 'f', 2);
  await shot(turned.page, 'orbited');
  // A second angle: turned the other way, from the south-west.
  await keys(turned.page, 'q', 8);
  await keys(turned.page, 'r', 1);
  await shot(turned.page, 'orbited-south-west');
  report.errors = [...errors, ...turned.errors];
  await turned.page.close();
  const real = await open('?real');
  await shot(real.page, 'real-today');
  report.realErrors = real.errors;
  await real.page.close();
  // The side by side: the map's island today, and the same island with only the mock's marks added.
  const pair = await browser.newPage({ viewport: { width: 1440, height: 500 }, deviceScaleFactor: 1 });
  const img = name => `data:image/png;base64,${readFileSync(path.join(out, `${name}.png`)).toString('base64')}`;
  // Both are the same window at the same framing; each is cropped to the map beside the panel and shown at half size.
  await pair.setContent(`<body style="margin:0;background:#0e1418;color:#e8eef0;font:600 15px system-ui;display:flex;gap:12px;padding:10px">
    ${[['real-today', 'The map today: The library selected'], ['resting', 'Round 3: the same cells, linked capabilities side by side, walled on their borders']].map(([n, t]) =>
      `<figure style="margin:0"><div style="width:702px;height:450px;overflow:hidden"><img src="${img(n)}" style="width:1440px;transform:scale(0.645);transform-origin:0 0"></div><figcaption style="padding-top:6px">${t}</figcaption></figure>`).join('')}</body>`);
  await pair.screenshot({ path: path.join(out, 'side-by-side.png') });
  await pair.close();
  writeFileSync(path.join(out, 'shots.json'), JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(report.errors, []);
});
