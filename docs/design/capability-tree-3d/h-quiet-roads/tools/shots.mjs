import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCapture } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.dirname(here);
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
    for (let k = 0; k < 200 && await page.evaluate(() => document.body.dataset.framed) !== 'yes'; k++) await settle(page, 3);
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
    return at;
  };
  const wheel = async (page, at, clicks) => { await page.mouse.move(at.x, at.y); for (let k = 0; k < Math.abs(clicks); k++) { await page.mouse.wheel(0, clicks > 0 ? -300 : 300); await settle(page, 2); } };
  const escape = s => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

  const { page, errors } = await open('');
  report.layer = await page.evaluate(() => window.mock.layer.stats);
  const links = await page.evaluate(() => [...window.mock.layer.links.values()]);
  await shot(page, 'resting');
  const flat = await open('?relief=0');
  await shot(flat.page, 'resting-flat');
  report.flatErrors = flat.errors;
  await flat.page.close();
  const mouth = await page.evaluate(() => window.mock.layer.point('mouth', ''));
  await page.mouse.move(mouth.x, mouth.y); await page.mouse.down(); await page.mouse.move(544, 450, { steps: 16 }); await page.mouse.up(); await settle(page, 6);
  await wheel(page, { x: 544, y: 450 }, 11);
  await shot(page, 'mouth-close');
  await page.close();
  const lit = await open('');
  const between = links.find(l => l.fromTitle === '11 · Waits' && l.toTitle === '10 · Work in flight') ?? links.find(l => l.dir === 'inside');
  const gateAt = await click(lit.page, 'gate', between.key, new RegExp(`calls ${escape(between.toTitle)}$`));
  await wheel(lit.page, gateAt, 12);
  await shot(lit.page, 'gate-close');
  await wheel(lit.page, gateAt, -12);
  const api = links.find(l => l.dir === 'down' && l.toTitle === '7 · Library API');
  await click(lit.page, 'gate', api.key, /calls 7 · Library API$/);
  await shot(lit.page, 'link-lit');
  const roads = await lit.page.evaluate(() => [...window.mock.layer.roads].map(([road, keys]) => ({ road, keys })));
  const sharing = links.filter(l => l.dir === 'inside').map(l => ({ l, n: roads.filter(r => r.keys.includes(l.key) && r.keys.length > 1).length })).sort((a, b) => b.n - a.n)[0].l;
  await click(lit.page, 'gate', sharing.key, new RegExp(`calls ${escape(sharing.toTitle)}$`));
  await shot(lit.page, 'link-lit-inside');
  await lit.page.close();
  const turned = await open('');
  await turned.page.mouse.move(540, 600); await turned.page.mouse.down({ button: 'right' });
  await turned.page.mouse.move(360, 600, { steps: 16 }); await turned.page.mouse.up({ button: 'right' });
  await settle(turned.page, 6);
  for (let k = 0; k < 2; k++) { await turned.page.keyboard.press('f'); await settle(turned.page, 2); }
  await shot(turned.page, 'orbited');
  await wheel(turned.page, { x: 544, y: 450 }, 8);
  await shot(turned.page, 'orbited-close');
  report.errors = [...errors, ...lit.errors, ...turned.errors];
  await turned.page.close();
  const pair = await browser.newPage({ viewport: { width: 1440, height: 360 }, deviceScaleFactor: 1 });
  const img = file => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
  await pair.setContent(`<body style="margin:0;background:#0e1418;color:#e8eef0;font:600 14px system-ui;display:flex;gap:10px;padding:10px">
    ${[[path.join(dist, '../g-network/stills/resting.png'), 'Round 10: shared roads, a coast band'], [path.join(out, 'resting-flat.png'), 'Round 11, flat: sandy track, open land only at the mouth'], [path.join(out, 'resting.png'), 'Round 11: with the relief']].map(([f, t]) =>
      `<figure style="margin:0"><div style="width:466px;height:310px;overflow:hidden"><img src="${img(f)}" style="width:1440px;transform:scale(0.43);transform-origin:-60px 0"></div><figcaption style="padding-top:6px">${t}</figcaption></figure>`).join('')}</body>`);
  await pair.screenshot({ path: path.join(out, 'side-by-side.png') });
  await pair.close();
  writeFileSync(path.join(out, 'shots.json'), JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.flatErrors, []);
});
