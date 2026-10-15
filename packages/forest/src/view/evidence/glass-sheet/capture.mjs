// SPIKE (spike/glass-sheet, never merged): today's globe and the glass sheet, drawn by the actual desktop page from one
// read-only snapshot of the real library (seed.json.gz, from seed.mts; survey.json, from survey.mjs), at one window size.
// The page draws the globe at index.html and the sheet at index.html?sheet. Every turn is a real pointer drag or a real
// click on the Forest / Library control. Run from the checkout root, in the foreground:
//   node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/glass-sheet/capture.mjs --retake
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(gunzipSync(readFileSync(path.join(here, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(here, 'survey.json'), 'utf8'));
const dist = path.join(here, 'dist');
const viewport = { width: 1440, height: 960 };
await buildCapture({ dist });

/** What the eye sees at this moment: islands, how square-on each faces the eye, nameplates and their print size. */
const measure = page => page.evaluate(() => {
  const { scene, camera, size } = window.__globe, V = camera.position.constructor, Q = camera.quaternion.constructor;
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const eye = new V(0, 0, 1).applyQuaternion(camera.quaternion);
  const canvas = document.querySelector('canvas').getBoundingClientRect();
  const islands = [];
  scene.traverse(object => {
    if (!object.name.startsWith('planet:story_')) return;
    const facing = new V(0, 1, 0).applyQuaternion(object.getWorldQuaternion(new Q())).dot(eye);
    const p = object.getWorldPosition(new V()).project(camera);
    const ground = object.getObjectByName('island-ground');
    let relief = null, across = null;
    if (ground) {
      ground.geometry.computeBoundingBox();
      const box = ground.geometry.boundingBox;
      relief = box.max.y - box.min.y;
      across = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    }
    islands.push({ story: object.name.slice(7), facing: Math.round(facing * 1000) / 1000,
      onScreen: Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z >= -1 && p.z <= 1,
      relief, acrossPx: across === null ? null : Math.round(across * camera.zoom * Math.abs(facing) * 10) / 10 });
  });
  const plates = [...document.querySelectorAll('.planet-nameplate:not(.capability)')].map(el => {
    const r = el.getBoundingClientRect(), title = el.querySelector('.planet-nameplate-title');
    let visible = getComputedStyle(el).visibility !== 'hidden' && r.width > 0;
    for (let at = el; at && visible; at = at.parentElement) if (getComputedStyle(at).display === 'none' || Number(getComputedStyle(at).opacity) === 0) visible = false;
    const inCanvas = r.right > canvas.left && r.left < canvas.right && r.bottom > canvas.top && r.top < canvas.bottom;
    return { story: el.dataset.storyId, visible: visible && inCanvas, fontPx: title ? parseFloat(getComputedStyle(title).fontSize) : null,
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
  });
  const shown = plates.filter(p => p.visible);
  let overlaps = 0;
  for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
    const a = shown[i].rect, b = shown[j].rect;
    if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlaps++;
  }
  // Seen square-on from either face (the underside sees the islands through the glass): within 18°, at least 95% of true size.
  const square = islands.filter(i => Math.abs(i.facing) >= Math.cos(18 * Math.PI / 180));
  const under = scene.getObjectByName('sheet-underside');
  return {
    canvas: size, zoomPxPerUnit: Math.round(camera.zoom * 1000) / 1000,
    yawDegrees: window.__nav ? Math.round(2 * Math.atan2(window.__nav.rotation.clone().premultiply(camera.quaternion.clone().invert()).y,
      window.__nav.rotation.clone().premultiply(camera.quaternion.clone().invert()).w) * 1800 / Math.PI) / 10 : null,
    islands: islands.length, islandsOnScreen: islands.filter(i => i.onScreen).length,
    islandsFacingTheEye: islands.filter(i => i.facing > 0).length,
    islandsWithoutForeshortening: square.length, shareWithoutForeshortening: Math.round(square.length / islands.length * 1000) / 1000,
    medianIslandAcrossPx: islands.map(i => i.acrossPx).filter(v => v !== null).sort((a, b) => a - b)[Math.floor(islands.length / 2)] ?? null,
    reliefLeft: { maxUnits: Math.max(...islands.map(i => i.relief ?? 0)), maxPx: Math.round(Math.max(...islands.map(i => i.relief ?? 0)) * camera.zoom * 1000) / 1000 },
    nameplates: { total: plates.length, visible: shown.length, fontPx: [...new Set(shown.map(p => p.fontPx))], overlappingPairs: overlaps },
    underside: under ? under.userData : null,
    selected: document.body.dataset.selected ?? null,
    perIsland: islands,
  };
});

await withCapture({ folder: here, dist }, async ({ browser, origin, out, settle }) => {
  const results = {};
  const open = async query => {
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
    await page.goto(`${origin}/index.html${query}`, { timeout: 180000, waitUntil: 'domcontentloaded' });
    await bridge.ready(page);
    await page.waitForFunction(ids => {
      const state = window.__globe;
      if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
      return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
    }, seed.tree.stories.map(s => s.id), { timeout: 180000 }).catch(async error => {
      console.error(JSON.stringify({ state: await page.evaluate(() => document.body.dataset.state + ' | ' + document.body.innerText.slice(0, 400)), errors }));
      throw error;
    });
    await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('file:')) n++; }); return n > 0; }, undefined, { timeout: 60000 });
    // The roads are routed off the page's thread; wait for them before any picture.
    await page.waitForFunction(() => { let n = 0; window.__globe.scene.getObjectByName('globe-roads')?.traverse(o => { if (o.isMesh) n++; }); return n > 0; }, undefined, { timeout: 180000 });
    for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
    await page.mouse.move(2, 2);
    await settle(page, 30);
    return { page, errors };
  };
  const shoot = async (page, name) => {
    await page.mouse.move(2, 2);
    await settle(page, 30);
    await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 180000 });
    results[name] = await measure(page);
    const { perIsland, ...summary } = results[name];
    console.log(name, JSON.stringify(summary));
  };
  /** A real left-button drag across the canvas's middle, `dx` pixels to the right. */
  const drag = async (page, dx) => {
    const box = await page.locator('canvas').first().boundingBox();
    const y = box.y + box.height / 2, x = box.x + box.width / 2;
    await page.mouse.move(x - dx / 2, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y, { steps: 30 });
    await page.mouse.up();
    return box.height;
  };
  const press = async (page, label) => {
    await page.locator(`.forest-views button`, { hasText: label }).click();
    await page.waitForTimeout(1500);
  };

  // Today's globe: its opening, and the Library (Stories off, Library on), as the toggle evidence draws it.
  {
    const { page, errors } = await open('');
    await shoot(page, 'globe-front');
    await press(page, 'Library');
    await press(page, 'Stories');
    await shoot(page, 'globe-library');
    assert.deepEqual(errors, []);
    await page.close();
  }

  // The glass sheet: at rest, part-turned and edge-on by drags, then turned over by the Library control.
  {
    const { page, errors } = await open('?sheet');
    await shoot(page, 'sheet-top');
    const height = (await page.locator('canvas').first().boundingBox()).height;
    await drag(page, height * 50 / 360);
    await shoot(page, 'sheet-turning');
    await drag(page, height * 40 / 360);
    await shoot(page, 'sheet-edge-on');
    await drag(page, -height * 90 / 360);
    await press(page, 'Library');
    await shoot(page, 'sheet-underside');

    // A selection made on the top face holds across the turn, lit on both faces.
    await press(page, 'Forest');
    const target = await page.evaluate(() => {
      const { scene, camera } = window.__globe, V = camera.position.constructor;
      const box = document.querySelector('canvas').getBoundingClientRect();
      const plates = [];
      scene.traverse(o => { if (o.name.startsWith('planet:story_')) plates.push(o); });
      // The island with the most notes under it would be ideal; the one nearest the middle is a fair, unchosen pick.
      const at = plates.map(o => { const p = o.getWorldPosition(new V()).project(camera); return { story: o.name.slice(7), x: box.left + (p.x + 1) / 2 * box.width, y: box.top + (1 - p.y) / 2 * box.height }; })
        .sort((a, b) => Math.hypot(a.x - box.left - box.width / 2, a.y - box.top - box.height / 2) - Math.hypot(b.x - box.left - box.width / 2, b.y - box.top - box.height / 2));
      return at[0];
    });
    await page.mouse.click(target.x, target.y);
    await settle(page, 30);
    await shoot(page, 'sheet-top-selected');
    assert.equal(results['sheet-top-selected'].selected, target.story, 'a click on the island selects its story');
    await press(page, 'Library');
    await shoot(page, 'sheet-underside-selected');
    assert.equal(results['sheet-underside-selected'].selected, target.story, 'the selection holds across the turn');
    assert.deepEqual(errors, []);
    await page.close();
  }
  // The comparison variant: the same lines, depth running west to east.
  {
    const { page, errors } = await open('?sheet=columns');
    await shoot(page, 'columns-top');
    await press(page, 'Library');
    await shoot(page, 'columns-underside');
    assert.deepEqual(errors, []);
    await page.close();
  }
  writeFileSync(path.join(out, 'measurements.json'), JSON.stringify({ viewport, seed: seed.stats, results }, null, 1) + '\n');
});
