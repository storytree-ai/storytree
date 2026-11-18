import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkedStores } from '@storytree/map/stores';
import { buildCapture, buildFolder, captureSeed, fakeBridge, withCapture } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.join(here, '../../../src/view/evidence', 'shared-stores');
const dist = buildFolder(here);
const { seed, survey } = captureSeed('code-rows');

const STORE = 'postgres://db/checkbox';
const link = (table, direction, cite) => ({ store: STORE, table, direction, cites: [cite] });
const [writer, reader] = seed.tree.stories.flatMap(({ capabilities }) => capabilities).slice(0, 2);
writer.storeLinks = [link('users', 'write', 'api/users.py:14'), link('forms', 'write', 'api/forms.py:22'), link('answers', 'both', 'api/answers.py:31'), link('source_objects', 'write', 'ingest/load.py:40')];
reader.storeLinks = [link('sessions', 'read', 'web/session.py:9'), link('checks', 'read', 'web/checks.py:17'), link('document_summaries', 'read', 'web/summary.py:12'), link('answers', 'read', 'web/answers.py:28')];
const stores = linkedStores(seed.tree.stories);
await buildCapture({ dist });

const { results, out } = await withCapture({ folder: evidence, dist }, async ({ browser, origin, out, settle }) => {
  const results = {};
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
    ...(survey === undefined ? {} : { codeSurvey: async () => copy(survey) }),
  });
  await bridge.install(page);
  await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await bridge.ready(page);
  await page.waitForFunction(address => {
    const state = window.__globe;
    return document.body.dataset.state === 'ready' && !!state && !!state.scene.getObjectByName(`store:${address}`);
  }, stores[0].address, { timeout: 180000 });
  for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  await settle(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, 'store-beside-islands-1440x960.png'), timeout: 180000 });
  const slab = await page.evaluate(address => {
    const { scene, camera } = window.__globe, V = camera.position.constructor;
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const canvas = document.querySelector('canvas').getBoundingClientRect();
    const at = scene.getObjectByName(`store:${address}`).getWorldPosition(new V()).project(camera);
    const px = v => { const p = v.project(camera); return { x: canvas.left + (p.x + 1) * canvas.width / 2, y: canvas.top + (1 - p.y) * canvas.height / 2 }; };
    const plate = scene.getObjectByName(`store:${address}`);
    const tiles = [...document.querySelectorAll('.planet-store-table')].map(n => {
      const name = n.textContent, mesh = plate.getObjectByName(`store-table:${name}`), box = n.firstElementChild.getBoundingClientRect();
      const { width, depth } = mesh.geometry.parameters;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => px(mesh.localToWorld(new V(a * width / 2, 0, b * depth / 2))));
      const tile = { left: Math.min(...corners.map(c => c.x)), right: Math.max(...corners.map(c => c.x)), top: Math.min(...corners.map(c => c.y)), bottom: Math.max(...corners.map(c => c.y)) };
      return { name, tile, label: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
        whole: box.left >= tile.left && box.right <= tile.right && box.top >= tile.top && box.bottom <= tile.bottom };
    });
    return { x: canvas.left + (at.x + 1) * canvas.width / 2, y: canvas.top + (1 - at.y) * canvas.height / 2,
      tables: tiles.map(t => t.name), tiles, name: document.querySelector('.planet-store-name')?.textContent };
  }, stores[0].address);
  await page.mouse.click(slab.x, slab.y);
  await settle(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, 'store-panel-1440x960.png'), timeout: 180000 });
  const panel = await page.evaluate(() => document.querySelector('.story-panel')?.innerText ?? null);
  results.store = { stores: stores.map(({ address, tables }) => ({ address, tables: tables.map(({ name }) => name) })), slab, panel, errors };
  await page.close();
  return { results, out };
});
writeFileSync(path.join(out, 'measurements.json'), JSON.stringify({ seed: 'code-rows', results }, null, 1) + '\n');
console.log(JSON.stringify(results, null, 1));
