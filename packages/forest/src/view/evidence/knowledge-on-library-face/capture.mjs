// The forest page's glass sheet with its knowledge only on the Library face (increment_6d39e6e22ce1, ADR-1061): nothing under
// the glass from the Stories face, the islands hollow outlines on the Library face, and links only for the selected story.
// Drawn by the actual desktop page from the same read-only snapshot of storytree's own library as ../glass-sheet-tilt/
// (branch spike/glass-sheet's seed.json.gz and survey.json, kept out of this repository for its size). Every turn is a real
// press of the Library or Stories button, the selection a real click on an island. Run from the checkout root, in the foreground:
//   node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/knowledge-on-library-face/capture.mjs <seed folder> --retake
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts';
import { SHEET_TILT } from '@storytree/forest-world/planet';

const resting = Math.cos(SHEET_TILT);

const here = path.dirname(fileURLToPath(import.meta.url));
const from = process.argv.slice(2).find(arg => !arg.startsWith('--'));
if (from === undefined) throw new Error('Name the folder holding the snapshot (seed.json.gz and survey.json).');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(from, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(from, 'survey.json'), 'utf8'));
const dist = path.join(here, 'dist');
const viewport = { width: 1440, height: 960 };
await buildCapture({ dist });

/** What the eye sees now: which face, each island's screen place, the notes and links under the glass, and the selection. */
const measure = page => page.evaluate(() => {
  const { scene, camera } = window.__globe, V = camera.position.constructor, Q = camera.quaternion.constructor;
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const eye = new V(0, 0, 1).applyQuaternion(camera.quaternion);
  const canvas = document.querySelector('canvas').getBoundingClientRect();
  const islands = [];
  scene.traverse(object => {
    if (!object.name.startsWith('planet:story_')) return;
    const p = object.getWorldPosition(new V()).project(camera);
    islands.push({ story: object.name.slice(7), facing: Math.round(new V(0, 1, 0).applyQuaternion(object.getWorldQuaternion(new Q())).dot(eye) * 1000) / 1000,
      x: Math.round((p.x + 1) / 2 * canvas.width), y: Math.round((1 - p.y) / 2 * canvas.height), onScreen: Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 });
  });
  const notes = [];
  scene.getObjectByName('sheet:under')?.traverseVisible(object => {
    if (!object.name.startsWith('knowledge-point:')) return;
    const p = object.getWorldPosition(new V()).project(camera);
    notes.push({ id: object.userData.id, home: object.userData.home, opacity: object.userData.opacity, x: (p.x + 1) / 2 * canvas.width, y: (1 - p.y) / 2 * canvas.height });
  });
  const links = name => { const line = scene.getObjectByName(name); let seen = false; line?.traverseAncestors(a => { seen ||= !a.visible; }); return line?.visible && !seen ? line.userData.links : 0; };
  // The fill an island draws (its ground, depth and sides), as against its coast line alone.
  let filled = 0, coasts = 0;
  scene.traverseVisible(object => { if (['island-ground', 'island-depth', 'island-side'].includes(object.name)) filled++; if (object.name.startsWith('island-coast')) coasts++; });
  const names = [...document.querySelectorAll('.planet-nameplate:not(.capability)')].filter(el => getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0).length;
  return {
    mode: document.querySelector('.forest-globe')?.parentElement?.dataset.forestMode ?? document.querySelector('[data-forest-mode]')?.dataset.forestMode ?? null,
    pressed: Object.fromEntries([...document.querySelectorAll('[data-globe-switch]')].map(b => [b.dataset.globeSwitch, b.getAttribute('aria-pressed')])),
    facing: islands.length ? Math.round(islands.reduce((sum, i) => sum + i.facing, 0) / islands.length * 1000) / 1000 : null,
    zoomPxPerUnit: Math.round(camera.zoom * 1000) / 1000,
    islands: islands.length, islandsOnScreen: islands.filter(i => i.onScreen).length, namesShown: names,
    notes: notes.length, shelved: notes.filter(n => n.home !== null).length, pooled: notes.filter(n => n.home === null).length,
    quietNotes: notes.filter(n => n.opacity < 0.3).length,
    links: links('knowledge-links'), filled, coasts,
    selected: document.body.dataset.selected ?? null,
    perIsland: islands, perNote: notes,
  };
});

