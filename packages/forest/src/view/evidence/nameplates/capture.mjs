// The globe's nameplates on the actual desktop page, before and after real pointer drags, and with a story
// selected. Reuses the rows capture's build, seed and survey: `node ../rows/build.mjs <checkout> <label>`, then
// `node capture.mjs <label>` (after: this branch; before: origin/main). Measures, for every plate on show,
// whether it hangs below its island's land and under it; writes measurements-<label>.json.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const rows = path.join(here, '../rows');
const label = process.argv.slice(2).find(arg => arg !== '--retake') ?? 'after';
const dist = path.join(rows, 'dist', label);
const seed = JSON.parse(gunzipSync(readFileSync(path.join(rows, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(rows, 'survey.json'), 'utf8'));
await withCapture({ folder: here, dist }, async ({ browser, origin, out, settle }) => {

/** Each story plate on show: below every point of its island's drawn land on screen, and under it (its middle within the land's width). */
const platesAgainstLand = page => page.evaluate(() => {
  const { scene, camera, gl } = window.__globe, V = camera.position.constructor;
  const box = gl.domElement.getBoundingClientRect();
  scene.updateMatrixWorld(true);
  return [...document.querySelectorAll('.forest-label[data-story-id]')].flatMap(label => {
    const rect = label.getBoundingClientRect();
    if (rect.width === 0 || getComputedStyle(label.closest('div[style*="position: absolute"]') ?? label).display === 'none') return [];
    const ground = scene.getObjectByName(`planet:${label.dataset.storyId}`)?.getObjectByName('island-ground');
    if (!ground) return [];
    const ys = [], xs = [], p = new V(), at = ground.geometry.attributes.position;
    for (let i = 0; i < at.count; i++) {
      p.fromBufferAttribute(at, i).applyMatrix4(ground.matrixWorld);
      if (p.clone().sub(camera.position).dot(p) > 0) continue; // the far side of the globe
      const s = p.clone().project(camera);
      xs.push(box.left + (s.x + 1) * box.width / 2); ys.push(box.top + (1 - s.y) * box.height / 2);
    }
    if (ys.length === 0) return [];
    const middle = rect.left + rect.width / 2;
    return [{ story: label.textContent, below: rect.top >= Math.max(...ys) - 1, under: middle >= Math.min(...xs) && middle <= Math.max(...xs),
      gap: Math.round(rect.top - Math.max(...ys)) }];
  });
});

  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // The rows capture's stand-in bridge.
  const bridge = fakeBridge({});
  await bridge.install(page);
  await page.addInitScript(({ data, survey }) => {
    const copy = value => structuredClone(value);
    window.storytreeAnswers = {
      projectSelection: async () => ({ projects: data.projects, current: 'storytree' }),
      chooseProject: async () => ({ projects: data.projects, current: 'storytree' }),
      listProjects: async () => copy(data.projects), projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
      linesSince: async (_, cursor) => cursor === 0 ? copy(data.lines) : { lines: [], cursor: data.lines.cursor },
      frontCovers: async (_, id) => copy(data.covers[id] ?? []),
      codeSurvey: async () => copy(survey),
      windowReadings: async (_, sessions) => sessions.map(session => ({ session, at: new Date().toISOString(), compactions: 0, inView: [], glimpses: [], opens: [] })),
      windowReading: async (_, session) => ({ session, at: new Date().toISOString(), compactions: 0, inView: [], glimpses: [], opens: [] }),
      contextReadings: async () => [], idleAfterMs: async () => 3600000, leaveAfterMs: async () => 3600000,
    };
  }, { data: seed, survey });
  await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await bridge.ready(page);
  await page.waitForFunction(ids => {
    const state = window.__globe;
    if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
    return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
  }, seed.tree.stories.map(s => s.id), { timeout: 120000 });
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('file:')) n++; }); return n > 0; }, undefined, { timeout: 60000 });
  for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  await settle(page);
  const results = { label, errors };
  results.opening = await platesAgainstLand(page);
  await page.screenshot({ path: path.join(out, `${label}-opening.png`), timeout: 180000 });

  const box = await page.locator('canvas').first().boundingBox();
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  for (const drag of [{ x: 110, y: 0 }, { x: 0, y: 60 }, { x: -60, y: -90 }]) {
    await page.mouse.move(centre.x - drag.x / 2, centre.y - drag.y / 2);
    await page.mouse.down();
    await page.mouse.move(centre.x + drag.x / 2, centre.y + drag.y / 2, { steps: 24 });
    await page.mouse.up();
  }
  await page.mouse.move(2, 2);
  await settle(page);
  results.afterDrags = await platesAgainstLand(page);
  await page.screenshot({ path: path.join(out, `${label}-after-drags.png`), timeout: 180000 });

  // Bring the land left of the middle, clear of the story panel that selecting opens.
  await page.mouse.move(centre.x + 120, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x - 120, centre.y - 20, { steps: 24 });
  await page.mouse.up();
  await page.mouse.move(2, 2);
  await settle(page);
  // Select the story left of the middle that has the most capabilities: click its island's middle.
  const target = await page.evaluate(() => {
    const { scene, camera, gl } = window.__globe, V = camera.position.constructor;
    const box = gl.domElement.getBoundingClientRect();
    const found = [];
    scene.traverse(o => {
      if (!o.name.startsWith('planet:story_')) return;
      const at = o.getWorldPosition(new V());
      if (at.clone().sub(camera.position).dot(at) > 0) return;
      const s = at.project(camera), x = box.left + (s.x + 1) * box.width / 2, y = box.top + (1 - s.y) * box.height / 2;
      let n = 0; o.traverse(c => { if (c.name.startsWith('territory:cap') || (c.name.startsWith('territory:') && c.userData.capability)) n++; });
      found.push({ id: o.name.slice(7), x, y, territories: n, off: Math.hypot(x - box.left - box.width / 2, y - box.top - box.height / 2) });
    });
    return found.filter(f => f.off < box.height / 3 && f.x < box.left + box.width * 0.55).sort((a, b) => b.territories - a.territories)[0];
  });
  await page.mouse.click(target.x, target.y);
  await page.mouse.move(2, 2);
  await settle(page);
  results.selected = await page.evaluate(id => ({
    story: document.querySelector(`.forest-label[data-story-id="${id}"]`)?.textContent,
    capabilityPlates: [...document.querySelectorAll('.planet-nameplate.capability')].filter(p => p.getBoundingClientRect().width > 0).map(p => p.textContent),
    dimmedOthers: [...document.querySelectorAll('.forest-label[data-story-id]')].filter(p => p.dataset.storyId !== id && +getComputedStyle(p).opacity < 1).length,
  }), target.id);
  await page.screenshot({ path: path.join(out, `${label}-selected.png`), timeout: 180000 });
  for (const at of ['opening', 'afterDrags']) results[`${at}Summary`] = `${results[at].filter(p => p.below && p.under).length} of ${results[at].length} plates on show hang below and under their island`;
  writeFileSync(path.join(out, `measurements-${label}.json`), JSON.stringify(results, null, 2) + '\n');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ opening: results.openingSummary, afterDrags: results.afterDragsSummary, selected: results.selected, errors }, null, 1));
});
