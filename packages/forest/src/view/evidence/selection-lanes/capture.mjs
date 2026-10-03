// Seeded headless-Chromium evidence of the selection lanes (forest contract 3.26, world 6.8 / 6.9).
// Same seed, same viewport, same turn every run; the only input is clicks on the real page.
// Run with node --import tsx, in the foreground under the machine's heavy-run lock (see README).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(path.join(here, 'seed.json'), 'utf8'));
const owner = new Map(seed.tree.stories.flatMap(story => story.capabilities.map(cap => [cap.id, story.id])));

// The selected story: the one with the most cross-story links that has both an upstream and a downstream.
const counts = new Map(seed.tree.stories.map(story => [story.id, { up: 0, down: 0 }]));
for (const story of seed.tree.stories) for (const cap of story.capabilities) for (const to of cap.dependsOn) {
  if (owner.get(to) === story.id) continue;
  counts.get(story.id).up++; counts.get(owner.get(to)).down++;
}
const SELECTED = [...counts].filter(([, c]) => c.up > 0 && c.down > 0).sort((a, b) => b[1].up + b[1].down - (a[1].up + a[1].down))[0][0];
const expected = { story: SELECTED, ...counts.get(SELECTED),
  upLinks: seed.tree.stories.find(s => s.id === SELECTED).capabilities.flatMap(cap => cap.dependsOn
    .filter(to => owner.get(to) !== SELECTED).map(to => `${cap.id}->${to}`)).sort(),
  downLinks: seed.tree.stories.filter(s => s.id !== SELECTED).flatMap(s => s.capabilities.flatMap(cap => cap.dependsOn
    .filter(to => owner.get(to) === SELECTED).map(to => `${cap.id}->${to}`))).sort() };

