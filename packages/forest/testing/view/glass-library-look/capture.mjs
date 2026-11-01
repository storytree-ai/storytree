// The glass sheet's Library and Stories buttons change only the look, never the eye (increment_30faf3e3c7fb, ADR-1062 D3 as
// the owner amended it: "clicking the library button should just make the glass see through and the islands turn transparent
// and just show their outline. the user controls the rotation not the buttons."). Drawn by the actual desktop page from the
// capture kit's `code-rows` seed, storytree's own library. At three tilts the user gave by a real right-drag (from above, side
// on, from below), a real press of Library and then of Stories each leaves the eye and the sheet exactly where they were,
// while the glass clears and the islands become outlines, and back. Run from the checkout root, in the foreground:
//   node ~/.storytree/your-factory/plugins/micks-dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/testing/view/glass-library-look/capture.mjs --retake
// With --smoke it takes no pictures and prints one line of JSON for the real-browser test (3.55).
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureSeed, fakeBridge, withCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { SHEET_TILT } from '@storytree/forest-world/planet';

const smoke = process.argv.includes('--smoke');
const resting = Math.round(SHEET_TILT * 1800 / Math.PI) / 10;
/** CSS pixels of a rotating drag up the window per degree of tilt (TILT_PER_PIXEL is π/600 radians). */
const PER_DEGREE = 600 / 180;
/** The three tilts, in degrees from straight down: the opening view from above, side on, and from below. */
const TILTS = [{ name: 'above', deg: resting }, { name: 'side-on', deg: 85 }, { name: 'below', deg: 180 - resting }];

const here = path.dirname(fileURLToPath(import.meta.url));
// Pictures and measurements go to the package's evidence set of this name (a scratch folder unless --retake); nothing here reads them.
const evidence = path.join(here, '../../../src/view/evidence', 'glass-library-look');
const dist = buildFolder(here, ...(smoke ? ['smoke'] : []));
const { seed, survey } = captureSeed('code-rows');
const viewport = { width: 1440, height: 960 };
await buildCapture({ dist });

/** Where the eye and the sheet are (the camera's and the sheet's whole placement, to 1e-4), what is pressed, and the look. */
const measure = page => page.evaluate(() => {
  const { scene, camera } = window.__globe, V = camera.position.constructor, Q = camera.quaternion.constructor;
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const glass = scene.getObjectByName('sheet:glass');
  const round = elements => [...elements].map(x => Math.round(x * 1e4) / 1e4);
  let notes = 0, filled = 0, coasts = 0;
  const under = scene.getObjectByName('sheet:under');
  if (under?.visible) under.traverseVisible(object => { if (object.name.startsWith('knowledge-point:')) notes++; });
  scene.traverseVisible(object => { if (['island-ground', 'island-side'].includes(object.name)) filled++; if (object.name.startsWith('island-coast')) coasts++; });
  return {
    eye: round(camera.matrixWorld.elements), lens: [camera.fov, camera.zoom], sheet: round(glass.parent.matrixWorld.elements),
    tiltDeg: Math.round(new V(0, 0, 1).applyQuaternion(glass.parent.getWorldQuaternion(new Q())).angleTo(new V(0, 0, 1).applyQuaternion(camera.quaternion)) * 1800 / Math.PI) / 10,
    pressed: Object.fromEntries([...document.querySelectorAll('[data-globe-switch]')].map(b => [b.dataset.globeSwitch, b.getAttribute('aria-pressed')])),
    pane: Math.round([scene.getObjectByName('sheet:pane').material].flat()[0].opacity * 100) / 100,
    notesShown: notes, filled, coasts,
  };
});

const { results: summary, out } = await withCapture({ folder: evidence, dist }, async ({ browser, origin, out, settle }) => {
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
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.getObjectByName('sheet:under')?.traverse(o => { if (o.name.startsWith('knowledge-point:')) n++; }); return n > 0; }, undefined, { timeout: 180000 });
  for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  const box = await page.locator('canvas').first().boundingBox();
  /** A right-drag up the window by `by` degrees of tilt (down for a negative `by`), in small steps, from the middle of the window. */
  const tiltBy = async by => {
    const x = box.x + box.width / 2, y = box.y + box.height / 2, steps = Math.max(1, Math.ceil(Math.abs(by)));
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'right' });
    for (let k = 1; k <= steps; k++) await page.mouse.move(x, y - by * PER_DEGREE * k / steps);
    await page.mouse.up({ button: 'right' });
  };
  /** Press a button, then wait past the 0.9 s the old swing took, so an eye that moved would be caught where it went. */
  const press = async which => {
    await page.locator(`[data-globe-switch="${which}"]`).click();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(1200);
    await settle(page, 12);
  };
  const shoot = async name => { if (!smoke) await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 180000 }); };

  const results = {};
  const opened = await measure(page);
  assert.deepEqual(opened.pressed, { stories: 'true', library: 'false' }, 'it opens on Stories');
  let at = opened.tiltDeg;
  for (const { name, deg } of TILTS) {
    await tiltBy(deg - at);
    await page.mouse.move(2, 2);
    await settle(page, 12);
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
    if (name === 'above') assert.equal(stories.notesShown, 0, 'from well above, the smoked glass hides the graph (D4)');
    else assert.ok(stories.notesShown > 0, `${name}: tilted toward level or below, the graph shows in Stories too (D4)`);
    results[name] = { tiltDeg: stories.tiltDeg, stories: look(stories), library: look(library) };
  }
  assert.deepEqual(errors, []);
  return { results, out };
});

function look({ pressed, pane, notesShown, filled, coasts }) {
  return { pressed: pressed.library === 'true' ? 'library' : 'stories', pane, notesShown, filled, coasts };
}

if (smoke) console.log(JSON.stringify({ unmoved: Object.keys(summary), looks: Object.fromEntries(Object.entries(summary).map(([name, r]) => [name, { stories: r.stories.filled > 0, library: r.library.filled === 0 }])) }));
else writeFileSync(path.join(out, 'measurements.json'), JSON.stringify({ viewport, seed: 'code-rows', results: summary }, null, 1) + '\n');
