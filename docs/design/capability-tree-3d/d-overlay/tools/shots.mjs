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
  const keys_ = async (page, key, times) => { for (let k = 0; k < times; k++) { await page.keyboard.press(key); await settle(page, 2); } };

  const wheel = async (page, at, clicks) => { await page.mouse.move(at.x, at.y); for (let k = 0; k < Math.abs(clicks); k++) { await page.mouse.wheel(0, clicks > 0 ? -300 : 300); await settle(page, 2); } };

  const { page, errors } = await open('');
  report.layer = await page.evaluate(() => window.mock.layer.stats);
  const info = await page.evaluate(() => ({ links: [...window.mock.layer.links.values()], arrivals: [...window.mock.layer.arrivals.values()] }));
  // 1. At rest: The library selected, as in Mick's screenshot.
  await shot(page, 'resting');
  // 2. A line's contracts open, the line lit in gold: Rounds calls Lapsed questions.
  await click(page, 'link', `${id('26 · Rounds')}->${id('25 · Lapsed questions')}`, /calls 25 · Lapsed questions$/);
  await shot(page, 'line-contracts');
  // 3. A wrench open: The library's commands, whose increment is under way.
  await click(page, 'wrench', id("17 · The library's commands"), /^Work wanting 17 · The library's commands/);
  await shot(page, 'wrench');
  // 4. The landing: the road from other stories comes ashore on open ground and fans out, one line per capability it serves.
  const landing = info.arrivals.find(a => a.kind === 'landing');
  await click(page, 'landing', landing.key, /^The road from \d+ stories$/);
  await shot(page, 'arrival-landing');
  const ashore = await page.evaluate(k => window.mock.layer.point('landing', k), landing.key);
  await wheel(page, ashore, 7);
  await shot(page, 'arrival-landing-close');
  await wheel(page, ashore, -7);
  // 5. One fan line off the landing: The MCP server's agent tools calling The library's commands.
  const fan = info.links.find(l => l.carries && l.to === id("17 · The library's commands"));
  await click(page, 'link', fan.key, /calls 17 · The library's commands$/);
  await shot(page, 'arrival-fan');
  // The direct landing: the one road that serves a single capability is the road out to Keys, from Connection by address.
  const leaving = info.links.find(l => l.carries && l.toStory === 'Keys');
  await click(page, 'link', leaving.key, /calls Keys · /);
  await shot(page, 'arrival-direct');
  // 6. Click a territory for its description and contracts.
  await click(page, 'territory', id('4 · Work model'), /^4 · Work model$/);
  await shot(page, 'territory');
  // 7. A few entrances close up: Data schema, the most called, by the wheel over it.
  const ds = await page.evaluate(i => window.mock.layer.point('territory', i), id('3 · Data schema'));
  await wheel(page, ds, 8);
  await shot(page, 'close-up');
  await wheel(page, ds, -8);
  // 8. The whole island among its neighbours, by the wheel.
  await wheel(page, { x: 540, y: 450 }, -6);
  await shot(page, 'whole-island');
  await page.close();
  // 9. A second angle: turned with E and tipped nearer level with F, by the map's own keys.
  const turned = await open('');
  await turned.page.mouse.click(300, 60);
  // Turned by a right-drag across the map (the map's own turn), then tipped nearer level with F.
  await turned.page.mouse.move(540, 600); await turned.page.mouse.down({ button: 'right' });
  await turned.page.mouse.move(380, 600, { steps: 16 }); await turned.page.mouse.up({ button: 'right' });
  await settle(turned.page, 6);
  await keys_(turned.page, 'f', 1);
  await shot(turned.page, 'orbited');
  report.errors = [...errors, ...turned.errors];
  await turned.page.close();
  // 10. The map today, The library selected, and the two side by side.
  const real = await open('?real');
  await shot(real.page, 'real-today');
  report.realErrors = real.errors;
  await real.page.close();
  const pair = await browser.newPage({ viewport: { width: 1440, height: 500 }, deviceScaleFactor: 1 });
  const img = name => `data:image/png;base64,${readFileSync(path.join(out, `${name}.png`)).toString('base64')}`;
  await pair.setContent(`<body style="margin:0;background:#0e1418;color:#e8eef0;font:600 15px system-ui;display:flex;gap:12px;padding:10px">
    ${[['real-today', 'The map today: The library selected'], ['resting', 'Round 7: the same view, links as lines through the territories']].map(([n, t]) =>
      `<figure style="margin:0"><div style="width:702px;height:450px;overflow:hidden"><img src="${img(n)}" style="width:1440px;transform:scale(0.645);transform-origin:0 0"></div><figcaption style="padding-top:6px">${t}</figcaption></figure>`).join('')}</body>`);
  await pair.screenshot({ path: path.join(out, 'side-by-side.png') });
  await pair.close();
  writeFileSync(path.join(out, 'shots.json'), JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(report.errors, []);
});