{
  await withCapture({ folder: here, dist: path.join(here, 'dist') }, async ({ browser, origin, out, settle }) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const errors = [], warnings = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => {
      if (!['error', 'warning'].includes(message.type())) return;
      const text = message.text();
      if (message.type() === 'warning' || text.includes('Attempted to synchronously unmount a root')) warnings.push(text);
      else errors.push(text);
    });
    const bridge = fakeBridge({});
    await bridge.install(page);
    process.once('exit', () => console.log('Bridge methods left to the stand-in:', bridge.defaulted.join(', ') || 'none'));
    await page.addInitScript(data => {
      const copy = value => structuredClone(value);
      window.storytreeAnswers = {
        listProjects: async () => copy(data.projects), projectTree: async () => copy(data.tree),
        changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
        linesSince: async (_, cursor) => cursor === 0 ? copy(data.lines) : { lines: [], cursor: data.lines.cursor },
        frontCovers: async () => [], relatedNotes: async () => [],
      };
    }, seed);
    await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(ids => {
      const state = window.__globe;
      if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
      return ids.every(id => {
        const plate = state.scene.getObjectByName(`planet:${id}`);
        let meshes = 0;
        plate?.traverse(mesh => { if (mesh.isMesh && mesh.geometry?.attributes.position?.count > 0) meshes++; });
        return meshes >= 2;
      });
    }, seed.tree.stories.map(story => story.id), { timeout: 180000 });
    for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
    await settle(page);

    // In-page helpers: the lane state, where the lit story and its neighbours sit, and the click time.
    await page.evaluate(() => {
      window.__clickedAt = undefined;
      document.addEventListener('pointerup', () => { window.__clickedAt = performance.now(); }, true);
      window.__lanes = (owners) => {
        const { scene } = window.__globe;
        scene.updateMatrixWorld(true);
        const group = scene.getObjectByName('pathways:selection-lanes');
        const V = scene.position.constructor;
        const plate = id => scene.getObjectByName(`planet:${id}`)?.getWorldPosition(new V());
        const lanes = [];
        scene.traverse(object => {
          if (!object.name.startsWith('lane:')) return;
          const [, dir, link] = object.name.split(':');
          const [from, to] = link.split('->');
          const position = object.geometry.attributes.position;
          const at = i => new V().fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
          const first = at(0), last = at(position.count - 1);
          const info = group.userData.lanes.find(l => l.from === from && l.to === to);
          const fromPlate = plate(owners[from]), toPlate = plate(owners[to]);
          lanes.push({
            name: object.name, dir, from, to, colour: '#' + object.material.color.getHexString(),
            vertices: position.count, indexCount: object.geometry.index.count,
            drawStart: object.geometry.drawRange.start,
            drawCount: object.geometry.drawRange.count === Infinity ? object.geometry.index.count : object.geometry.drawRange.count,
            visible: object.visible, renderOrder: object.renderOrder,
            length: info.length, seconds: info.seconds,
            // The dependency end is the capability built on (`to`): the first vertices should sit on its story's island.
            firstVertexToDependencyIsland: first.distanceTo(toPlate), firstVertexToBuildingIsland: first.distanceTo(fromPlate),
            lastVertexToDependencyIsland: last.distanceTo(toPlate), lastVertexToBuildingIsland: last.distanceTo(fromPlate),
            drawsFromDependencyEnd: first.distanceTo(toPlate) < first.distanceTo(fromPlate) && last.distanceTo(fromPlate) < last.distanceTo(toPlate),
          });
        });
        return { groupPresent: !!group, lanes };
      };
      // Turn the globe so the centre of the given plates faces the viewer, keeping the current roll.
      window.__faceCentre = (ids, left = 0.3) => {
        const { camera, scene } = window.__globe, { rotation, onRotate } = window.__nav;
        scene.updateMatrixWorld(true);
        const V = camera.position.constructor, Q = camera.quaternion.constructor;
        const centre = new V();
        for (const id of ids) centre.add(scene.getObjectByName(`planet:${id}`).getWorldPosition(new V()).normalize());
        centre.normalize();
        // Aim a little left of the middle, clear of the story panel that selecting opens on the right.
        const eye = new V(-Math.sin(left), 0, Math.cos(left)).applyQuaternion(camera.quaternion);
        onRotate(new Q().setFromUnitVectors(centre, eye).multiply(rotation));
      };
      window.__screenOf = id => {
        const { camera, scene } = window.__globe;
        scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
        const rect = document.querySelector('canvas').getBoundingClientRect();
        const ndc = scene.getObjectByName(`planet:${id}`).getWorldPosition(camera.position.clone()).project(camera);
        return { x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height,
          facing: scene.getObjectByName(`planet:${id}`).getWorldPosition(camera.position.clone()).normalize().dot(camera.position.clone().normalize()) };
      };
    });

    const ownersObject = Object.fromEntries(owner);
    const lanes = () => page.evaluate(o => window.__lanes(o), ownersObject);
    const neighbours = [...new Set(expected.upLinks.concat(expected.downLinks)
      .flatMap(link => link.split('->').map(cap => owner.get(cap))))];
    const result = { browser: await browser.version(), viewport: { width: 1440, height: 960 }, selectedStory: SELECTED,
      selectedTitle: seed.tree.stories.find(s => s.id === SELECTED).title,
      expectedFromSeed: { upstream: expected.upLinks.length, downstream: expected.downLinks.length,
        upstreamLinks: expected.upLinks, downstreamLinks: expected.downLinks, storiesInvolved: neighbours } };

    // 1. unselected, with the globe turned so the selected story and its neighbours face the viewer.
    await page.evaluate(ids => window.__faceCentre(ids), neighbours);
    await settle(page, 20);
    result.unselected = await lanes();
    const unselectedGroup = result.unselected;
    assert.equal(unselectedGroup.lanes.length, 0, 'no lane meshes with nothing selected');
    await page.mouse.move(2, 2);
    await page.screenshot({ path: path.join(out, 'unselected.png'), timeout: 180000 });

    // 2. selected: click the story's island, wait for the draw-on to finish.
    const target = await page.evaluate(id => window.__screenOf(id), SELECTED);
    result.click = target;
    assert.ok(target.facing > 0.2, `the selected story faces the viewer (facing ${target.facing})`);
    await page.mouse.click(target.x, target.y);
    await page.mouse.move(2, 2);
    await page.waitForTimeout(1600);
    await settle(page, 20);
    await page.evaluate(ids => window.__faceCentre(ids), neighbours); // selection may have turned the globe; re-face
    await settle(page, 20);
    result.selected = await lanes();
    result.selected.selectedClass = await page.evaluate(id => document.querySelector(`.forest-label[data-story-id="${id}"]`)?.className, SELECTED);
    await page.screenshot({ path: path.join(out, 'selected.png'), timeout: 180000 });

    // 4. deselected: click open sea (a corner of the canvas, outside the sphere).
    // Open sea at (200, 480): left of the globe's rim at this viewport and turn, on the canvas, on no island.
    result.seaClick = { x: 200, y: 480 };
    const deselect = async () => {
      await page.mouse.click(result.seaClick.x, result.seaClick.y);
      await page.mouse.move(2, 2);
      await settle(page, 20);
    };
    await deselect();
    result.deselected = await lanes();
    result.deselected.stillSelectedLabel = await page.evaluate(id => document.querySelector(`.forest-label[data-story-id="${id}"]`)?.className.includes('selected'), SELECTED);
    await page.screenshot({ path: path.join(out, 'deselected.png'), timeout: 180000 });

    // 3. mid-draw: select again, screenshot ~150 ms after the click. Draw ranges are read before and after
    // the screenshot with their time since the click, because a software-GL frame is not instantaneous.
    // Software GL makes a frame slow, so up to eight attempts are made; the first whose lanes were still
    // partial after the picture was taken (draw ranges only grow, so it was partial in the picture) is kept.
    const fraction = lane => lane.drawCount / lane.indexCount;
    const fractions = reading => Object.fromEntries(reading.lanes.map(l => [l.name, +fraction(l).toFixed(3)]));
    result.midDraw = { attempts: [] };
    for (let attempt = 1; attempt <= 8; attempt++) {
      await page.evaluate(ids => window.__faceCentre(ids), neighbours);
      await settle(page, 20);
      const again = await page.evaluate(id => window.__screenOf(id), SELECTED);
      await page.mouse.click(again.x, again.y);
      await page.mouse.move(2, 2);
      const before = await page.evaluate(o => ({ sinceClickMs: performance.now() - window.__clickedAt, ...window.__lanes(o) }), ownersObject);
      await page.screenshot({ path: path.join(out, 'mid-draw.png'), timeout: 180000 });
      const after = await page.evaluate(o => ({ sinceClickMs: performance.now() - window.__clickedAt, ...window.__lanes(o) }), ownersObject);
      const partial = after.lanes.filter(l => fraction(l) > 0 && fraction(l) < 1).length;
      result.midDraw.attempts.push({ attempt, beforeScreenshotMs: Math.round(before.sinceClickMs), afterScreenshotMs: Math.round(after.sinceClickMs), partialLanesAfter: partial });
      if (partial > 0) {
        Object.assign(result.midDraw, { kept: attempt, beforeScreenshot: { sinceClickMs: before.sinceClickMs, fractions: fractions(before) },
          afterScreenshot: { sinceClickMs: after.sinceClickMs, fractions: fractions(after) }, partialLanes: partial });
        break;
      }
      await page.waitForTimeout(1500);
      await deselect();
    }
    await page.waitForTimeout(1500);
    await settle(page, 20);

    // Library mode: the toggle closes the selection; no lane mesh is mounted there either.
    await page.click('button[data-forest-mode="library"]');
    await settle(page, 20);
    result.libraryMode = { ...await lanes(), mode: await page.evaluate(() => document.querySelector('.forest').dataset.forestMode) };

    // Assertions on the measured facts.
    result.errors = errors; result.warnings = [...new Set(warnings)];
    const lanesOf = reading => reading.lanes;
    result.summary = {
      lanesWhenUnselected: lanesOf(result.unselected).length,
      lanesWhenSelected: lanesOf(result.selected).length,
      upLanes: lanesOf(result.selected).filter(l => l.dir === 'up').length,
      downLanes: lanesOf(result.selected).filter(l => l.dir === 'down').length,
      expectedUpLinks: expected.upLinks.length, expectedDownLinks: expected.downLinks.length,
      colours: Object.fromEntries(['up', 'down'].map(dir => [dir, [...new Set(lanesOf(result.selected).filter(l => l.dir === dir).map(l => l.colour))]])),
      everyLaneFullyDrawnAtFinalFrame: lanesOf(result.selected).every(l => l.drawStart === 0 && l.drawCount === l.indexCount),
      everyLaneDrawsFromDependencyEnd: lanesOf(result.selected).every(l => l.drawsFromDependencyEnd),
      lanesWhenDeselected: lanesOf(result.deselected).length,
      lanesInLibraryMode: lanesOf(result.libraryMode).length,
      midDrawKeptAttempt: result.midDraw.kept ?? null,
      pageErrors: errors.length,
    };
    assert.equal(result.summary.lanesWhenUnselected, 0);
    assert.equal(result.summary.lanesWhenDeselected, 0);
    assert.equal(result.summary.lanesInLibraryMode, 0);
    assert.ok(result.summary.everyLaneFullyDrawnAtFinalFrame, 'every lane is fully drawn at the final frame');
    assert.deepEqual(errors, []);
    writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(result, null, 2) + '\n');
    await page.close();
  });
}