await withCapture({ folder: here, dist }, async ({ browser, origin, out, settle }) => {
  const results = {};
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, colorScheme: 'dark' });

  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
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
  // The teaching cards (one at a time, as each part is first met) sit over the sheet and its buttons; they are not the subject.
  await page.evaluate(() => {
    const hide = () => { for (const card of document.querySelectorAll('.teaching-card')) card.style.display = 'none'; };
    hide();
    new MutationObserver(hide).observe(document.body, { childList: true, subtree: true });
  });
  const shoot = async name => {
    await page.mouse.move(2, 2);
    await settle(page, 30);
    await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 180000 });
    results[name] = await measure(page);
    const { perIsland, perNote, ...summary } = results[name];
    console.log(name, JSON.stringify(summary));
  };
  const turnedTo = facing => page.waitForFunction(want => {
    const { scene, camera } = window.__globe, V = camera.position.constructor, Q = camera.quaternion.constructor;
    const island = scene.getObjectByName('sheet:glass');
    const up = new V(0, 0, 1).applyQuaternion(island.parent.getWorldQuaternion(new Q())).dot(new V(0, 0, 1).applyQuaternion(camera.quaternion));
    return Math.abs(up - want) < 0.02;
  }, facing, { timeout: 30000, polling: 100 });

  await shoot('sheet-top');
  const top = results['sheet-top'];
  assert.ok(Math.abs(top.facing - resting) < 0.01, `the sheet opens on its top face, at the tilt (${top.facing})`);
  assert.deepEqual(top.pressed, { stories: 'true', library: 'false' }, 'a launch opens on the Stories face');
  assert.deepEqual([top.notes, top.links], [0, 0], 'the Stories face shows no knowledge (D1)');
  assert.ok(top.filled > 0, 'and its islands are solid');

  await page.locator('[data-globe-switch="library"]').click();
  await turnedTo(-resting);
  await shoot('sheet-underside');
  const under = results['sheet-underside'];
  assert.deepEqual(under.pressed, { stories: 'false', library: 'true' }, 'one face pressed at a time');
  assert.ok(under.notes > 0 && under.pooled > 0, 'the Library face draws the hung notes and the pool (D4)');
  assert.deepEqual([under.filled, under.links], [0, 0], 'its islands are hollow, and no links show at rest (D2, D3)');
  assert.ok(under.coasts > 0 && under.namesShown > 0, 'each island keeps its outline and its name');

  // Back to Stories, select a story by a real click on its island, and turn over again: it stays selected, its links lit.
  await page.locator('[data-globe-switch="stories"]').click();
  await turnedTo(resting);
  await settle(page, 10);
  const story = 'story_d754d997f22a' in Object.fromEntries(top.perIsland.map(i => [i.story, 1])) ? 'story_d754d997f22a' : top.perIsland.find(i => i.onScreen).story;
  const at = (await measure(page)).perIsland.find(i => i.story === story);
  const box = await page.locator('canvas').first().boundingBox();
  await page.mouse.click(box.x + at.x, box.y + at.y);
  await page.waitForFunction(want => document.body.dataset.selected === want, story, { timeout: 30000 });
  await shoot('sheet-top-selected');
  assert.deepEqual([results['sheet-top-selected'].notes, results['sheet-top-selected'].links], [0, 0], 'a selection shows no knowledge on the Stories face');
  await page.locator('[data-globe-switch="library"]').click();
  await turnedTo(-resting);
  await shoot('sheet-underside-selected');
  const lit = results['sheet-underside-selected'];
  assert.equal(lit.selected, story, 'the selected story stays selected across the turn');
  assert.ok(lit.links > 0 && lit.quietNotes > 0, 'its links are drawn, lit, and the rest of the notes quieter');
  assert.deepEqual(errors, []);
  const slim = Object.fromEntries(Object.entries(results).map(([name, { perNote, ...rest }]) => [name, rest]));
  writeFileSync(path.join(out, 'measurements.json'), JSON.stringify({ viewport, seed: seed.stats, results: slim }, null, 1) + '\n');
});
