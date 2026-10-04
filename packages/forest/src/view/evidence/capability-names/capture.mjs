// Capability names on the globe (3.32): the agent link selected and zoomed in, then a territory hovered.
// Reuses the rows capture's build, seed and survey: `node ../rows/build.mjs <checkout> <label>`, then
// `node --import tsx capture.mjs <label>` (after: this branch; before: origin/main). Measures each capability
// plate's text, how many lines it takes and whether it is cut short, and the hover tooltip; writes measurements-<label>.json.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withCapture } from '../../../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const rows = path.join(here, '../rows');
const label = process.argv.slice(2).find(arg => arg !== '--retake') ?? 'after';
const dist = path.join(rows, 'dist', label);
const seed = JSON.parse(gunzipSync(readFileSync(path.join(rows, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(rows, 'survey.json'), 'utf8'));
const story = seed.tree.stories.find(s => s.title === 'The agent link');
const hovered = story.capabilities.find(c => c.title.includes('Agent tools'));

await withCapture({ folder: here, dist }, async ({ browser, out, origin, settle }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // The rows capture's stand-in bridge.
  await page.addInitScript(({ data, survey }) => {
    const copy = value => structuredClone(value);
    const known = {
      projectSelection: async () => ({ projects: data.projects, current: 'storytree' }),
      chooseProject: async () => ({ projects: data.projects, current: 'storytree' }),
      listProjects: async () => copy(data.projects), projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
      linesSince: async (_, cursor) => cursor === 0 ? copy(data.lines) : { lines: [], cursor: data.lines.cursor },
      frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [],
      arcView: async () => null, arcViews: async () => [], codeSurvey: async () => copy(survey), holds: async () => ({ waits: {}, heldOn: {} }), waitHolds: async () => [], heldOnQuestion: async () => [],
      readSurfaces: async () => ({ ok: false }), readSignIn: async () => ({ on: false }), agentConnections: async () => [],
      windowReadings: async (_, sessions) => sessions.map(session => ({ session, at: new Date().toISOString(), compactions: 0, inView: [], glimpses: [], opens: [] })),
      windowReading: async (_, session) => ({ session, at: new Date().toISOString(), compactions: 0, inView: [], glimpses: [], opens: [] }),
      contextReadings: async () => [], idleAfterMs: async () => 3600000, leaveAfterMs: async () => 3600000, checkForUpdates: async () => ({ state: 'idle' }),
    };
    window.storytree = new Proxy(known, { get: (t, m) => m === 'then' ? undefined : (t[m] ?? (async () => undefined)) });
  }, { data: seed, survey });
  await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(id => {
    const state = window.__globe;
    return document.body.dataset.state === 'ready' && !!state && !!window.__nav && !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground');
  }, story.id, { timeout: 120000 });
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('file:')) n++; }); return n > 0; }, undefined, { timeout: 60000 });
  for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });

  // Face the agent link, a little left of the middle so the story panel that selecting opens leaves it clear; north stays up.
  await page.evaluate(id => {
    const { scene, camera } = window.__globe, V = camera.position.constructor, Q = camera.quaternion.constructor;
    const d = scene.getObjectByName(`planet:${id}`).getWorldPosition(new V()).applyQuaternion(window.__nav.rotation.clone().invert()).normalize();
    const turn = (axis, angle) => new Q().setFromAxisAngle(new V(...axis), angle);
    const facing = turn([0, 1, 0], -0.2).multiply(turn([1, 0, 0], Math.asin(d.y))).multiply(turn([0, 1, 0], -Math.atan2(d.x, d.z)));
    window.__nav.onRotate(camera.quaternion.clone().multiply(facing));
  }, story.id);
  await settle(page);
  const where = () => page.evaluate(id => {
    const { scene, camera, gl } = window.__globe, V = camera.position.constructor;
    const box = gl.domElement.getBoundingClientRect();
    const s = scene.getObjectByName(`planet:${id}`).getWorldPosition(new V()).project(camera);
    return { x: box.left + (s.x + 1) * box.width / 2, y: box.top + (1 - s.y) * box.height / 2 };
  }, story.id);
  let at = await where();
  await page.mouse.click(at.x, at.y);
  await page.mouse.move(2, 2);
  await settle(page);
  // Zoom in on it, as the owner looked at it.
  at = await where();
  await page.mouse.move(at.x, at.y);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -240); await settle(page, 4); }
  await page.mouse.move(2, 2);
  await settle(page, 24);

  const plates = () => page.evaluate(() => [...document.querySelectorAll('.planet-nameplate.capability')].filter(p => p.getBoundingClientRect().width > 0).map(p => {
    const style = getComputedStyle(p), line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    const inner = p.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    return { capability: p.dataset.capabilityId, text: p.textContent, lines: Math.round(inner / line), cut: p.scrollHeight > p.clientHeight + 1, width: Math.round(p.getBoundingClientRect().width) };
  }));
  const results = { label, story: story.title, errors };
  results.plates = await plates();
  results.numbered = results.plates.filter(p => /^\d+ · /.test(p.text)).length;
  results.overTwoLines = results.plates.filter(p => p.lines > 2).length;
  await page.screenshot({ path: path.join(out, `${label}-selected.png`), timeout: 180000 });

  // Point at the hovered capability's territory, off its file circles: try round its plate until the tooltip names the capability.
  const plate = await page.evaluate(id => {
    const p = document.querySelector(`.planet-nameplate.capability[data-capability-id="${id}"]`)?.getBoundingClientRect();
    return p && { x: p.left + p.width / 2, y: p.top + p.height / 2 };
  }, hovered.id);
  results.tooltip = undefined;
  if (plate !== undefined) {
    for (const [dx, dy] of [[0, 0], [0, 16], [0, -16], [18, 0], [-18, 0], [14, 14], [-14, 14], [14, -14], [-14, -14], [0, 26], [0, -26], [28, 0], [-28, 0]]) {
      await page.mouse.move(plate.x + dx, plate.y + dy);
      await settle(page, 4);
      const tip = await page.evaluate(() => {
        const t = document.querySelector('[role="tooltip"].knowledge-tooltip');
        return t && { text: t.querySelector('strong')?.textContent ?? t.textContent, detail: t.querySelector('.knowledge-tooltip-detail')?.textContent };
      });
      results.tooltip = tip ?? undefined;
      if (tip && !tip.text.includes(' lines · ')) break;
    }
  }
  await page.screenshot({ path: path.join(out, `${label}-hover.png`), timeout: 180000 });
  writeFileSync(path.join(out, `measurements-${label}.json`), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({ numbered: results.numbered, overTwoLines: results.overTwoLines, plates: results.plates.map(p => `${p.text} (${p.lines})`), tooltip: results.tooltip, errors }, null, 1));
});
