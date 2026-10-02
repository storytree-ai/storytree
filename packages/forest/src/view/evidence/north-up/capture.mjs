// The globe after real pointer drags on the actual desktop page: where north points on screen after each.
// Same seed and viewport as file-circles. `node capture.mjs <dist> <prefix>` after `node build.mjs`;
// the before pictures come from origin/main bundled into another dist (see build.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withCapture } from '../../../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [dist = 'dist', prefix = 'after'] = process.argv.slice(2).filter(arg => arg !== '--retake');
const seed = JSON.parse(readFileSync(path.join(here, '../knowledge-under-islands/seed.json'), 'utf8'));
const survey = JSON.parse(readFileSync(path.join(here, '../file-circles/survey.json'), 'utf8'));
await withCapture({ folder: here, dist: path.join(here, dist) }, async ({ browser, origin, out, settle }) => {

/** North's bearing on screen in degrees clockwise from straight up, and how far it leans toward the eye. */
const north = page => page.evaluate(() => {
  const { camera, size } = window.__globe, { rotation } = window.__nav;
  const V = camera.position.constructor;
  const pole = new V(0, 1, 0).applyQuaternion(rotation);
  const centre = new V().project(camera), top = pole.clone().project(camera);
  const x = (top.x - centre.x) * size.width / 2, y = (top.y - centre.y) * size.height / 2;
  const toward = pole.clone().applyQuaternion(camera.quaternion.clone().invert()).z;
  return { bearing: Math.round(Math.atan2(x, y) * 1800 / Math.PI) / 10, towardEye: Math.round(Math.asin(Math.max(-1, Math.min(1, toward))) * 1800 / Math.PI) / 10 };
});

  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(({ data, survey }) => {
    const copy = value => structuredClone(value);
    let current = data.projects.includes('storytree') ? 'storytree' : data.projects[0];
    // The bridge's newer calls (sign-in, arcs, holds, readings) answer with nothing in this capture.
    const known = {
      projectSelection: async () => copy({ projects: data.projects, current }),
      chooseProject: async name => { current = name; return copy({ projects: data.projects, current }); },
      listProjects: async () => copy(data.projects), projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
      linesSince: async (_, cursor) => cursor === 0 ? copy(data.lines) : { lines: [], cursor: data.lines.cursor },
      frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [], readSurfaces: async () => undefined,
      codeSurvey: async () => copy(survey),
      readSignIn: async () => ({ on: false, available: false }), arcViews: async () => [], holds: async () => ({ waits: [], owners: [] }),
      contextReadings: async () => [], windowReadings: async () => [], idleAfterMs: async () => 600000, leaveAfterMs: async () => 3600000,
    };
    window.storytree = new Proxy(known, { get: (target, name) => target[name] ?? (async () => undefined) });
  }, { data: seed, survey });
  await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(ids => {
    const state = window.__globe;
    if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
    return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
  }, seed.tree.stories.map(s => s.id), { timeout: 60000 }).catch(async error => {
    console.error(JSON.stringify({ state: await page.evaluate(() => document.body.dataset.state + ' | ' + document.body.innerText.slice(0, 400)), errors }));
    throw error;
  });
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('file:')) n++; }); return n > 0; }, undefined, { timeout: 30000 });
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  await settle(page);
  const readings = [{ after: 'opening', ...await north(page) }];
  await page.screenshot({ path: path.join(out, `${prefix}-opening.png`), timeout: 180000 });

  const box = await page.locator('canvas').first().boundingBox();
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const drags = [{ x: 90, y: 0 }, { x: 0, y: 70 }, { x: -140, y: -50 }, { x: 70, y: 40 }, { x: 0, y: -700 }];
  for (const drag of drags) {
    await page.mouse.move(centre.x - drag.x / 2, centre.y - drag.y / 2);
    await page.mouse.down();
    await page.mouse.move(centre.x + drag.x / 2, centre.y + drag.y / 2, { steps: 24 });
    await page.mouse.up();
    await settle(page);
    readings.push({ after: `drag ${drag.x}, ${drag.y}`, ...await north(page) });
    if (drag === drags[3]) await page.screenshot({ path: path.join(out, `${prefix}-four-drags.png`), timeout: 180000 });
  }
  await page.mouse.move(2, 2);
  await settle(page);
  await page.screenshot({ path: path.join(out, `${prefix}-tilted-to-the-pole.png`), timeout: 180000 });
  writeFileSync(path.join(out, `${prefix}-measurements.json`), JSON.stringify({ readings, errors }, null, 2) + '\n');
  console.log(JSON.stringify({ readings, errors }, null, 2));
});
