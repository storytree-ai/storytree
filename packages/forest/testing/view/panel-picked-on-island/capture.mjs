// The story panel draws no capability tree (ADR-1285; Mick, 2026-11-07: "I'm actually really liking the one on the map. I
// don't think it's needed."): storytree's own map (the code-rows snapshot and its survey) as the app opens it, close up on The
// library. A capability's territory clicked on the island (a road click falls through to the land under it) opens the panel
// on that capability: the story's lead and its detail, with no tree, card or pop-out (4.6, 4.8), and its contracts behind a
// handle that a single click leaves closed and a double-click opens (4.41, ADR-1284 D1); then a gate clicked shows its pair's
// links in its place (3.88). `node --import tsx capture.mjs` (append --retake to write into
// src/view/evidence/panel-picked-on-island). Measures, from the page, what the panel holds, so "no tree" is measured.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS } from '../../../../forest-world/src/planet/PlanetWorldCanvas.tsx';
import { DETAIL_ZOOM } from '../../../src/view/zoom-detail.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'panel-picked-on-island');
const { seed, survey } = captureSeed('code-rows');
const dist = buildFolder(here);
await buildCapture({ dist });

const until = async (page, predicate, arg) => page.waitForFunction(predicate, arg, { timeout: 180_000, polling: 200 });
const library = seed.tree.stories.find(story => story.title === 'The library').id;
/** What the panel holds: the capability whose detail it shows, a gate's links, and anything of a tree. */
const panel = page => page.evaluate(() => {
  const aside = document.querySelector('aside.story-panel');
  return {
    open: aside !== null && !aside.hidden,
    detail: aside?.querySelector('.panel-detail')?.dataset.capabilityId,
    gate: aside?.querySelector('.panel-gate') !== null && aside?.querySelector('.panel-gate') !== undefined,
    tree: aside?.querySelectorAll('svg, .panel-tree, [data-open-tree], [role="button"]').length ?? 0,
    handles: [...aside?.querySelectorAll('.panel-handle') ?? []].filter(h => h.closest('.panel-fold-body[hidden]') === null).map(h => h.textContent),
    opened: [...aside?.querySelectorAll('.panel-handle[aria-expanded="true"]') ?? []].map(h => h.textContent),
    picked: (() => { const found = []; window.__globe.scene.traverse(o => { if (o.visible && o.name.startsWith('picked-ring:')) found.push(o.name.slice('picked-ring:'.length)); }); return found; })(),
  };
});
const eye = { radius: SHEET_RADIUS + PLATE_CLEARANCE, fov: SHEET_FOV };
const closeUp = async (page, settle, times) => {
  if (!await page.evaluate(story => window.storytreeGlobe.face({ kind: 'story', story }), library)) throw new Error('no camera stop for The library');
  await until(page, () => window.storytreeGlobe.still());
  await page.evaluate(({ zoom, radius, fov }) => {
    const { camera, size, invalidate } = window.__globe;
    camera.position.setLength(radius + Math.max(size.height, 1) / 2 / Math.tan(fov * Math.PI / 360) / zoom);
    camera.updateMatrixWorld(); invalidate();
  }, { zoom: DETAIL_ZOOM.near * times, ...eye });
  await settle(page, 12);
};
/** The screen points of The library's gate posts or road segments, nearest the middle of the view first. */
const targets = (page, kind) => page.evaluate(({ story, kind }) => {
  const { scene, camera } = window.__globe, box = document.querySelector('canvas').getBoundingClientRect();
  const marks = [];
  scene.updateMatrixWorld(true);
  scene.getObjectByName(`planet:${story}`).traverse(object => {
    const { gate, between, portal, links, width } = object.userData;
    const wanted = kind === 'gate' ? gate === true && /^gate-post:\d+:1$/.test(object.name) && !between.includes('open') : width !== undefined && !portal && links?.length === 1;
    if (!wanted) return;
    object.geometry.computeBoundingBox();
    const at = object.geometry.boundingBox.getCenter(object.position.clone()).applyMatrix4(object.matrixWorld).project(camera);
    if (Math.abs(at.x) > 0.6 || Math.abs(at.y) > 0.8) return;
    marks.push({ x: box.left + (at.x + 1) / 2 * box.width, y: box.top + (1 - at.y) / 2 * box.height, off: Math.hypot(at.x, at.y) });
  });
  return marks.sort((a, b) => a.off - b.off);
}, { story: library, kind });
const clickUntil = async (page, settle, kind, done) => {
  for (const target of await targets(page, kind)) {
    await page.mouse.click(target.x, target.y);
    await settle(page, 8);
    if (done(await panel(page))) return;
  }
  throw new Error(`no ${kind} on The library opened the panel as wanted`);
};
const results = {};

await runCapture({
  folder: pictures, dist, seed, survey,
  prepare: async ({ page, settle }) => {
    await until(page, () => document.body.dataset.state === 'ready');
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await until(page, story => !!window.__globe.scene.getObjectByName(`planet:${story}`)?.getObjectByName('island-roads'), library);
    await closeUp(page, settle, 1.6);
  },
  views: [{
    name: 'capability-picked-on-island',
    prepare: async ({ page, settle }) => {
      await clickUntil(page, settle, 'road', found => found.open && found.picked.length === 1 && found.detail === found.picked[0]);
      await closeUp(page, settle, 1.6);
    },
    measure: async ({ page, out }) => {
      await page.locator('aside.story-panel').screenshot({ path: path.join(out, 'capability-picked-on-island-panel.png') });
      return (results.capability = await panel(page));
    },
    expect: found => {
      assert.equal(found.tree, 0, 'no tree, card or pop-out in the panel');
      assert.equal(found.detail, found.picked[0], 'the panel shows the capability picked on the island');
      assert.ok(found.handles.some(h => /^Contracts · \d+$/.test(h)), 'its contracts behind a counted handle');
      assert.deepEqual(found.opened, [], 'every fold closed on the first pick');
    },
  }, {
    // ADR-1284 D1: a single click on the handle opens nothing, a double-click opens it, and a contract opens one level deeper.
    name: 'capability-folds-opened',
    prepare: async ({ page, settle }) => {
      const contracts = page.locator('aside.story-panel [data-fold="contracts"] > .panel-handle');
      await contracts.click();
      await settle(page, 2);
      results.singleClick = (await panel(page)).opened;
      await contracts.dblclick();
      await page.locator('aside.story-panel [data-fold="contract"] > .panel-handle').first().dblclick();
      await settle(page, 4);
    },
    measure: async ({ page, out }) => {
      await page.locator('aside.story-panel').screenshot({ path: path.join(out, 'capability-folds-opened-panel.png') });
      return (results.opened = await panel(page));
    },
    expect: found => {
      assert.deepEqual(results.singleClick, [], 'a single click opens nothing');
      assert.equal(found.opened.length, 2, 'the double-clicked Contracts and its first contract are open');
    },
  }, {
    name: 'gate-picked-on-island',
    prepare: async ({ page, settle }) => { await clickUntil(page, settle, 'gate', found => found.open && found.gate); },
    measure: async ({ page, out }) => {
      await page.locator('aside.story-panel').screenshot({ path: path.join(out, 'gate-picked-on-island-panel.png') });
      return (results.gate = await panel(page));
    },
    expect: found => { assert.equal(found.tree, 0); assert.equal(found.detail, undefined, 'a gate shows its links in the capability\'s place'); },
  }],
});
writeFileSync(path.join(captureOutput(pictures), 'measurements.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results));
