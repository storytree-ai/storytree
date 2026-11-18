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

  const { page, errors } = await open('');
  report.layer = await page.evaluate(() => window.mock.layer.stats);
  const info = await page.evaluate(() => ({ gates: [...window.mock.layer.gates.values()], links: [...window.mock.layer.links.values()], roads: window.mock.layer.roads }));
  await shot(page, 'resting');
  await click(page, 'wrench', id('8 · Cloud connection (GCP)'), /^Work wanting 8 · Cloud connection/);
  await shot(page, 'wrench-arcs');
  const from = key => info.links.find(l => l.key === key);
  const gate = info.gates.find(g => g.town === id('10 · Work in flight') && from(g.key).fromStory === data.story.title);
  await click(page, 'gate', gate.key, /^Into 10 · Work in flight from /);
  await shot(page, 'gate');
  await click(page, 'link', `${id('26 · Rounds')}->${id('25 · Lapsed questions')}`, /calls 25 · Lapsed questions$/);
  await shot(page, 'pathway-contracts');
  await click(page, 'territory', id('4 · Work model'), /^4 · Work model$/);
  await shot(page, 'territory');
  const keys = info.links.find(l => l.toStory === 'Keys');
  await click(page, 'link', keys.key, /calls Keys · /);
  await shot(page, 'road-off-the-coast');
  const trunk = [...info.roads].sort((a, b) => b.links.length - a.links.length)[0];
  await click(page, 'road', trunk.id, /links along this road$/);
  await shot(page, 'road-arriving');
  await page.locator('.mock-check input').check();
  await settle(page, 4);
  await click(page, 'wrench', `${id('10 · Work in flight')}:sample`, /^Work wanting 10 · Work in flight/);
  await shot(page, 'sample-wrench-arcs');
  await page.locator('.mock-check input').uncheck();
  const zoom = async (title, clicks) => {
    const at = await page.evaluate(i => window.mock.layer.point('territory', i), id(title));
    await page.mouse.move(at.x, at.y);
    for (let k = 0; k < clicks; k++) { await page.mouse.wheel(0, clicks > 0 ? -300 : 300); await settle(page, 2); }
  };
  await click(page, 'territory', id('3 · Data schema'), /^3 · Data schema$/);
  await zoom('3 · Data schema', 8);
  await shot(page, 'close-up');
  for (let k = 0; k < 8; k++) { await page.mouse.wheel(0, 300); await settle(page, 2); }
  const small = info.gates.find(g => g.town === id('7 · Library API') && from(g.key).fromStory !== data.story.title);
  await click(page, 'gate', small.key, /^Into 7 · Library API from /);
  const gap = await page.evaluate(k => window.mock.layer.point('gate', k), small.key);
  await page.mouse.move(gap.x, gap.y);
  for (let k = 0; k < 12; k++) { await page.mouse.wheel(0, -300); await settle(page, 2); }
  await shot(page, 'gaps');
  for (let k = 0; k < 4; k++) { await page.mouse.wheel(0, 300); await settle(page, 2); }
  for (let k = 0; k < 14; k++) { await page.mouse.wheel(0, 300); await settle(page, 2); }
  await shot(page, 'whole-island');
  await page.close();
  const turned = await open('');
  await turned.page.mouse.click(300, 60);
  await keys_(turned.page, 'e', 3);
  await keys_(turned.page, 'f', 2);
  await shot(turned.page, 'orbited');
  await keys_(turned.page, 'q', 8);
  await keys_(turned.page, 'r', 1);
  await shot(turned.page, 'orbited-south-west');
  report.errors = [...errors, ...turned.errors];
  await turned.page.close();
  const real = await open('?real');
  await shot(real.page, 'real-today');
  report.realErrors = real.errors;
  await real.page.close();
  const pair = await browser.newPage({ viewport: { width: 1440, height: 500 }, deviceScaleFactor: 1 });
  const img = name => `data:image/png;base64,${readFileSync(path.join(out, `${name}.png`)).toString('base64')}`;
  await pair.setContent(`<body style="margin:0;background:#0e1418;color:#e8eef0;font:600 15px system-ui;display:flex;gap:12px;padding:10px">
    ${[['real-today', 'The map today: The library selected'], ['resting', 'Round 6A: layers by dependency, patches in open land, a gap for each gate']].map(([n, t]) =>
      `<figure style="margin:0"><div style="width:702px;height:450px;overflow:hidden"><img src="${img(n)}" style="width:1440px;transform:scale(0.645);transform-origin:0 0"></div><figcaption style="padding-top:6px">${t}</figcaption></figure>`).join('')}</body>`);
  await pair.screenshot({ path: path.join(out, 'side-by-side.png') });
  await pair.close();
  writeFileSync(path.join(out, 'shots.json'), JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(report.errors, []);
});
