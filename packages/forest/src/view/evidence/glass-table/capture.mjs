// The glass sheet as a floating 3D table the user tilts (increment_9922ecd7a56a, ADR-1062): a lit slab seen in perspective,
// tilted by hand from looking down on the islands, through edge-on with the knowledge graph hanging below, to looking up at
// it. Drawn by the actual desktop page from the same read-only snapshot of storytree's own library as ../glass-sheet-tilt/
// (branch spike/glass-sheet's seed.json.gz and survey.json, kept out of this repository for its size). Every tilt is a real
// right-drag of the mouse, a real key press or a real press of the Stories or Library button; the selection a real click on
// an island. Run from the checkout root, in the foreground:
//   node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/glass-table/capture.mjs <seed folder> --retake
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts';
import { SHEET_TILT } from '@storytree/forest-world/planet';

const degrees = radians => Math.round(radians * 1800 / Math.PI) / 10;
const resting = degrees(SHEET_TILT);
/** CSS pixels of a rotating drag up the window per degree of tilt (TILT_PER_PIXEL is π/600 radians). */
const PER_DEGREE = 600 / 180;

const here = path.dirname(fileURLToPath(import.meta.url));
const from = process.argv.slice(2).find(arg => !arg.startsWith('--'));
if (from === undefined) throw new Error('Name the folder holding the snapshot (seed.json.gz and survey.json).');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(from, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(from, 'survey.json'), 'utf8'));
const dist = path.join(here, 'dist');
const viewport = { width: 1440, height: 960 };
await buildCapture({ dist });

/** What the eye sees now: the tilt, the lens, which button is pressed, the islands, and the knowledge under the glass. */
const measure = page => page.evaluate(() => {
  const { scene, camera } = window.__globe, V = camera.position.constructor, Q = camera.quaternion.constructor;
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const eye = new V(0, 0, 1).applyQuaternion(camera.quaternion);
  const canvas = document.querySelector('canvas').getBoundingClientRect();
  const glass = scene.getObjectByName('sheet:glass');
  const up = new V(0, 0, 1).applyQuaternion(glass.parent.getWorldQuaternion(new Q()));
  const islands = [];
  scene.traverse(object => {
    if (!object.name.startsWith('planet:story_')) return;
    const p = object.getWorldPosition(new V()).project(camera);
    islands.push({ story: object.name.slice(7), x: Math.round((p.x + 1) / 2 * canvas.width), y: Math.round((1 - p.y) / 2 * canvas.height), onScreen: Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 });
  });
  let notes = 0;
  const under = scene.getObjectByName('sheet:under');
  if (under?.visible) under.traverseVisible(object => { if (object.name.startsWith('knowledge-point:')) notes++; });
  const links = scene.getObjectByName('knowledge-links');
  let filled = 0, coasts = 0;
  scene.traverseVisible(object => { if (['island-ground', 'island-side'].includes(object.name)) filled++; if (object.name.startsWith('island-coast')) coasts++; });
  const distance = camera.position.length() - glass.position.z;
  return {
    tiltDeg: Math.round(up.angleTo(eye) * 1800 / Math.PI) / 10,
    // The sheet's upright axis on the window: 0 when it points straight up the window (no roll).
    // The sheet's upright axis at the middle of the view, on the window: 0 when it points straight up the window (no roll).
    rollDeg: (() => {
      const middle = camera.position.clone().setLength(glass.position.z), a = middle.clone().project(camera), b = middle.clone().add(up.clone().multiplyScalar(50)).project(camera);
      return up.angleTo(eye) < Math.PI / 180 ? 0 : Math.round(Math.atan2(b.x - a.x, b.y - a.y) * 1800 / Math.PI) / 10;
    })(),
    perspective: camera.isPerspectiveCamera === true, fovDeg: camera.fov ?? null,
    zoomPxPerUnit: Math.round(canvas.height / 2 / Math.tan(camera.fov * Math.PI / 360) / distance * 1000) / 1000,
    pressed: Object.fromEntries([...document.querySelectorAll('[data-globe-switch]')].map(b => [b.dataset.globeSwitch, b.getAttribute('aria-pressed')])),
    islandsOnScreen: islands.filter(i => i.onScreen).length,
    notesShown: notes, links: links?.visible ? links.userData.links ?? 0 : 0, filled, coasts,
    lights: (() => { let n = 0; scene.traverse(o => { if (o.isLight) n++; }); return n; })(),
    selected: document.body.dataset.selected ?? null,
    perIsland: islands,
  };
});

