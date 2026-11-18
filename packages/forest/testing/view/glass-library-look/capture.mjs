import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureSeed, fakeBridge, withCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { SHEET_TILT } from '@storytree/forest-world/planet';

const smoke = process.argv.includes('--smoke');
const started = performance.now();
const phase = message => console.error(`[library-look +${Math.round(performance.now() - started)} ms] ${message}`);
const STILL_FRAMES = 12, STILL_CAP_MS = 60_000;
const resting = Math.round(SHEET_TILT * 1800 / Math.PI) / 10;
const PER_DEGREE = 600 / 180;
const TILTS = [{ name: 'above', deg: resting }, { name: 'side-on', deg: 85 }, { name: 'below', deg: 180 - resting }];

const here = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.join(here, '../../../src/view/evidence', 'glass-library-look');
const dist = buildFolder(here, ...(smoke ? ['smoke'] : []));
const { seed, survey } = captureSeed('code-rows');
const viewport = { width: 1440, height: 960 };
await buildCapture({ dist });

const measure = page => page.evaluate(() => {
  const { scene, camera } = window.__globe, V = camera.position.constructor, Q = camera.quaternion.constructor;
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const glass = scene.getObjectByName('sheet:glass');
  const round = elements => [...elements].map(x => Math.round(x * 1e4) / 1e4);
  let notes = 0, hung = 0, filled = 0, coasts = 0;
  const under = scene.getObjectByName('sheet:under');
  if (under?.visible) under.traverseVisible(object => { if (object.name.startsWith('knowledge-point:')) notes++; });
  under?.traverse(object => { if (object.name.startsWith('knowledge-point:')) hung++; });
  scene.traverseVisible(object => { if (['island-ground', 'island-side'].includes(object.name)) filled++; if (object.name.startsWith('island-coast')) coasts++; });
  return {
    eye: round(camera.matrixWorld.elements), lens: [camera.fov, camera.zoom], sheet: round(glass.parent.matrixWorld.elements),
    tiltDeg: Math.round(new V(0, 0, 1).applyQuaternion(glass.parent.getWorldQuaternion(new Q())).angleTo(new V(0, 0, 1).applyQuaternion(camera.quaternion)) * 1800 / Math.PI) / 10,
    pressed: Object.fromEntries([...document.querySelectorAll('[data-globe-switch]')].map(b => [b.dataset.globeSwitch, b.getAttribute('aria-pressed')])),
    pane: Math.round([scene.getObjectByName('sheet:pane').material].flat()[0].opacity * 100) / 100,
    notesShown: notes, notesHung: hung, filled, coasts,
  };
});

