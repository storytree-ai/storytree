// A quick look while drawing: one still of the built page, in the capture kit's Chromium, with optional steps.
// node --import tsx docs/design/capability-tree-3d/i-sea-lanes/c-cable/tools/look.mjs <name> [query] [steps-json]
// Steps: {key, times} presses a key; {wheel, x, y, times} turns the wheel there; {drag:[dx,dy], x, y, button} drags;
// {click:[kind, id]} clicks a mark where it stands; {eval} prints what an expression gives. The still goes to the kit's scratch folder.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCapture } from '../../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.dirname(here);
const [name = 'look', query = '', steps = '[]'] = process.argv.slice(2);
await withCapture({ dist, folder: process.env.LOOK_DIR ?? path.join(dist, 'stills', 'looks') }, async ({ browser, origin, out, settle }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.stack ?? e)));
  page.on('console', m => { if (m.type() === 'error' || m.text().startsWith('framing')) errors.push(m.text()); });
  await page.goto(`${origin}/index.html${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 120000 }).catch(e => { console.error(errors); throw e; });
  // The rest view frames itself on the plan as the map paints, so it is painted until it has.
  for (let k = 0; k < 200 && !query.includes('real') && await page.evaluate(() => document.body.dataset.framed) !== 'yes'; k++) await settle(page, 3);
  await settle(page, 12);
  for (const s of JSON.parse(steps)) {
    if (s.key) for (let k = 0; k < (s.times ?? 1); k++) { await page.keyboard.press(s.key); await settle(page, 2); }
    if (s.wheel) { await page.mouse.move(s.x, s.y); for (let k = 0; k < s.times; k++) { await page.mouse.wheel(0, s.wheel); await settle(page, 2); } }
    if (s.drag) { await page.mouse.move(s.x, s.y); await page.mouse.down({ button: s.button ?? 'left' }); await page.mouse.move(s.x + s.drag[0], s.y + s.drag[1], { steps: 12 }); await page.mouse.up({ button: s.button ?? 'left' }); }
    // {grab:[kind, id], to:[x, y]} drags the map so that mark stands at x, y (as shots.mjs frames the mouth).
    if (s.grab) { const at = await page.evaluate(([k, i]) => window.mock.layer.point(k, i), s.grab); await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(s.to[0], s.to[1], { steps: 16 }); await page.mouse.up(); }
    if (s.click) { const at = await page.evaluate(([k, i]) => window.mock.layer.point(k, i), s.click); console.error('click', s.click.join(' '), at); await page.mouse.click(at.x, at.y); }
    if (s.eval) console.log(JSON.stringify(await page.evaluate(s.eval)));
    await settle(page, 6);
  }
  await settle(page, 8);
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file });
  console.error(file);
  if (errors.length) console.error(errors.join('\n'));
});
