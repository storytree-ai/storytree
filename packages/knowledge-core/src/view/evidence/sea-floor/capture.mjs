// Under the glass each note is pulled toward every island its links reach, and notes with no links lie on a sea floor
// (increment_80d5beb81cff, ADR-1063 D6). Drawn by the actual desktop page from the capture kit's `code-rows` seed, storytree's
// own library, on the Library look at the same three tilts as `packages/forest/src/view/evidence/glass-library-look/`, whose
// library-*.png are the before pictures (the pool along the south edge). One note that sits between two islands is ringed.
// Run from the checkout root, in the foreground:
//   node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/knowledge-core/src/view/evidence/sea-floor/capture.mjs --retake
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, captureSeed, fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts';
import { knowledge, underShelves } from '@storytree/knowledge-core';
import { HIDDEN_AT_START } from '../../../kinds/kinds.ts';

/** CSS pixels of a rotating drag up the window per degree of tilt (TILT_PER_PIXEL is π/600 radians). */
const PER_DEGREE = 600 / 180;
/** The three tilts, from the resting tilt the sheet opens at: from above, side on, and its mirror from below. */
const tilts = resting => [{ name: 'above', deg: resting }, { name: 'side-on', deg: 85 }, { name: 'below', deg: 180 - resting }];

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
const { seed, survey } = captureSeed('code-rows');
const viewport = { width: 1440, height: 960 };

// Before: the notes no shelf reaches, which lay in the pool along the south edge (shelves' reach is unchanged, ADR-1063).
const known = knowledge(seed.changes.changes);
const outside = underShelves(seed.changes.changes, known).outside;
// Every kind, and the kinds drawn when Library opens (re-steers and friction start switched off).
const poolBefore = { all: outside.length, shown: outside.filter(id => !HIDDEN_AT_START.has(known.notes.get(id)?.type)).length };
const storyOf = new Map(seed.tree.stories.flatMap(story => [[story.id, story.id], ...(story.capabilities ?? []).map(capability => [capability.id, story.id])]));
await buildCapture({ dist });

/** What lies under the glass: the notes on show, how many lie on the floor, and the dots with their pulls and window places. */
const measure = page => page.evaluate(() => {
  const { scene, camera } = window.__globe, V = camera.position.constructor;
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const under = scene.getObjectByName('sheet:under'), floor = scene.getObjectByName('knowledge-floor');
  const canvas = document.querySelector('canvas').getBoundingClientRect();
  const dots = [];
  under?.traverseVisible(object => {
    if (!object.name.startsWith('knowledge-point:')) return;
    const at = object.getWorldPosition(new V()).project(camera);
    dots.push({ id: object.userData.id, title: object.userData.title, depth: object.userData.depth, toward: object.userData.toward,
      left: canvas.left + (at.x + 1) / 2 * canvas.width, top: canvas.top + (1 - at.y) / 2 * canvas.height });
  });
  return { notesShown: dots.length, floorNotes: floor?.userData.notes ?? 0, floorDrawn: floor?.visible === true, floorOpacity: floor?.material.opacity ?? null, dots };
});

const { results, between, out } = await withCapture({ folder: here, dist }, async ({ browser, origin, out, settle }) => {
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
  for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  await page.locator('[data-globe-switch="library"]').click();
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.getObjectByName('sheet:under')?.traverseVisible(o => { if (o.name.startsWith('knowledge-point:')) n++; }); return n > 0; }, undefined, { timeout: 180000 });
  await page.mouse.move(2, 2);
  await settle(page, 12);
  const box = await page.locator('canvas').first().boundingBox();
  const tiltBy = async by => {
    const x = box.x + box.width / 2, y = box.y + box.height / 2, steps = Math.max(1, Math.ceil(Math.abs(by)));
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'right' });
    for (let k = 1; k <= steps; k++) await page.mouse.move(x, y - by * PER_DEGREE * k / steps);
    await page.mouse.up({ button: 'right' });
  };
  const tiltOf = () => page.evaluate(() => {
    const { scene, camera } = window.__globe, V = camera.position.constructor, Q = camera.quaternion.constructor;
    const glass = scene.getObjectByName('sheet:glass');
    return Math.round(new V(0, 0, 1).applyQuaternion(glass.parent.getWorldQuaternion(new Q())).angleTo(new V(0, 0, 1).applyQuaternion(camera.quaternion)) * 1800 / Math.PI) / 10;
  });
  /** A ring round one dot and its title, drawn over the page for the picture only, and taken away after. */
  const ring = (dot, label) => page.evaluate(({ dot, label }) => {
    const mark = document.createElement('div');
    mark.id = 'evidence-ring';
    mark.style.cssText = `position:fixed;left:${dot.left - 16}px;top:${dot.top - 16}px;width:32px;height:32px;border:2px solid #ffd166;border-radius:50%;pointer-events:none;z-index:99999`;
    const text = document.createElement('div');
    text.textContent = label;
    text.style.cssText = `position:absolute;left:38px;top:4px;white-space:nowrap;color:#ffd166;font:13px system-ui;background:#000a;padding:2px 6px;border-radius:4px`;
    mark.append(text);
    document.body.append(mark);
  }, { dot, label });
  const unring = () => page.evaluate(() => document.getElementById('evidence-ring')?.remove());

  const results = {};
  let at = await tiltOf(), between;
  for (const { name, deg } of tilts(at)) {
    await tiltBy(deg - at);
    await page.mouse.move(2, 2);
    await settle(page, 12);
    at = await tiltOf();
    assert.ok(Math.abs(at - deg) < 1.5, `${name}: tilted by hand to ${at}° (wanted ${deg}°)`);
    const seen = await measure(page);
    assert.ok(seen.floorDrawn && seen.floorNotes > 0, `${name}: the sea floor is drawn, with notes on it`);
    await page.screenshot({ path: path.join(out, `library-${name}.png`), timeout: 180000 });
    if (name === 'above') {
      // A note whose pulls reach two stories' islands, well inside the window, sits between them.
      const inView = dot => dot.left > 200 && dot.left < viewport.width - 200 && dot.top > 150 && dot.top < viewport.height - 200;
      const found = seen.dots.find(dot => inView(dot) && new Set((dot.toward ?? []).map(shelf => storyOf.get(shelf))).size >= 2);
      assert.ok(found, 'some note is pulled toward two islands');
      const stories = [...new Set(found.toward.map(shelf => storyOf.get(shelf)))].map(id => seed.tree.stories.find(story => story.id === id).title);
      between = { id: found.id, title: found.title, between: stories.slice(0, 2) };
      await ring(found, `${found.title.slice(0, 48)}: between ${stories[0]} and ${stories[1]}`);
      await page.screenshot({ path: path.join(out, 'library-above-between.png'), timeout: 180000 });
      await unring();
    }
    results[name] = { tiltDeg: at, notesShown: seen.notesShown, floorNotes: seen.floorNotes, floorOpacity: seen.floorOpacity,
      hanging: seen.dots.filter(dot => dot.depth !== null).length, floorShown: seen.dots.filter(dot => dot.depth === null).length, pulledByTwoOrMore: seen.dots.filter(dot => (dot.toward ?? []).length >= 2).length };
  }
  assert.deepEqual(errors, []);
  return { results, between, out };
});

writeFileSync(path.join(out, 'measurements.json'), JSON.stringify({ viewport, seed: 'code-rows', poolBefore, between, results }, null, 1) + '\n');
console.log(JSON.stringify({ poolBefore, between, results }));
