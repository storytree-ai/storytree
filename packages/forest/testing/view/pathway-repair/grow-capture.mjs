// An island grows in the actual desktop and its roads stay on screen (The drawing engine 4.37–4.39).
// Build first (build.mjs <root> <label>), then: node --import tsx grow-capture.mjs <label>.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFolder, fakeBridge, withCapture } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2] ?? 'after';
const dist = path.resolve(process.env.PATHWAY_CAPTURE_DIST ?? buildFolder(here, label));
const folder = path.resolve(process.env.PATHWAY_CAPTURE_OUT ?? path.join(here, '../../../src/view/evidence', 'pathway-grow', label));
const seed = JSON.parse(gunzipSync(readFileSync(path.join(here, '../code-rows/seed.json.gz'))).toString());
const survey = JSON.parse(readFileSync(path.join(here, '../code-rows/survey.json'), 'utf8'));
// The island that grows: the seed's story with the most capabilities that has roads, so growing it shifts the sheet.
const storyOf = new Map(seed.tree.stories.flatMap(story => story.capabilities.map(cap => [cap.id, story.id])));
const crossing = seed.tree.stories.filter(story => story.capabilities.some(cap => cap.dependsOn.some(to => storyOf.get(to) !== story.id)));
const grown = crossing.sort((a, b) => b.capabilities.length - a.capabilities.length)[0];
const GROWN = 4;
const POLL_MS = 45000, WATCH_MS = 20000;

await withCapture({ folder, dist }, async ({ browser, origin, out, settle }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const bridge = fakeBridge({
    projectSelection: async () => ({ projects: seed.projects, current: seed.projects[0] }),
    listProjects: async () => seed.projects,
    linesSince: async (_, cursor) => cursor === 0 ? seed.lines : { lines: [], cursor: seed.lines.cursor },
    frontCovers: async () => [], codeSurvey: async () => survey,
  });
  await bridge.install(page);
  await page.addInitScript(({ seed }) => {
    window.liveSeed = structuredClone(seed);
    window.liveTreeReads = 0;
    window.storytreeAnswers = {
      projectTree: async () => { window.liveTreeReads++; return structuredClone(window.liveSeed.tree); },
      changesSince: async (_, cursor) => ({ changes: structuredClone(window.liveSeed.changes.changes.filter(change => change.seq > cursor)),
        cursor: Math.max(cursor, window.liveSeed.changes.cursor) }),
    };
    window.growEvidence = { phase: 'initial', frames: [] };
    let install;
    Object.defineProperty(window, '__storytreeCaptureGlobe', {
      configurable: true, set(value) { install = value; },
      get() { return get => {
        install(get);
        const state = get(), render = state.gl.render;
        state.gl.render = function (...args) {
          const { scene } = get();
          let roads = 0;
          scene.traverse(object => { if (object.name.startsWith('pathway:') && object.geometry && object.geometry.drawRange.count > 0) roads++; });
          const links = scene.getObjectByName('pathways:cross-island')?.userData.links?.length ?? 0;
          window.growEvidence.frames.push({ phase: window.growEvidence.phase, at: performance.now(), roads, links,
            roadsVisible: scene.getObjectByName('globe-roads')?.visible });
          return render.apply(this, args);
        };
      }; },
    });
  }, { seed });
  await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await Promise.race([page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 60000, polling: 100 }), bridge.unanswered]);
  await page.waitForFunction(id => window.__globe?.scene.getObjectByName('planet:' + id)?.getObjectByName('island-ground'), grown.id, { timeout: 60000, polling: 100 });
  for (const title of ['Close help', 'Close app menu']) { const button = page.getByRole('button', { name: title, exact: true }); if (await button.isVisible().catch(() => false)) await button.click(); }
  // The initial roads routed and drawn on.
  await page.waitForFunction(() => window.growEvidence.frames.at(-1)?.roads > 0, undefined, { timeout: 120000, polling: 200 });
  await page.waitForTimeout(6000);
  await settle(page, 2);
  await page.screenshot({ path: path.join(out, 'before-grow.png') });
  const places = () => page.evaluate(ids => Object.fromEntries(ids.map(id => [id, window.__globe.scene.getObjectByName('planet:' + id)?.getWorldPosition(new window.__globe.scene.position.constructor()).toArray()])), seed.tree.stories.map(story => story.id));
  const placesBefore = await places();

  // The island grows by GROWN capabilities, recorded as the library records them, and the app's own poll reads it.
  const grow = await page.evaluate(({ story, count }) => {
    window.growEvidence.phase = 'grown';
    const home = window.liveSeed.tree.stories.find(s => s.id === story), model = home.capabilities[0];
    for (let i = 0; i < count; i++) {
      const cap = { ...structuredClone(model), id: `capability_grow${String(i).padStart(8, '0')}`, title: `Capture fixture: grown ${i + 1}`, dependsOn: [] };
      home.capabilities.push(cap);
      const at = new Date().toISOString(), seq = ++window.liveSeed.changes.cursor;
      window.liveSeed.changes.changes.push({ seq, recordId: cap.id, type: 'capability', action: 'created',
        record: { id: cap.id, type: 'capability', version: 1, createdAt: at, updatedAt: at, fields: { story, title: cap.title, description: cap.description ?? '', dependsOn: [], proposed: cap.proposed } } });
    }
    return { reads: window.liveTreeReads, at: performance.now() };
  }, { story: grown.id, count: GROWN });
  await page.waitForFunction(reads => window.liveTreeReads > reads, grow.reads, { timeout: POLL_MS, polling: 100 });
  const read = await page.evaluate(() => performance.now());
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, 'just-after-grow.png') });
  await page.waitForTimeout(WATCH_MS);
  await settle(page, 2);
  await page.screenshot({ path: path.join(out, 'after-grow.png') });
  const placesAfter = await places();
  const frames = JSON.parse(await page.evaluate(() => JSON.stringify(window.growEvidence.frames)));
  const before = frames.filter(frame => frame.phase === 'initial').at(-1);
  const after = frames.filter(frame => frame.phase === 'grown' && frame.at >= read);
  const summary = {
    label, grownStory: grown.title, grownBy: GROWN,
    // How far the islands that did not grow moved, in ground units: the sheet re-centring on the grown island.
    otherIslandsMoved: Object.entries(placesBefore).filter(([id, at]) => id !== grown.id && at && placesAfter[id])
      .map(([id, at]) => Math.round(Math.hypot(...placesAfter[id].map((v, i) => v - at[i])) * 100) / 100).sort((a, b) => a - b),
    roadsBefore: before?.roads, framesAfter: after.length,
    framesWithoutRoads: after.filter(frame => frame.roads === 0).length,
    firstFrameWithoutRoadsMs: after.find(frame => frame.roads === 0) && Math.round(after.find(frame => frame.roads === 0).at - read),
    lastFrameWithoutRoadsMs: after.findLast(frame => frame.roads === 0) && Math.round(after.findLast(frame => frame.roads === 0).at - read),
    roadsAtEnd: after.at(-1)?.roads, pageErrors: errors,
  };
  writeFileSync(path.join(out, 'measurements.json'), JSON.stringify({ summary, frames }, null, 2) + '\n');
  console.log(JSON.stringify(summary));
  assert.deepEqual(errors, [], 'the real page has no errors');
  await page.close();
});
