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
  // A pathway: Rounds calls Lapsed questions, on a stretch of its own.
  await click(page, 'path', `${id('26 · Rounds')}->${id('25 · Lapsed questions')}`, /calls 25 · Lapsed questions$/);
  await shot(page, 'pathway-contracts');
  // A gate a link passes through directly: Waits calls Work in flight, or whichever direct link's gate the layer laid first.
  const gate = report.layer.gateList.find(g => g.between.includes('10 · Work in flight') && g.between.includes('11 · Waits'))
    ?? report.layer.gateList.find(g => data.capabilities.some(c => c.dependsOn.some(d => [c.id, d.id].sort().join('|') === g.key)));
  await click(page, 'gate', gate.key, /^Between /);
  await shot(page, 'gate');
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
  // Orbited: turned 45 degrees with E, and tipped two steps nearer level with F, by the map's own keys.
  await page.mouse.click(300, 60);
  await keys(page, 'e', 3);
  await keys(page, 'f', 2);
  await shot(page, 'orbited');
  // Close up, by the wheel over the middle of the island.
  await keys(page, 'r', 2); await keys(page, 'q', 3);
  await page.mouse.move(544, 470);
  for (let k = 0; k < 6; k++) { await page.mouse.wheel(0, -240); await settle(page, 2); }
  await shot(page, 'close-up');
  report.errors = errors;
  await page.close();
  const real = await open('?real');
  await shot(real.page, 'real-today');
  report.realErrors = real.errors;
  await real.page.close();
  // The side by side: the map's island today, and the same island with only the mock's marks added.
  const pair = await browser.newPage({ viewport: { width: 1440, height: 500 }, deviceScaleFactor: 1 });
  const img = name => `data:image/png;base64,${readFileSync(path.join(out, `${name}.png`)).toString('base64')}`;
  // Both are the same window at the same framing; each is cropped to the map beside the panel and shown at half size.
  await pair.setContent(`<body style="margin:0;background:#0e1418;color:#e8eef0;font:600 15px system-ui;display:flex;gap:12px;padding:10px">
    ${[['real-today', 'The map today: The library selected'], ['resting', 'Mock 1: the same island, with walls, gates, pathways and a wrench added']].map(([n, t]) =>
      `<figure style="margin:0"><div style="width:702px;height:450px;overflow:hidden"><img src="${img(n)}" style="width:1440px;transform:scale(0.645);transform-origin:0 -60px"></div><figcaption style="padding-top:6px">${t}</figcaption></figure>`).join('')}</body>`);
  await pair.screenshot({ path: path.join(out, 'side-by-side.png') });
  await pair.close();
  writeFileSync(path.join(out, 'shots.json'), JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(report.errors, []);
});