const { results: summary, opening, out } = await withCapture({ folder: evidence, dist }, async ({ browser, origin, out, settle }) => {
  const errors = [];
  const copy = value => structuredClone(value);
  const openOn = async tree => {
    phase(`open a page on ${tree.stories.length} stories`);
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1, colorScheme: 'dark' });
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const bridge = fakeBridge({
      projectSelection: async () => ({ projects: seed.projects, current: 'storytree' }),
      chooseProject: async () => ({ projects: seed.projects, current: 'storytree' }),
      listProjects: async () => copy(seed.projects), projectTree: async () => copy(tree),
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
    }, tree.stories.map(s => s.id), { timeout: 180000 });
    for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
    return page;
  };
  const page = await openOn(seed.tree);
  const box = await page.locator('canvas').first().boundingBox();
  const tiltBy = async by => {
    const x = box.x + box.width / 2, y = box.y + box.height / 2, steps = Math.max(1, Math.ceil(Math.abs(by) / 5));
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'right' });
    for (let k = 1; k <= steps; k++) await page.mouse.move(x, y - by * PER_DEGREE * k / steps);
    await page.mouse.up({ button: 'right' });
  };
  const still = async (on, what, atLeast = 0) => {
    phase(`wait for the eye and the sheet to hold still: ${what}`);
    const held = await on.evaluate(async ({ atLeast, frames, capMs }) => {
      const from = performance.now();
      let last, run = 0, drawn = 0;
      for (;;) {
        window.__globe.invalidate();
        await new Promise(requestAnimationFrame);
        drawn++;
        const { scene, camera } = window.__globe;
        scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
        const now = JSON.stringify([[...camera.matrixWorld.elements], camera.fov, camera.zoom, [...scene.getObjectByName('sheet:glass').parent.matrixWorld.elements]]);
        run = now === last ? run + 1 : 0;
        last = now;
        if (run >= frames && performance.now() - from >= atLeast) return { ok: true, drawn };
        if (performance.now() - from > capMs) return { ok: false, drawn };
      }
    }, { atLeast, frames: STILL_FRAMES, capMs: STILL_CAP_MS });
    if (!held.ok) throw new Error(`${what}: the eye or the sheet was still moving after ${STILL_CAP_MS} ms (${held.drawn} frames drawn)`);
  };
  const press = async (which, on = page) => {
    phase(`press ${which}`);
    await on.locator(`[data-globe-switch="${which}"]`).click();
    if (which === 'library') {
      phase('wait for the notes to hang beneath the glass');
      await on.waitForFunction(() => { let n = 0; window.__globe.scene.getObjectByName('sheet:under')?.traverse(o => { if (o.name.startsWith('knowledge-point:')) n++; }); return n > 0; }, undefined, { timeout: 180000 });
    }
    await on.mouse.move(2, 2);
    await settle(on, 12);
    await still(on, `${which} pressed`, 1200);
  };
  const shoot = async (name, on = page) => { if (!smoke) await on.screenshot({ path: path.join(out, `${name}.png`), timeout: 180000 }); };

  const results = {};
  phase('wait for every island to be laid out');
  await page.waitForFunction(() => !document.body.innerText.includes('laying out'), undefined, { timeout: 180000 });
  await settle(page, 12);
  await still(page, 'the opening');
  const opened = await measure(page);
  assert.deepEqual(opened.pressed, { stories: 'true', library: 'false' }, 'it opens on Stories');
  assert.ok(Math.abs(opened.tiltDeg) < 1.5, `it opens looking straight down (${opened.tiltDeg}°)`);
  await shoot('opening');
  await press('library');
  const tilted = await measure(page);
  await shoot('library-from-opening');
  assert.ok(Math.abs(tilted.tiltDeg - resting) < 1.5, `Library from straight down brings in the tabletop tilt (${tilted.tiltDeg}°, wanted ${resting}°)`);
  assert.deepEqual([tilted.eye, tilted.lens], [opened.eye, opened.lens], 'the eye stays where it was: the sheet tilts under it');
  await press('stories');
  const kept = await measure(page);
  await shoot('stories-again');
  assert.deepEqual([kept.eye, kept.lens, kept.sheet], [tilted.eye, tilted.lens, tilted.sheet], 'pressing Stories leaves the eye and the sheet where they were');
  results.opening = { tiltDeg: opened.tiltDeg, library: tilted.tiltDeg, stories: kept.tiltDeg };
  let at = kept.tiltDeg;
  for (const { name, deg } of TILTS) {
    phase(`tilt by hand to ${name} (${deg}°)`);
    await tiltBy(deg - at);
    await page.mouse.move(2, 2);
    await settle(page, 12);
    await still(page, `tilted ${name}`);
    const stories = await measure(page);
    at = stories.tiltDeg;
    assert.ok(Math.abs(stories.tiltDeg - deg) < 1.5, `${name}: tilted by hand to ${stories.tiltDeg}° (wanted ${deg}°)`);
    await shoot(`stories-${name}`);
    await press('library');
    const library = await measure(page);
    await shoot(`library-${name}`);
    await press('stories');
    const back = await measure(page);
    for (const [after, label] of [[library, 'Library'], [back, 'Stories again']]) {
      assert.deepEqual([after.eye, after.lens, after.sheet], [stories.eye, stories.lens, stories.sheet], `${name}: pressing ${label} leaves the eye and the sheet where they were`);
    }
    assert.deepEqual(library.pressed, { stories: 'false', library: 'true' }, `${name}: Library is pressed, whatever the tilt`);
    assert.deepEqual(back.pressed, { stories: 'true', library: 'false' }, `${name}: Stories is pressed again, whatever the tilt`);
    assert.ok(library.pane < stories.pane / 3, `${name}: Library clears the glass (${library.pane} against ${stories.pane})`);
    assert.ok(library.filled === 0 && library.coasts > 0, `${name}: in Library every island is an outline (${library.filled} filled, ${library.coasts} coasts)`);
    assert.ok(library.notesShown > 0, `${name}: in Library the graph beneath shows`);
    assert.ok(back.filled > 0 && back.pane === stories.pane, `${name}: Stories brings back smoked glass and solid islands`);
    assert.equal(stories.notesHung, 0, `${name}: on Stories no note hangs beneath the glass, shown or not (ADR-1340 D1)`);
    assert.equal(back.notesHung, 0, `${name}: pressing Stories again lets the notes go (ADR-1340 D1)`);
    results[name] = { tiltDeg: stories.tiltDeg, stories: look(stories), library: look(library) };
  }
  const bare = await openOn({ stories: [], arcs: [] });
  await press('library', bare);
  const bareOpened = await measure(bare);
  await shoot('bare-library', bare);
  assert.ok(Math.abs(bareOpened.tiltDeg - resting) < 1.5, `an island-less sheet's Library press brings in the tabletop tilt (${bareOpened.tiltDeg}°, wanted ${resting}°)`);
  assert.ok(bareOpened.notesShown > 0, 'its notes show through the clear glass');
  assert.deepEqual(errors, []);
  const { opening, ...tilts } = results;
  return { results: tilts, opening: { ...opening, bareLibrary: bareOpened.tiltDeg }, out };
});

function look({ pressed, pane, notesShown, notesHung, filled, coasts }) {
  return { pressed: pressed.library === 'true' ? 'library' : 'stories', pane, notesShown, notesHung, filled, coasts };
}

if (smoke) console.log(JSON.stringify({ opening: { straightDown: Math.abs(opening.tiltDeg) < 1.5, library: Math.abs(opening.library - resting) < 1.5, stories: Math.abs(opening.stories - resting) < 1.5, bareLibrary: Math.abs(opening.bareLibrary - resting) < 1.5 }, unmoved: Object.keys(summary), looks: Object.fromEntries(Object.entries(summary).map(([name, r]) => [name, { stories: r.stories.filled > 0, library: r.library.filled === 0 }])),
  notes: Object.fromEntries(Object.entries(summary).map(([name, r]) => [name, { stories: r.stories.notesHung, library: r.library.notesHung > 0 }])) }));
else writeFileSync(path.join(out, 'measurements.json'), JSON.stringify({ viewport, seed: 'code-rows', opening, results: summary }, null, 1) + '\n');
