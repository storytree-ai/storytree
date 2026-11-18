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
    return at;
  };
  const wheel = async (page, at, clicks) => { await page.mouse.move(at.x, at.y); for (let k = 0; k < Math.abs(clicks); k++) { await page.mouse.wheel(0, clicks > 0 ? -300 : 300); await settle(page, 2); } };

  const { page, errors } = await open('');
  report.layer = await page.evaluate(() => window.mock.layer.stats);
  const links = await page.evaluate(() => [...window.mock.layer.links.values()]);
  const title = c => data.capabilities.find(x => x.id === c)?.title;
  await shot(page, 'resting');
  const between = links.find(l => l.fromTitle === '11 · Waits' && l.toTitle === '10 · Work in flight') ?? links.find(l => l.dir === 'inside');
  const gateAt = await click(page, 'gate', between.key, new RegExp(`calls ${between.toTitle}$`));
  await shot(page, 'gate-contracts');
  await wheel(page, gateAt, 8);
  await shot(page, 'gates-close');
  await wheel(page, gateAt, -8);
  const api = links.find(l => l.dir === 'down' && l.to === id('7 · Library API'));
  const landing = await click(page, 'gate', api.key, /calls 7 · Library API$/);
  await shot(page, 'arrival-landing');
  await wheel(page, landing, 7);
  await shot(page, 'arrival-landing-close');
  await wheel(page, landing, -7);
  const wrenched = await page.evaluate(() => [...window.mock.layer.wrenches.keys()]);
  if (wrenched.length) { await click(page, 'wrench', wrenched[0], new RegExp(`^Work wanting ${title(wrenched[0]).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}`)); await shot(page, 'wrench'); }
  await click(page, 'territory', id('4 · Work model'), /^4 · Work model$/);
  await shot(page, 'territory');
  await page.mouse.click(300, 60); await settle(page, 2);
  await wheel(page, { x: 540, y: 450 }, -5);
  await shot(page, 'whole-island');
  await page.close();
  const turned = await open('');
  await turned.page.mouse.move(540, 600); await turned.page.mouse.down({ button: 'right' });
  await turned.page.mouse.move(360, 600, { steps: 16 }); await turned.page.mouse.up({ button: 'right' });
  await settle(turned.page, 6);
  for (let k = 0; k < 1; k++) { await turned.page.keyboard.press('f'); await settle(turned.page, 2); }
  await shot(turned.page, 'orbited');
  report.errors = [...errors, ...turned.errors];
  await turned.page.close();
  const real = await open('?real&layout=today');
  await shot(real.page, 'real-today');
  report.realErrors = real.errors;
  await real.page.close();
  const pair = await browser.newPage({ viewport: { width: 1440, height: 500 }, deviceScaleFactor: 1 });
  const img = name => `data:image/png;base64,${readFileSync(path.join(out, `${name}.png`)).toString('base64')}`;
  await pair.setContent(`<body style="margin:0;background:#0e1418;color:#e8eef0;font:600 15px system-ui;display:flex;gap:12px;padding:10px">
    ${[['real-today', 'The map today: The library selected'], ['resting', 'Round 8: laid out by the links, lines through gates']].map(([n, t]) =>
      `<figure style="margin:0"><div style="width:702px;height:450px;overflow:hidden"><img src="${img(n)}" style="width:1440px;transform:scale(0.645);transform-origin:0 0"></div><figcaption style="padding-top:6px">${t}</figcaption></figure>`).join('')}</body>`);
  await pair.screenshot({ path: path.join(out, 'side-by-side.png') });
  await pair.close();
  writeFileSync(path.join(out, 'shots.json'), JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(report.errors, []);
});
