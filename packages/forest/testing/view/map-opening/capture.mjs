// The glass sheet's opening now that nothing is docked over the map's bottom (increment_a436e9d46195, ADR-1219 moved the
// sessions list into the left rail). Drawn by the actual desktop page from the capture kit's `code-rows` seed, storytree's own
// library, on the left rail's Arcs tab. It measures where the sheet's north and south edges are drawn in the map's canvas, against
// the Stories / Library switch and the compass at the top, and the lowest story name. Run from the checkout root, in the foreground:
//   node ~/.storytree/your-factory/plugins/micks-dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/testing/view/map-opening/capture.mjs --retake
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureSeed, fakeBridge, withCapture } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
// Pictures and measurements go to the package's evidence set of this name (a scratch folder unless --retake); nothing here reads them.
const evidence = path.join(here, '../../../src/view/evidence', 'map-opening');
const dist = buildFolder(here);
const { seed, survey } = captureSeed('code-rows');
const viewports = [{ width: 1440, height: 960 }, { width: 1280, height: 720 }];
await buildCapture({ dist });

/** In the canvas's pixels: the sheet's north and south edges as drawn, the switch's and compass's bottoms, and the lowest story name's. */
const measure = page => page.evaluate(() => {
  const { scene, camera } = window.__globe, V = camera.position.constructor;
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const canvas = document.querySelector('canvas').getBoundingClientRect();
  const glass = scene.getObjectByName('sheet:glass');
  glass.geometry.computeBoundingBox();
  const { min, max } = glass.geometry.boundingBox;
  const ys = [];
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
    const at = glass.localToWorld(new V(x, y, z)).project(camera);
    ys.push((1 - at.y) * canvas.height / 2);
  }
  const bottomOf = selector => { const rect = document.querySelector(selector)?.getBoundingClientRect(); return rect ? Math.round(rect.bottom - canvas.top) : null; };
  const names = [...document.querySelectorAll('.planet-nameplate[data-story-id]')].map(n => n.getBoundingClientRect()).filter(r => r.width > 0);
  return {
    canvas: { width: Math.round(canvas.width), height: Math.round(canvas.height) },
    northEdge: Math.round(Math.min(...ys)), southEdge: Math.round(Math.max(...ys)),
    keptBelowSouthEdge: Math.round(canvas.height - Math.max(...ys)),
    switchBottom: bottomOf('[data-globe-switch]'), compassBottom: bottomOf('.sheet-compass'),
    lowestName: Math.round(Math.max(...names.map(r => r.bottom)) - canvas.top),
    fadedNames: document.querySelectorAll('.planet-nameplate[data-story-id].crowded').length, names: names.length,
  };
});

const { results, out } = await withCapture({ folder: evidence, dist }, async ({ browser, origin, out, settle }) => {
  const results = {};
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1, colorScheme: 'dark' });
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
    await page.waitForFunction(ids => {
      const state = window.__globe;
      if (document.body.dataset.state !== 'ready' || !state || !state.scene.getObjectByName('sheet:glass')) return false;
      return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
    }, seed.tree.stories.map(s => s.id), { timeout: 180000 });
    for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
    await settle(page);
    await page.waitForTimeout(500);
    const name = `opening-${viewport.width}x${viewport.height}`;
    await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 180000 });
    results[name] = { ...(await measure(page)), errors };
    await page.close();
  }
  return { results, out };
});
writeFileSync(path.join(out, 'measurements.json'), JSON.stringify({ seed: 'code-rows', results }, null, 1) + '\n');
console.log(JSON.stringify(results, null, 1));
