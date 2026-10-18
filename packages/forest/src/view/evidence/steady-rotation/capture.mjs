// A rotating drag keeps one direction all through the tilt (increment_293a37334470, the owner: "Rotation feels strange,
// seems to change direction midway."). One continuous diagonal right-drag, up and to the right, tips the glass sheet from
// 40° above level to 40° below it while spinning it; each frame reads where the sheet's south edge, the one nearest the
// eye, is drawn across the window. Drawn by the actual desktop page from the same read-only snapshot of storytree's own
// library as ../glass-table/. `--label` names the strip, so the build before the fix and the one after sit side by side.
// Run from the checkout root, in the foreground:
//   node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/steady-rotation/capture.mjs <seed folder> --label after --retake
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts';
import { SHEET_TILT } from '@storytree/forest-world/planet';

const degrees = radians => Math.round(radians * 1800 / Math.PI) / 10;
const resting = degrees(SHEET_TILT);
/** CSS pixels of a rotating drag per degree, up the window for tilt and across it for spin (both π/600 radians a pixel). */
const PER_DEGREE = 600 / 180;

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const from = args.find((arg, k) => !arg.startsWith('--') && args[k - 1] !== '--label');
const label = args[args.indexOf('--label') + 1];
if (from === undefined || !args.includes('--label') || label === undefined) throw new Error('Name the snapshot folder (seed.json.gz and survey.json) and --label <name>.');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(from, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(from, 'survey.json'), 'utf8'));
const dist = path.join(here, 'dist');
const viewport = { width: 1440, height: 960 };
await buildCapture({ dist });

/** The tilt, and where the sheet's south (40 units south of the middle of the view) is drawn across the window from the middle. */
const measure = page => page.evaluate(() => {
  const { scene, camera } = window.__globe, V = camera.position.constructor, Q = camera.quaternion.constructor;
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const glass = scene.getObjectByName('sheet:glass'), frame = glass.parent.getWorldQuaternion(new Q());
  const eye = new V(0, 0, 1).applyQuaternion(camera.quaternion), up = new V(0, 0, 1).applyQuaternion(frame);
  const canvas = document.querySelector('canvas').getBoundingClientRect();
  const middle = camera.position.clone().setLength(glass.position.z), south = middle.clone().add(new V(0, -40, 0).applyQuaternion(frame));
  const a = middle.clone().project(camera), b = south.clone().project(camera);
  return { tiltDeg: Math.round(up.angleTo(eye) * 1800 / Math.PI) / 10, southX: Math.round((b.x - a.x) / 2 * canvas.width * 10) / 10 };
});

await withCapture({ folder: here, dist }, async ({ browser, origin, out, settle }) => {
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
  for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  await page.evaluate(() => {
    const hide = () => { for (const card of document.querySelectorAll('.teaching-card')) card.style.display = 'none'; };
    hide();
    new MutationObserver(hide).observe(document.body, { childList: true, subtree: true });
  });
  const box = await page.locator('canvas').first().boundingBox();
  await page.mouse.move(2, 2);
  await settle(page, 10);
  const opened = await measure(page);
  assert.ok(Math.abs(opened.tiltDeg - resting) < 0.5, `it opens at the top resting tilt (${opened.tiltDeg}°)`);

  // One right-drag: up the window 10° to 40° above level, then up and to the right together, 10° of tilt and 7.5° of spin a
  // frame, to 40° below level.
  const frames = [];
  let x = box.x + box.width / 2 - 200, y = box.y + box.height / 2 + 200;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  for (let k = 1; k <= 10; k++) await page.mouse.move(x, y - 10 * PER_DEGREE * k / 10);
  y -= 10 * PER_DEGREE;
  for (let frame = 0; frame <= 8; frame++) {
    if (frame > 0) {
      for (let k = 1; k <= 10; k++) await page.mouse.move(x + 7.5 * PER_DEGREE * k / 10, y - 10 * PER_DEGREE * k / 10);
      x += 7.5 * PER_DEGREE; y -= 10 * PER_DEGREE;
    }
    await settle(page, 4);
    const file = `frame-${String(frame).padStart(2, '0')}.png`;
    await page.screenshot({ path: path.join(out, file), timeout: 180000 });
    frames.push({ file, ...(await measure(page)) });
    console.log(file, JSON.stringify(frames.at(-1)));
  }
  await page.mouse.up({ button: 'right' });
  assert.deepEqual(frames.map(f => Math.round(f.tiltDeg)), [50, 60, 70, 80, 90, 100, 110, 120, 130], 'one tilt, from 40° above level to 40° below, in even steps');

  const strip = await browser.newPage({ viewport: { width: 9 * 200 + 10 * 6, height: 133 + 40 + 2 * 6 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const row = frames.map(f => `<figure><img src="data:image/png;base64,${readFileSync(path.join(out, f.file)).toString('base64')}"><figcaption>${f.tiltDeg}° · south ${f.southX > 0 ? '+' : ''}${f.southX} px</figcaption></figure>`).join('');
  await strip.setContent(`<style>body{margin:0;background:#0d1419;color:#e6ecf0;font:12px system-ui;padding:6px;display:flex;gap:6px}figure{margin:0}img{width:200px;height:133px;display:block}figcaption{height:34px;padding-top:4px}</style>${row}`);
  await strip.screenshot({ path: path.join(out, `drag-${label}.png`) });
  await strip.close();
  for (const f of frames) rmSync(path.join(out, f.file));

  assert.deepEqual(errors, []);
  const file = path.join(out, 'measurements.json'), kept = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { viewport, seed: seed.stats, runs: {} };
  kept.runs[label] = frames.map(({ file: _, ...f }) => f);
  writeFileSync(file, JSON.stringify(kept, null, 1) + '\n');
});