await withCapture({ folder: here, dist }, async ({ browser, origin, out, settle }) => {
  const results = {};
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, colorScheme: 'dark' });
  // The page's clock, held and stepped for the swing a grab stops, so a slow software renderer cannot outrun the grab.
  await page.addInitScript(() => {
    const real = performance.now.bind(performance);
    let held, behind = 0;
    performance.now = () => held ?? real() - behind;
    window.__holdClock = () => { held = real() - behind; };
    window.__stepClock = ms => { held += ms; };
    window.__releaseClock = () => { if (held !== undefined) { behind = real() - held; held = undefined; } };
  });
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
  const unfocus = () => page.evaluate(() => document.activeElement?.blur?.());
  const shoot = async name => {
    await page.mouse.move(2, 2);
    await settle(page, 30);
    await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 180000 });
    results[name] = await measure(page);
    const { perIsland, ...summary } = results[name];
    console.log(name, JSON.stringify(summary));
  };
  const box = await page.locator('canvas').first().boundingBox();
  /** A right-drag up the window by `by` degrees of tilt (down for a negative `by`), in small steps, from the middle of the window. */
  const tiltBy = async by => {
    const x = box.x + box.width / 2, y = box.y + box.height / 2, steps = Math.max(1, Math.ceil(Math.abs(by)));
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'right' });
    for (let k = 1; k <= steps; k++) await page.mouse.move(x, y - by * PER_DEGREE * k / steps);
    await page.mouse.up({ button: 'right' });
  };
  const tiltedTo = want => page.waitForFunction(want => {
    const { scene, camera } = window.__globe, V = camera.position.constructor, Q = camera.quaternion.constructor;
    const glass = scene.getObjectByName('sheet:glass');
    const tilt = new V(0, 0, 1).applyQuaternion(glass.parent.getWorldQuaternion(new Q())).angleTo(new V(0, 0, 1).applyQuaternion(camera.quaternion)) * 180 / Math.PI;
    return Math.abs(tilt - want) < 0.5;
  }, want, { timeout: 30000, polling: 100 });

  // The top resting view: a perspective, lit slab; no knowledge shows from well above (ADR-1061 D1 holds there).
  await shoot('table-top');
  const top = results['table-top'];
  assert.ok(top.perspective && top.lights >= 2, 'a perspective eye on a lit scene (D1)');
  assert.ok(Math.abs(top.tiltDeg - resting) < 0.5, `it opens at the top resting tilt (${top.tiltDeg}°)`);
  assert.deepEqual(top.pressed, { stories: 'true', library: 'false' });
  assert.equal(top.notesShown, 0, 'from well above the smoked glass hides the graph (D4)');

  // R and F tilt a step at a time, and never past straight down.
  await unfocus();
  await page.keyboard.press('f');
  await tiltedTo(resting + 15);
  for (let k = 0; k < 6; k++) await page.keyboard.press('r');
  await tiltedTo(0);
  results.keys = await measure(page);
  assert.ok(results.keys.tiltDeg < 0.5, `R stops at straight down (${results.keys.tiltDeg}°, the big sphere bending the rest)`);
  await page.keyboard.press('Home');
  await tiltedTo(resting);
  await page.waitForTimeout(800);

  // A part-way tilt, then edge-on, each by a real right-drag up the window: the graph comes into view below the slab.
  await tiltBy(65 - resting);
  await shoot('table-part-way');
  const part = results['table-part-way'];
  assert.ok(Math.abs(part.tiltDeg - 65) < 1 && part.notesShown > 0 && part.filled > 0, `part-way (${part.tiltDeg}°) the islands stand on the glass and the graph shows below it`);
  await tiltBy(86 - 65);
  await shoot('table-edge-on');
  const edge = results['table-edge-on'];
  assert.ok(Math.abs(edge.tiltDeg - 86) < 1 && edge.notesShown > 0 && edge.filled > 0, `edge-on (${edge.tiltDeg}°) both layers show`);
  assert.ok(Math.abs(edge.rollDeg) < 0.5, `and the slab never rolls (${edge.rollDeg}°)`);
  assert.deepEqual(edge.pressed, { stories: 'true', library: 'false' }, 'still above the glass, Stories stays pressed');

  // Library swings to the resting view from below, over 0.9 s; a grab two-thirds of the way, past level, stops it there.
  await page.evaluate(() => window.__holdClock());
  await page.locator('[data-globe-switch="library"]').click();
  await settle(page, 4);
  await page.evaluate(() => window.__stepClock(600));
  await settle(page, 4);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'right' });
  const grabbed = (await measure(page)).tiltDeg;
  await page.evaluate(() => window.__stepClock(600));
  await settle(page, 4);
  const held = (await measure(page)).tiltDeg;
  await page.mouse.up({ button: 'right' });
  await page.evaluate(() => window.__releaseClock());
  results.grab = { grabbedDeg: grabbed, afterDeg: held };
  assert.ok(grabbed > 86 && grabbed < 180 - resting - 1 && Math.abs(held - grabbed) < 0.2, `a grab mid-swing (${grabbed}°) holds it there (${held}°)`);
  await page.locator('[data-globe-switch="stories"]').click();
  await tiltedTo(resting);
  await page.locator('[data-globe-switch="library"]').click();
  await tiltedTo(180 - resting);
  await shoot('table-underside');
  const under = results['table-underside'];
  assert.deepEqual(under.pressed, { stories: 'false', library: 'true' }, 'from below, Library is pressed');
  assert.ok(under.notesShown > 0 && under.filled === 0 && under.coasts > 0, 'the graph shows, the islands only as see-through outlines (D4)');
  assert.equal(under.links, 0, 'and no links with nothing selected');

  // Back up to the top by a hand's tilt (Stories follows it past level), select a story by a real click, and see it at each view.
  await tiltBy(-(180 - 2 * resting));
  await tiltedTo(resting);
  assert.deepEqual((await measure(page)).pressed, { stories: 'true', library: 'false' }, 'tilted back above the glass by hand, Stories is pressed');
  await settle(page, 10);
  const opened = await measure(page);
  const story = opened.perIsland.find(i => i.story === 'story_d754d997f22a' && i.onScreen) ? 'story_d754d997f22a' : opened.perIsland.find(i => i.onScreen && i.x > 300 && i.x < 1100 && i.y > 200 && i.y < 760).story;
  const at = opened.perIsland.find(i => i.story === story);
  await page.mouse.click(box.x + at.x, box.y + at.y);
  await page.waitForFunction(want => document.body.dataset.selected === want, story, { timeout: 30000 });
  await shoot('table-top-selected');
  await tiltBy(65 - resting);
  await shoot('table-part-way-selected');
  await tiltBy(86 - 65);
  await shoot('table-edge-on-selected');
  assert.ok(results['table-edge-on-selected'].links > 0, 'edge-on, the selected story\'s links show');
  await page.locator('[data-globe-switch="library"]').click();
  await tiltedTo(180 - resting);
  await shoot('table-underside-selected');
  for (const name of ['table-top-selected', 'table-part-way-selected', 'table-edge-on-selected', 'table-underside-selected']) assert.equal(results[name].selected, story, `${name}: the story stays selected at every tilt`);

  // The frame strip: one continuous right-drag from straight down on the islands to straight up at the graph, with nothing
  // selected, so no panel covers it.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.body.dataset.selected, undefined, { timeout: 30000 });
  await page.keyboard.press('Home');
  await tiltedTo(resting);
  await page.waitForTimeout(800);
  await page.mouse.move(2, 2);
  await settle(page, 10);
  const frames = [];
  const x = box.x + box.width / 2, y0 = box.y + box.height / 2 + 300;
  await page.mouse.move(x, y0);
  await page.mouse.down({ button: 'right' });
  // Down by the resting tilt first, to straight down; then up the window in steps of 20 degrees to straight up.
  for (let k = 1; k <= 10; k++) await page.mouse.move(x, y0 + resting * PER_DEGREE * k / 10);
  let pointer = y0 + resting * PER_DEGREE;
  for (let frame = 0; frame <= 9; frame++) {
    if (frame > 0) for (let k = 1; k <= 10; k++) await page.mouse.move(x, pointer - 20 * PER_DEGREE * k / 10);
    if (frame > 0) pointer -= 20 * PER_DEGREE;
    await settle(page, 4);
    const file = `strip-${String(frame).padStart(2, '0')}.png`;
    await page.screenshot({ path: path.join(out, file), timeout: 180000 });
    frames.push({ file, tilt: (await measure(page)).tiltDeg });
  }
  await page.mouse.up({ button: 'right' });
  assert.deepEqual(frames.map(f => Math.round(f.tilt)), [0, 20, 40, 60, 80, 100, 120, 140, 160, 180], 'one tilt, top to bottom, in even steps');
  const strip = await browser.newPage({ viewport: { width: 5 * 288 + 6 * 8, height: 2 * (192 + 26) + 3 * 8 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const row = list => list.map(f => `<figure><img src="data:image/png;base64,${readFileSync(path.join(out, f.file)).toString('base64')}"><figcaption>tilted ${f.tilt}° from straight down</figcaption></figure>`).join('');
  await strip.setContent(`<style>body{margin:0;background:#0d1419;color:#e6ecf0;font:13px system-ui;padding:8px;display:grid;gap:8px}div{display:flex;gap:8px}figure{margin:0}img{width:288px;height:192px;display:block}figcaption{height:22px;padding-top:4px}</style><div>${row(frames.slice(0, 5))}</div><div>${row(frames.slice(5))}</div>`);
  await strip.screenshot({ path: path.join(out, 'tilt-frames.png') });
  await strip.close();
  for (const f of frames) rmSync(path.join(out, f.file));

  assert.deepEqual(errors, []);
  const slim = Object.fromEntries(Object.entries({ ...results, strip: { frames: frames.map(f => f.tilt) } }).map(([name, { perIsland, ...rest }]) => [name, rest]));
  writeFileSync(path.join(out, 'measurements.json'), JSON.stringify({ viewport, seed: seed.stats, results: slim }, null, 1) + '\n');
});
