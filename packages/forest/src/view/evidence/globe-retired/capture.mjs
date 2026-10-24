// The forest page's glass sheet before and after the globe's code was deleted (increment_093d5b3b28d8): the same views drawn
// by the actual desktop page from the read-only snapshot glass-sheet-tilt/ used (its seed.json.gz and
// survey.json, kept out of this repository for its size), so a pixel comparison shows nothing visible changed. Run from the
// checkout root, in the foreground, once on the source before the deletion and once after:
//   node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/globe-retired/capture.mjs <seed folder> <before|after> --retake
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const [from, label] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
if (from === undefined || !['before', 'after'].includes(label)) throw new Error('Name the snapshot folder, then before or after.');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(from, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(from, 'survey.json'), 'utf8'));
const dist = buildFolder(here);
await buildCapture({ dist });

await withCapture({ folder: here, dist }, async ({ browser, origin, out, settle }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const copy = value => structuredClone(value);
  const bridge = fakeBridge({
    projectSelection: async () => ({ projects: seed.projects, current: 'storytree' }),
    chooseProject: async () => ({ projects: seed.projects, current: 'storytree' }),
    listProjects: async () => copy(seed.projects), projectTree: async () => copy(seed.tree),
    changesSince: async (_, cursor) => cursor === 0 ? copy(seed.changes) : { changes: [], cursor: seed.changes.cursor },
    linesSince: async (_, cursor) => cursor === 0 ? copy(seed.lines) : { lines: [], cursor: seed.lines.cursor },
    frontCovers: async (_, id) => copy(seed.covers[id] ?? []),
    codeSurvey: async () => copy(survey),
  });
  await bridge.install(page);
  await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await bridge.ready(page);
  await page.waitForFunction(ids => {
    const state = window.__globe;
    if (document.body.dataset.state !== 'ready' || !state || !state.scene.getObjectByName('sheet:glass')) return false;
    return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
  }, seed.tree.stories.map(s => s.id), { timeout: 180000 });
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.getObjectByName('sheet:under')?.traverse(o => { if (o.name.startsWith('knowledge-point:')) n++; }); return n > 0; }, undefined, { timeout: 180000 });
  for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  const shoot = async name => {
    await page.mouse.move(2, 2);
    await settle(page, 30);
    await page.screenshot({ path: path.join(out, `${label}-${name}.png`), timeout: 180000 });
  };
  await shoot('app-stories');
  await page.locator('[data-globe-switch="library"]').click();
  await page.waitForTimeout(3000);
  await shoot('app-library');
  if (errors.length > 0) throw new Error(errors.join('\n'));
});
