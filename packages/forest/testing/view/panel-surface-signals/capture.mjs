// The panel's surface says only what needs you (ADR-1284 D2, D3): storytree's own map (the code-rows snapshot and its survey)
// as the app opens it, close up on The library. A healthy capability picked on the island shows its title, its word with
// where it came from and its lead; one that is not green adds one why line; its two health readings wait behind Health, which
// a double-click opens. `node --import tsx capture.mjs` (append --retake to write into src/view/evidence/panel-surface-signals).
// Measures, from the page, each pick's word, why line and handles.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS } from '../../../../forest-world/src/planet/PlanetWorldCanvas.tsx';
import { DETAIL_ZOOM } from '../../../src/view/zoom-detail.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'panel-surface-signals');
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
    word: aside?.querySelector('.panel-detail .panel-state')?.textContent,
    why: aside?.querySelector('.panel-detail .panel-why')?.textContent ?? null,
    surface: aside?.querySelector('.panel-detail .panel-health')?.closest('.panel-fold-body[hidden]') !== null,
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
/** Clicks The library's roads, then a grid over the view's middle (a click falls through to the territory under it), until `done`. */
const clickUntil = async (page, settle, kind, done) => {
  const box = await page.evaluate(() => { const { left, top, width, height } = document.querySelector('canvas').getBoundingClientRect(); return { left, top, width, height }; });
  const grid = [];
  for (let y = 0.3; y <= 0.7; y += 0.05) for (let x = 0.3; x <= 0.7; x += 0.04) grid.push({ x: box.left + x * box.width, y: box.top + y * box.height });
  for (const target of [...await targets(page, kind), ...grid]) {
    await page.mouse.click(target.x, target.y);
    await settle(page, 8);
    if (done(await panel(page))) return;
  }
  throw new Error(`no ${kind} on The library opened the panel as wanted`);
};
const results = {};
const pick = (wanted) => async ({ page, settle }) => {
  await clickUntil(page, settle, 'road', found => found.open && found.picked.length === 1 && found.detail === found.picked[0] && wanted(found));
  await closeUp(page, settle, 1.6);
};
const shot = (name, key) => async ({ page, out }) => {
  await page.locator('aside.story-panel').screenshot({ path: path.join(out, `${name}-panel.png`) });
  return (results[key] = await panel(page));
};

await runCapture({
  folder: pictures, dist, seed, survey,
  prepare: async ({ page, settle }) => {
    await until(page, () => document.body.dataset.state === 'ready');
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await until(page, story => !!window.__globe.scene.getObjectByName(`planet:${story}`)?.getObjectByName('island-roads'), library);
    await closeUp(page, settle, 1.6);
  },
  views: [{
    name: 'healthy-capability',
    prepare: pick(found => /^healthy/.test(found.word ?? '')),
    measure: shot('healthy-capability', 'healthy'),
    expect: found => {
      assert.equal(found.why, null, 'a healthy capability has no why line');
      assert.ok(found.surface, 'its health readings are not on the surface');
      assert.ok(found.handles.some(h => /^Health · [12]$/.test(h)), 'they wait behind Health');
      assert.deepEqual(found.opened, [], 'every fold closed on the first pick');
    },
  }, {
    name: 'not-green-capability',
    prepare: pick(found => /^(unhealthy|untested)/.test(found.word ?? '')),
    measure: shot('not-green-capability', 'notGreen'),
    expect: found => { assert.match(found.why ?? '', /^Why not green: /, 'one why line'); assert.ok(found.surface); },
  }, {
    // ADR-1284 D1, D3: a double-click on Health opens both readings, each with its source.
    name: 'health-opened',
    prepare: async ({ page, settle }) => {
      await page.locator('aside.story-panel [data-fold="health"] > .panel-handle').dblclick();
      await settle(page, 4);
    },
    measure: shot('health-opened', 'opened'),
    expect: found => { assert.ok(found.opened.some(h => /^Health · /.test(h)), 'Health is open'); assert.equal(found.surface, false); },
  }],
});
writeFileSync(path.join(captureOutput(pictures), 'measurements.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results));
