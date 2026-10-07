// Real desktop rendering with the committed code-rows snapshot and survey. The render wrapper
// records submitted geometry; it never supplies geometry, changes time, or requests a frame.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2] ?? 'after';
const dist = path.resolve(process.env.PATHWAY_CAPTURE_DIST ?? path.join(here, 'dist', label));
const output = path.resolve(process.env.PATHWAY_CAPTURE_OUT ?? path.join(here, label));
const seed = JSON.parse(gunzipSync(readFileSync(path.join(here, '../code-rows/seed.json.gz'))).toString());
const survey = JSON.parse(readFileSync(path.join(here, '../code-rows/survey.json'), 'utf8'));
const selected = seed.tree.stories.find(story => story.title === 'The agent link').id;
const owners = Object.fromEntries(seed.tree.stories.flatMap(story => story.capabilities.map(cap => [cap.id, story.id])));
const links = seed.tree.stories.flatMap(story => story.capabilities.flatMap(cap => cap.dependsOn.map(to => ({ from: cap.id, to }))));
const relevant = links.filter(link => owners[link.from] !== owners[link.to] && [owners[link.from], owners[link.to]].includes(selected));

await withCapture({ folder: output, dist }, async ({ browser, origin, out, settle }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'no-preference' });
  const errors = [], warnings = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); if (message.type() === 'error') errors.push(message.text()); });
  const bridge = fakeBridge({
    projectSelection: async () => ({ projects: seed.projects, current: seed.projects[0] }),
    listProjects: async () => seed.projects, projectTree: async () => seed.tree,
    changesSince: async (_, cursor) => cursor === 0 ? seed.changes : { changes: [], cursor: seed.changes.cursor },
    linesSince: async (_, cursor) => cursor === 0 ? seed.lines : { lines: [], cursor: seed.lines.cursor },
    frontCovers: async (_, id) => seed.covers[id] ?? [], codeSurvey: async () => survey,
  });
  await bridge.install(page);
  await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await bridge.ready(page, 180000);
  await page.waitForFunction(ids => window.__globe && window.__nav && ids.every(id => window.__globe.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground')),
    seed.tree.stories.map(story => story.id), { timeout: 180000 });
  for (const name of ['Close help', 'Close app menu']) { const button = page.getByRole('button', { name, exact: true }); if (await button.isVisible().catch(() => false)) await button.click(); }
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  await settle(page, 6);
  console.log(`${label}: desktop ready`);

  await page.evaluate(() => {
    const state = window.__globe;
    window.__pathwayEvidence = { phase: 'setup', frames: [], events: [] };
    window.__readPathways = () => {
      const { scene } = window.__globe;
      const group = scene.getObjectByName('pathways:selection-lanes');
      const lanes = [], roads = [];
      scene.traverse(object => {
        if (!object.isMesh || !(object.name.startsWith('lane:') || object.name.startsWith('pathway:'))) return;
        const geometry = object.geometry, count = geometry.index?.count ?? geometry.attributes.position.count;
        const item = { name: object.name, count, drawn: Math.min(count, geometry.drawRange.count), visible: object.visible, geometry: geometry.uuid };
        if (object.name.startsWith('lane:')) {
          const [, dir, link] = object.name.split(':'), [from, to] = link.split('->');
          const info = group?.userData.lanes?.find(lane => lane.from === from && lane.to === to);
          item.dir = dir; item.seconds = info?.seconds; item.length = info?.length;
          lanes.push(item);
        } else roads.push(item);
      });
      return { lanes, roads };
    };
    const render = state.gl.render;
    state.gl.render = function (...args) {
      const probe = window.__pathwayEvidence;
      const at = performance.now();
      const reading = window.__readPathways();
      const value = render.apply(this, args);
      probe.frames.push({ phase: probe.phase, at, submittedMs: performance.now() - at, ...reading });
      return value;
    };
    document.addEventListener('pointerup', () => window.__pathwayEvidence.events.push({ type: 'pointerup', at: performance.now() }), true);
    window.__facePathwayStory = id => {
      const { camera, scene } = window.__globe, { rotation, onRotate } = window.__nav;
      scene.updateMatrixWorld(true);
      const V = camera.position.constructor, Q = camera.quaternion.constructor;
      const centre = scene.getObjectByName(`planet:${id}`).getWorldPosition(new V()).normalize();
      const eye = new V(-Math.sin(0.18), 0, Math.cos(0.18)).applyQuaternion(camera.quaternion);
      onRotate(new Q().setFromUnitVectors(centre, eye).multiply(rotation));
    };
    window.__pathwayTarget = id => {
      const { camera, scene } = window.__globe;
      scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
      const rect = document.querySelector('canvas').getBoundingClientRect();
      const position = scene.getObjectByName(`planet:${id}`).getWorldPosition(camera.position.clone()).project(camera);
      return { x: rect.left + (position.x + 1) / 2 * rect.width, y: rect.top + (1 - position.y) / 2 * rect.height };
    };
  });
  const phase = name => page.evaluate(name => { window.__pathwayEvidence.phase = name; window.__pathwayEvidence.events.push({ type: name, at: performance.now() }); }, name);
  const select = async () => { const target = await page.evaluate(id => window.__pathwayTarget(id), selected); await page.mouse.click(target.x, target.y); await page.mouse.move(2, 2); };
  const deselect = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(250); assert.equal((await page.evaluate(() => window.__readPathways())).lanes.length, 0); };
  await page.evaluate(id => window.__facePathwayStory(id), selected);
  await settle(page, 6);
  await page.mouse.move(2, 2);
  await page.screenshot({ path: path.join(out, 'unselected.png'), timeout: 180000 });

  // Passive CDP screencast captures compositor frames without advancing or requesting the product's clock.
  const cdp = await page.context().newCDPSession(page);
  const framesDir = path.join(out, 'normal-frames'); mkdirSync(framesDir, { recursive: true });
  const screencast = [];
  cdp.on('Page.screencastFrame', event => {
    const name = `frame-${String(screencast.length).padStart(4, '0')}.jpg`;
    writeFileSync(path.join(framesDir, name), Buffer.from(event.data, 'base64'));
    screencast.push({ name, ...event.metadata });
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1440, maxHeight: 960, everyNthFrame: 1 });
  await phase('normal-selection');
  await select();
  await page.waitForTimeout(3500);
  await cdp.send('Page.stopScreencast');
  const normal = await page.evaluate(() => window.__readPathways());
  assert.equal(normal.lanes.length, relevant.length, 'the selected story keeps every real cross-story link');
  await page.screenshot({ path: path.join(out, 'selected.png'), timeout: 180000 });
  console.log(`${label}: normal motion recorded (${screencast.length} compositor frames)`);

  // A viewport/rotation update that leaves all links unchanged must not reset the draw-on.
  await phase('irrelevant-update');
  await page.setViewportSize({ width: 1441, height: 960 });
  await page.evaluate(() => window.__nav.onRotate(window.__nav.rotation.clone()));
  await page.waitForTimeout(1600);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.waitForTimeout(300);
  await phase('deselect');
  await deselect();
  await page.screenshot({ path: path.join(out, 'deselected.png'), timeout: 180000 });

  // Detail views retain the same real meshes and merely change the camera zoom.
  await page.evaluate(() => { const { camera, invalidate } = window.__globe; camera.zoom *= 2.1; camera.updateProjectionMatrix(); invalidate(); });
  await settle(page, 4);
  await page.screenshot({ path: path.join(out, 'unselected-detail.png'), timeout: 180000 });
  await phase('detail-selection'); await select(); await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(out, 'selected-detail.png'), timeout: 180000 });
  await deselect();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await phase('reduced-selection'); await select(); await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(out, 'reduced-motion.png'), timeout: 180000 });

  const observation = await page.evaluate(() => {
    const { gl } = window.__globe, context = gl.getContext(), debug = context.getExtension('WEBGL_debug_renderer_info');
    return { ...window.__pathwayEvidence, renderer: debug ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER),
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, frameloop: window.__globe.frameloop };
  });
  const trace = observation.frames.filter(frame => frame.phase === 'normal-selection' && frame.lanes.length > 0);
  const reduced = observation.frames.filter(frame => frame.phase === 'reduced-selection' && frame.lanes.length > 0);
  const updates = observation.frames.filter(frame => frame.phase === 'irrelevant-update' && frame.lanes.length > 0);
  const complete = frame => frame.lanes.every(lane => lane.drawn === lane.count);
  const intervals = trace.slice(1).map((frame, i) => frame.at - trace[i].at).sort((a, b) => a - b);
  const summary = {
    normalFrames: trace.length, normalFirstFractions: trace[0]?.lanes.map(lane => lane.drawn / lane.count),
    initialFullFrame: trace.length > 0 && complete(trace[0]),
    normalPartialFrames: trace.filter(frame => frame.lanes.some(lane => lane.drawn > 0 && lane.drawn < lane.count)).length,
    normalCompletedWithoutCaptureInvalidation: trace.length > 0 && complete(trace.at(-1)),
    minFrameMs: intervals[0], medianFrameMs: intervals[Math.floor(intervals.length / 2)], maxFrameMs: intervals.at(-1),
    irrelevantUpdateReset: updates.some(frame => !complete(frame)), reducedFirstFrameComplete: reduced.length > 0 && complete(reduced[0]),
    colouredLaneCount: normal.lanes.length, beigeRoadsInitiallyWhole: observation.frames[0]?.roads.every(road => road.drawn === road.count),
  };
  writeFileSync(path.join(out, 'measurements.json'), JSON.stringify({ label, dist, browser: await browser.version(), selected, expectedLinks: relevant, errors,
    warnings: [...new Set(warnings)], bridgeDefaulted: bridge.defaulted, summary, screencast, ...observation }, null, 2) + '\n');
  // ffmpeg concat durations preserve the observed compositor timing, rather than inventing a frame rate.
  const concat = screencast.flatMap((frame, i) => [`file '${frame.name}'`, `duration ${Math.max(0.001, (screencast[i + 1]?.timestamp ?? frame.timestamp + 0.4) - frame.timestamp).toFixed(6)}`]);
  if (screencast.length) concat.push(`file '${screencast.at(-1).name}'`);
  writeFileSync(path.join(framesDir, 'frames.ffconcat'), `ffconcat version 1.0\n${concat.join('\n')}\n`);
  console.log(JSON.stringify(summary));
  assert.deepEqual(errors, []);
  await page.close();
});
