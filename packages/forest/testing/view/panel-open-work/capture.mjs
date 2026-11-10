// A capability's panel lists its open work in order (rollout 2, step 4c; ADR-1253 D1): the real desktop page on storytree's own
// live library, read with the app's own reads (the capture kit's liveAnswers), so the open work is the library's as it stands.
// The island of the capability with the most open work is clicked, then its territory, whose detail lists the open increments naming
// it: the active one first, then the rest in parked order. `node --import tsx capture.mjs` (append --retake to write into
// src/view/evidence/panel-open-work). Reads only: every write the page could ask keeps the stand-in's quiet answer.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from '@storytree/library';
import { route } from '@storytree/project-and-caller/routing';
import { buildCapture, buildFolder, captureOutput, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { liveAnswers } from '../../../../../apps/desktop/src/capture/live.ts';
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS } from '../../../../forest-world/src/planet/PlanetWorldCanvas.tsx';
import { DETAIL_ZOOM } from '../../../src/view/zoom-detail.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'panel-open-work');
const dist = buildFolder(here);
await buildCapture({ dist });

const routed = route(path.join(here, '../../../../..'));
if (routed.status !== 'routed') throw new Error(`no library to read: ${routed.message ?? routed.status}`);
const storytree = await connect(routed.library);
const tree = await (await storytree.openProject(routed.project)).projectTree();
// The capability with the most open work as the library stands, one with an active increment before one without.
const [story, capability] = tree.stories.flatMap(each => each.capabilities.map(one => [each, one]))
  .filter(([, one]) => (one.openWork?.length ?? 0) >= 2)
  .sort(([, a], [, b]) => Number(b.openWork.some(({ active }) => active)) - Number(a.openWork.some(({ active }) => active)) || b.openWork.length - a.openWork.length)[0] ?? [];
assert.ok(capability !== undefined, 'some capability has two or more open increments to list');
const expected = capability.openWork;

const listed = page => page.evaluate(() => [...document.querySelectorAll('.story-panel .panel-open-work li')].map(li => ({
  increment: li.dataset.incrementId, title: li.childNodes[0].textContent.trimEnd(), active: li.classList.contains('active'),
})));
/** Stands the eye on its line of sight near, where an island's territories are large enough to click and its settlements show
 * (3.86), as the wheel would, and lets the map draw it (the open-work capture's close-up). */
const closeUp = async (page, settle) => {
  await page.evaluate(({ zoom, radius, fov }) => {
    const { camera, size, invalidate } = window.__globe;
    camera.position.setLength(radius + Math.max(size.height, 1) / 2 / Math.tan(fov * Math.PI / 360) / zoom);
    camera.updateMatrixWorld(); invalidate();
  }, { zoom: DETAIL_ZOOM.near * 1.4, radius: SHEET_RADIUS + PLATE_CLEARANCE, fov: SHEET_FOV });
  await settle(page, 12);
};
const live = await liveAnswers({ storytree, project: routed.project });
const results = { story: story.title, capability: capability.title, library: expected };
try {
  await runCapture({
    folder: pictures, dist, answers: live.answers,
    prepare: async ({ page, settle }) => {
      await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 180_000, polling: 200 });
      for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
      await settle(page);
    },
    views: [{
      name: 'capability-open-work',
      prepare: async ({ page, settle }) => {
        const island = await page.evaluate(id => window.storytreeGlobe.islands().find(i => i.story === id), story.id);
        await page.mouse.click(island.x, island.y);
        await page.waitForFunction(id => document.body.dataset.selected === id, story.id, { timeout: 60_000 });
        // Each island's roads, its settlements with them, are routed off the page after its territories' first search lands, one
        // island at a time, so on the live library the settlement clicked can come minutes in.
        await page.waitForFunction(id => window.__globe.scene.getObjectByName(`settlement:${id}`) !== undefined, capability.id, { timeout: 600_000, polling: 500 });
        // The panel draws no tree to pick from (ADR-1285): the capability is picked on the island, at its settlement, which takes
        // no ray, so the click lands on its territory. Faced now, beside the panel as it stands, and closed up: at the map's own
        // zoom a big island's territories are a few pixels across, so a click beside a settlement picks its neighbour.
        await page.evaluate(id => window.storytreeGlobe.face({ kind: 'story', story: id }), story.id);
        await page.waitForFunction(() => window.storytreeGlobe.still(), undefined, { timeout: 60_000, polling: 200 });
        await closeUp(page, settle);
        await page.waitForFunction(() => window.storytreeGlobe.still(), undefined, { timeout: 60_000, polling: 200 });
        // A settlement's symbol is laid where it stands in its own vertices, its group at its island's origin, so the middle of
        // its casing's points is where it is drawn.
        const settlement = await page.evaluate(id => {
          const { scene, camera } = window.__globe, box = document.querySelector('canvas').getBoundingClientRect();
          scene.updateMatrixWorld(true);
          const casing = scene.getObjectByName(`settlement:${id}`).getObjectByName('settlement-casing'), points = casing.geometry.getAttribute('position');
          const at = camera.position.clone().set(0, 0, 0), point = at.clone();
          for (let k = 0; k < points.count; k++) at.add(point.fromBufferAttribute(points, k));
          at.divideScalar(points.count).applyMatrix4(casing.matrixWorld).project(camera);
          const panel = document.querySelector('.story-panel').getBoundingClientRect();
          return { x: box.left + (at.x + 1) / 2 * box.width, y: box.top + (1 - at.y) / 2 * box.height, left: box.left, top: box.top, right: Math.min(box.right, panel.left), bottom: box.bottom };
        }, capability.id);
        assert.ok(settlement.x > settlement.left && settlement.x < settlement.right && settlement.y > settlement.top && settlement.y < settlement.bottom,
          `the settlement stands on the globe beside the panel: ${JSON.stringify(settlement)}`);
        await page.mouse.click(settlement.x, settlement.y);
        await page.locator(`.story-panel .panel-detail[data-capability-id="${capability.id}"]`).waitFor({ timeout: 60_000 });
        // The open work is a fold of the capability's detail, closed until its handle opens it.
        await page.locator(`.story-panel .panel-detail[data-capability-id="${capability.id}"] [data-fold="open-work"] .panel-handle`).click();
        const list = page.locator('.story-panel .panel-open-work');
        await list.waitFor({ timeout: 30_000 });
        await page.locator(`.story-panel .panel-detail[data-capability-id="${capability.id}"]`).scrollIntoViewIfNeeded();
        await settle(page, 12);
      },
      measure: async ({ page, out }) => {
        await page.locator('.story-panel').screenshot({ path: path.join(out, 'capability-open-work-panel.png') });
        return (results.panel = await listed(page));
      },
      expect: found => assert.deepEqual(found, expected.map(({ increment, title, active }) => ({ increment, title, active: active === true }))),
    }],
  });
} finally {
  await live.close();
  await storytree.close();
}
writeFileSync(path.join(captureOutput(pictures), 'measurements.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results));
