// Passing level on the glass sheet holds the tilt's frame rate (increment_057d5c0cb2be, ADR-1062 D3, D4): the page's frames
// are timed while the Library and Stories buttons swing the sheet through level and while a real right-drag tilts it through
// level by hand, and the longest frame at the crossing is set beside the longest frame of the rest of the tilt. Drawn by the
// actual desktop page from the same read-only snapshot of storytree's own library as ../glass-table/. Run from the checkout
// root, in the foreground, once on the software renderer and once on the machine's graphics card:
//   node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/level-crossing/capture.mjs <seed folder> [--gpu] --retake
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, fakeBridge, loadPlaywright, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts';
import { SHEET_TILT } from '@storytree/forest-world/planet';

const resting = SHEET_TILT * 180 / Math.PI;
/** CSS pixels of a rotating drag up the window per degree of tilt (TILT_PER_PIXEL is π/600 radians). */
const PER_DEGREE = 600 / 180;
/** Degrees either side of level counted as the crossing. */
const NEAR = 12;

const here = path.dirname(fileURLToPath(import.meta.url));
const gpu = process.argv.includes('--gpu');
const from = process.argv.slice(2).find(arg => !arg.startsWith('--'));
if (from === undefined) throw new Error('Name the folder holding the snapshot (seed.json.gz and survey.json).');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(from, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(from, 'survey.json'), 'utf8'));
const dist = path.join(here, 'dist');
const viewport = { width: 1440, height: 960 };
await buildCapture({ dist });

