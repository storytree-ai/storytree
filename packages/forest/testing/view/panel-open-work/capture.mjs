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
const [story, capability] = tree.stories.flatMap(each => each.capabilities.map(one => [each, one]))
  .filter(([, one]) => (one.openWork?.length ?? 0) >= 2)
  .sort(([, a], [, b]) => Number(b.openWork.some(({ active }) => active)) - Number(a.openWork.some(({ active }) => active)) || b.openWork.length - a.openWork.length)[0] ?? [];
assert.ok(capability !== undefined, 'some capability has two or more open increments to list');
const expected = capability.openWork;

const listed = page => page.evaluate(() => [...document.querySelectorAll('.story-panel .panel-open-work li')].map(li => ({
  increment: li.dataset.incrementId, title: li.querySelector('[data-open-increment]').childNodes[0].textContent.trimEnd(), active: li.classList.contains('active'),
})));
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
        await page.waitForFunction(id => window.__globe.scene.getObjectByName(`settlement:${id}`) !== undefined, capability.id, { timeout: 600_000, polling: 500 });
        await page.evaluate(id => window.storytreeGlobe.face({ kind: 'story', story: id }), story.id);
        await page.waitForFunction(() => window.storytreeGlobe.still(), undefined, { timeout: 60_000, polling: 200 });
        await closeUp(page, settle);
        await page.waitForFunction(() => window.storytreeGlobe.still(), undefined, { timeout: 60_000, polling: 200 });
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
    }, {
      name: 'open-work-row-opens',
      prepare: async ({ page, settle }) => {
        await page.locator('[data-rail-tab="sessions"]').click().catch(() => undefined);
        await page.locator(`.story-panel [data-open-increment="${expected[0].increment}"]`).click();
        await page.locator(`details[data-fold-key$=":increment:${expected[0].increment}"][open]`).waitFor({ timeout: 120_000 });
        await settle(page, 12);
      },
      measure: async ({ page }) => (results.opened = await page.evaluate(id => ({
        tab: document.querySelector('[data-rail-tab][aria-selected="true"]')?.dataset.railTab,
        open: document.querySelector(`details[data-fold-key$=":increment:${id}"]`)?.open === true,
        selected: document.querySelector('.arc-lane[aria-pressed="true"], .arc-queue-chip[aria-pressed="true"]')?.dataset.arcSelect,
        arcInView: (() => {
          const lanes = document.querySelector('.arc-lanes')?.getBoundingClientRect();
          const head = document.querySelector('.arc-lane[aria-pressed="true"], .arc-queue-chip[aria-pressed="true"]')?.getBoundingClientRect();
          return lanes !== undefined && head !== undefined && head.top >= lanes.top - 1 && head.bottom <= lanes.bottom + 1;
        })(),
        arcNamed: [...document.querySelectorAll(`details[data-fold-key$=":increment:${id}"] .arc-increment-detail dt`)].find(dt => dt.textContent === 'Arc')?.nextElementSibling?.textContent,
      }), expected[0].increment)),
      expect: opened => assert.deepEqual({ tab: opened.tab, open: opened.open, named: typeof opened.arcNamed === 'string' && opened.arcNamed.length > 0 }, { tab: 'arcs', open: true, named: true }),
    }],
  });
} finally {
  await live.close();
  await storytree.close();
}
writeFileSync(path.join(captureOutput(pictures), 'measurements.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results));