await withCapture({ folder: here, dist, softwareGL: !gpu }, async ({ browser: software, origin, out }) => {
  // The graphics card: Chromium headless on ANGLE's Vulkan back end, with the GPU blocklist ignored.
  const browser = gpu ? await (await loadPlaywright()).chromium.launch({ headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] }) : software;
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
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
  await page.evaluate(() => {
    const hide = () => { for (const card of document.querySelectorAll('.teaching-card')) card.style.display = 'none'; };
    hide();
    new MutationObserver(hide).observe(document.body, { childList: true, subtree: true });
    // Every frame the page paints, with the tilt it shows: a frame the main thread holds up is a long gap between two.
    window.__frames = undefined;
    window.__record = () => {
      const frames = window.__frames = [];
      const tick = now => {
        if (window.__frames !== frames) return;
        const { scene, camera } = window.__globe, V = camera.position.constructor, Q = camera.quaternion.constructor;
        const glass = scene.getObjectByName('sheet:glass');
        const tilt = new V(0, 0, 1).applyQuaternion(glass.parent.getWorldQuaternion(new Q())).angleTo(new V(0, 0, 1).applyQuaternion(camera.quaternion)) * 180 / Math.PI;
        frames.push([now, tilt]);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    window.__stop = () => { const frames = window.__frames; window.__frames = undefined; return frames; };
  });
  const box = await page.locator('canvas').first().boundingBox();
  const tiltNow = () => page.evaluate(() => {
    const { scene, camera } = window.__globe, V = camera.position.constructor, Q = camera.quaternion.constructor;
    const glass = scene.getObjectByName('sheet:glass');
    return new V(0, 0, 1).applyQuaternion(glass.parent.getWorldQuaternion(new Q())).angleTo(new V(0, 0, 1).applyQuaternion(camera.quaternion)) * 180 / Math.PI;
  });
  const tiltedTo = want => page.waitForFunction(want => {
    const { scene, camera } = window.__globe, V = camera.position.constructor, Q = camera.quaternion.constructor;
    const glass = scene.getObjectByName('sheet:glass');
    const tilt = new V(0, 0, 1).applyQuaternion(glass.parent.getWorldQuaternion(new Q())).angleTo(new V(0, 0, 1).applyQuaternion(camera.quaternion)) * 180 / Math.PI;
    return Math.abs(tilt - want) < 0.5;
  }, want, { timeout: 60000, polling: 100 });

  /** The longest frame at the crossing (the tilt within NEAR of level at either end of the frame) beside the rest. */
  const summarise = frames => {
    // A frame that shows the tilt it showed before is no step: the time from one shown tilt to the next is the frame the eye sees.
    const shown = frames.filter(([, tilt], k) => k === 0 || Math.abs(tilt - frames[k - 1][1]) > 0.01);
    // The first step is the wait for the press or the drag to start, not a frame of the tilt.
    const moving = shown.slice(1).map(([at, tilt], k) => ({ ms: at - shown[k][0], from: shown[k][1], to: tilt })).slice(1);
    const crossing = moving.filter(g => Math.min(Math.abs(g.from - 90), Math.abs(g.to - 90)) <= NEAR || (g.from - 90) * (g.to - 90) < 0);
    const rest = moving.filter(g => !crossing.includes(g));
    const longest = list => list.reduce((a, b) => b.ms > a.ms ? b : a, { ms: 0 });
    const median = list => { const s = list.map(g => g.ms).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
    const round = g => ({ ms: Math.round(g.ms), fromDeg: Math.round(g.from * 10) / 10, toDeg: Math.round(g.to * 10) / 10 });
    return { frames: moving.length, crossing: { frames: crossing.length, longest: round(longest(crossing)), medianMs: Math.round(median(crossing)) },
      rest: { frames: rest.length, longest: round(longest(rest)), medianMs: Math.round(median(rest)) } };
  };
  const results = {};
  const run = async (name, act) => {
    await page.mouse.move(2, 2);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__record());
    await act();
    await page.waitForTimeout(300);
    const frames = await page.evaluate(() => window.__stop());
    if (process.argv.includes('--raw')) console.log(name, JSON.stringify(frames.map(([at, tilt]) => [Math.round(at - frames[0][0]), Math.round(tilt * 10) / 10])));
    results[name] = summarise(frames);
    console.log(name, JSON.stringify(results[name]));
  };
  /** A right-drag up the window from `start` to `end` degrees, a degree a step, over about `ms` milliseconds. */
  const tiltByHand = async (start, end, ms) => {
    const x = box.x + box.width / 2, y = box.y + box.height / 2, steps = Math.ceil(Math.abs(end - start));
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'right' });
    const began = Date.now();
    for (let k = 1; k <= steps; k++) {
      await page.mouse.move(x, y - (end - start) * PER_DEGREE * k / steps);
      const wait = began + ms * k / steps - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
    }
    await page.mouse.up({ button: 'right' });
  };

  if (process.argv.includes('--profile')) {
    const programs = () => page.evaluate(() => { const r = window.__globe.gl; return { programs: r.info.programs.length, geometries: r.info.memory.geometries, textures: r.info.memory.textures, calls: r.info.render.calls }; });
    console.log('start', JSON.stringify(await programs()));
    for (let k = 0; k < 3; k++) {
      await tiltByHand(resting, 180 - resting, 1500); await tiltedTo(180 - resting); console.log('below', JSON.stringify(await programs()));
      await tiltByHand(180 - resting, resting, 1500); await tiltedTo(resting); console.log('above', JSON.stringify(await programs()));
    }
    await page.locator('[data-globe-switch="library"]').click(); await tiltedTo(180 - resting); await page.waitForTimeout(500);
    await browser.startTracing(page, { path: '/tmp/level-trace.json', categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'blink', 'toplevel', 'disabled-by-default-v8.cpu_profiler'] });
    await page.locator('[data-globe-switch="stories"]').click(); await tiltedTo(resting); await page.waitForTimeout(300);
    await browser.stopTracing();
    return;
  }
  for (let round = 1; round <= 2; round++) {
    await run(`swing-to-library-${round}`, async () => { await page.locator('[data-globe-switch="library"]').click(); await tiltedTo(180 - resting); });
    await run(`swing-to-stories-${round}`, async () => { await page.locator('[data-globe-switch="stories"]').click(); await tiltedTo(resting); });
    await run(`hand-down-${round}`, async () => { await tiltByHand(resting, 180 - resting, 1500); await tiltedTo(180 - resting); });
    await run(`hand-up-${round}`, async () => { await tiltByHand(180 - resting, resting, 1500); await tiltedTo(resting); });
  }
  const renderer = await page.evaluate(() => {
    const gl = window.__globe.gl.getContext(), info = gl.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  console.log('renderer', renderer);
  if (errors.length) throw new Error(errors.join('\n'));
  if (gpu) await browser.close();
  writeFileSync(path.join(out, `measurements-${gpu ? 'gpu' : 'software'}.json`), JSON.stringify({ viewport, renderer, nearDeg: NEAR, seed: seed.stats, results }, null, 1) + '\n');
});
