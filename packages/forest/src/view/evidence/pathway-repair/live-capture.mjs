// Actual desktop initial frames and polled link restoration. Run under the README's heavy-lock wrapper.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const smoke = process.argv.includes('--smoke');
const initialOnly = process.argv.includes('--initial-only');
const label = smoke ? 'live-smoke' : process.argv[2] ?? 'after-live';
const dist = path.resolve(process.env.PATHWAY_CAPTURE_DIST ?? path.join(here, 'dist', label));
const folder = path.resolve(process.env.PATHWAY_CAPTURE_OUT ?? path.join(here, label));
const seed = JSON.parse(gunzipSync(readFileSync(path.join(here, '../code-rows/seed.json.gz'))).toString());
const survey = JSON.parse(readFileSync(path.join(here, '../code-rows/survey.json'), 'utf8'));
const from = 'capability_11fe600afeda', to = 'capability_75d059640d9d';
const restoredLink = `${from}->${to}`;
const dependencyStory = seed.tree.stories.find(story => story.capabilities.some(cap => cap.id === to)).id;
const dependentStory = seed.tree.stories.find(story => story.capabilities.some(cap => cap.id === from)).id;
const expected = seed.tree.stories.flatMap(story => story.capabilities.flatMap(cap => cap.dependsOn.map(to => `${cap.id}->${to}`))).sort();
const initialLinks = expected.filter(link => link !== restoredLink);

await withCapture({ folder, dist }, async ({ browser, origin, out, settle }) => {
  const all = { label, browser: await browser.version(), dist, restoredLink, expected, runs: [] };
  for (const reduced of [false, true]) {
    const name = reduced ? 'reduced' : 'normal';
    const page = await browser.newPage({ viewport: smoke ? { width: 960, height: 640 } : { width: 1440, height: 960 }, deviceScaleFactor: 1,
      colorScheme: 'dark', reducedMotion: reduced ? 'reduce' : 'no-preference' });
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
    await page.addInitScript(({ seed, from, to, restoredLink, initialLinks, dependencyStory }) => {
      window.liveSeed = structuredClone(seed);
      window.liveTreeReads = 0;
      const cap = window.liveSeed.tree.stories.flatMap(story => story.capabilities).find(cap => cap.id === from);
      window.savedDependencies = [...cap.dependsOn];
      cap.dependsOn = cap.dependsOn.filter(id => id !== to);
      window.storytreeAnswers = {
        projectTree: async () => { window.liveTreeReads++; return structuredClone(window.liveSeed.tree); },
        changesSince: async (_, cursor) => ({ changes: structuredClone(window.liveSeed.changes.changes.filter(change => change.seq > cursor)),
          cursor: Math.max(cursor, window.liveSeed.changes.cursor) }),
      };
      const oldLinks = new Set(initialLinks);
      window.liveEvidence = { phase: 'initial', frames: [] };
      // The build's existing seam is called at Canvas.onCreated, before its first submitted frame.
      // Intercept its assignment, then delegate its normal getter installation and observe gl.render.
      let install;
      Object.defineProperty(window, '__storytreeCaptureGlobe', {
        configurable: true, set(value) { install = value; },
        get() { return get => {
          install(get);
          const state = get(), render = state.gl.render;
          state.gl.render = function (...args) {
            const { scene } = get();
            scene.updateMatrixWorld(true);
            const V = scene.position.constructor;
            const dependency = scene.getObjectByName('planet:' + dependencyStory)?.getWorldPosition(new V());
            const roads = [], lanes = [];
            scene.traverse(object => {
              if (object.name.startsWith('lane:')) lanes.push(object.name);
              if (!object.name.startsWith('pathway:') || !object.geometry) return;
              const geometry = object.geometry, count = geometry.index?.count ?? 0, draw = geometry.drawRange;
              const reveal = geometry.userData.pathwayReveal ? { ...geometry.userData.pathwayReveal } : undefined;
              const links = object.userData.links;
              const fresh = links.includes(restoredLink) && !links.some(link => oldLinks.has(link));
              const item = { name: object.name, links, fresh, count, drawn: Math.min(count, draw.count), start: draw.start,
                fraction: reveal?.progress ?? Math.min(1, draw.count / count), reveal, geometry: geometry.uuid };
              if (fresh && draw.count > 0 && dependency) {
                const p = geometry.attributes.position;
                const centre = pair => new V().fromBufferAttribute(p, pair * 2).add(new V().fromBufferAttribute(p, pair * 2 + 1)).multiplyScalar(0.5).applyMatrix4(object.matrixWorld);
                const first = Math.floor(draw.start / 6), last = first + Math.floor(Math.min(count - draw.start, draw.count) / 6);
                const anchor = centre(reveal?.fromEnd ? last : first), front = centre(reveal?.fromEnd ? first : last);
                item.anchor = anchor.toArray(); item.front = front.toArray();
                item.anchorNearerDependency = anchor.distanceTo(dependency) <= front.distanceTo(dependency) + 1e-4;
              }
              roads.push(item);
            });
            const links = (scene.getObjectByName('pathways:cross-island')?.userData.links ?? []).map(edge => `${edge.from}->${edge.to}`).sort();
            window.liveEvidence.frames.push({ phase: window.liveEvidence.phase, at: performance.now(), links, roads, lanes });
            return render.apply(this, args);
          };
        }; },
      });
    }, { seed, from, to, restoredLink, initialLinks, dependencyStory });
    let initialCdp;
    const initialScreencast = [];
    if (initialOnly) {
      // A returning user's dismissed guide leaves the first visible forest frame unobscured.
      await page.addInitScript(() => localStorage.setItem('storytree:setup:guide-seen:v1', 'yes'));
      const directory = path.join(out, 'initial-frames'); mkdirSync(directory, { recursive: true });
      initialCdp = await page.context().newCDPSession(page);
      initialCdp.on('Page.screencastFrame', event => {
        const filename = `frame-${String(initialScreencast.length).padStart(4, '0')}.jpg`;
        writeFileSync(path.join(directory, filename), Buffer.from(event.data, 'base64'));
        initialScreencast.push({ name: filename, ...event.metadata });
        void initialCdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
      });
      await initialCdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 });
    }
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await bridge.ready(page, 60000);
    await page.waitForFunction(ids => window.__globe && window.__nav && ids.every(id => window.__globe.scene.getObjectByName('planet:' + id)?.getObjectByName('island-ground')),
      [dependencyStory, dependentStory], { timeout: 60000 });
    // Observe initial growth to completion before any camera settling or later dependency addition.
    await page.waitForFunction(() => {
      const frame = window.liveEvidence.frames.at(-1);
      return frame?.links.length === 130 && frame.roads.length > 0 && frame.roads.every(road => road.fraction >= 1 - 1e-8);
    }, undefined, { timeout: 15000 });
    if (initialOnly) {
      await page.waitForTimeout(500);
      await initialCdp.send('Page.stopScreencast');
      await page.screenshot({ path: path.join(out, 'initial-complete.png') });
      const observation = await page.evaluate(() => ({ ...window.liveEvidence, timeOrigin: performance.timeOrigin }));
      writeFileSync(path.join(out, 'initial-measurements.json'), JSON.stringify({ label, dist, errors, screencast: initialScreencast, ...observation }, null, 2) + '\n');
      assert.deepEqual(errors, []);
      await page.close();
      return;
    }
    for (const title of ['Close help', 'Close app menu']) { const button = page.getByRole('button', { name: title, exact: true }); if (await button.isVisible().catch(() => false)) await button.click(); }
    await page.evaluate(ids => {
      for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover();
      const { camera, scene } = window.__globe, { rotation, onRotate } = window.__nav;
      scene.updateMatrixWorld(true);
      const V = camera.position.constructor, Q = camera.quaternion.constructor, centre = new V();
      for (const id of ids) centre.add(scene.getObjectByName('planet:' + id).getWorldPosition(new V()).normalize());
      const eye = new V(0, 0, 1).applyQuaternion(camera.quaternion);
      onRotate(new Q().setFromUnitVectors(centre.normalize(), eye).multiply(rotation));
    }, [dependencyStory, dependentStory]);
    await settle(page, 2);
    if (!smoke) await page.screenshot({ path: path.join(out, `${name}-initial.png`) });

    let cdp;
    const screencast = [], framesDir = path.join(out, `${name}-frames`);
    if (!smoke && !reduced) {
      mkdirSync(framesDir, { recursive: true });
      cdp = await page.context().newCDPSession(page);
      cdp.on('Page.screencastFrame', event => {
        const filename = `frame-${String(screencast.length).padStart(4, '0')}.jpg`;
        writeFileSync(path.join(framesDir, filename), Buffer.from(event.data, 'base64'));
        screencast.push({ name: filename, ...event.metadata });
        void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
      });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 });
    }
    const update = async restore => page.evaluate(({ restore, from }) => {
      window.liveEvidence.phase = restore ? 'restored-link' : 'unrelated-description';
      const story = restore ? window.liveSeed.tree.stories.find(story => story.capabilities.some(cap => cap.id === from))
        : window.liveSeed.tree.stories.find(story => story.title === 'The forest');
      const cap = restore ? story.capabilities.find(cap => cap.id === from) : story.capabilities.find(cap => cap.title.startsWith('3 '));
      if (restore) cap.dependsOn = [...window.savedDependencies];
      else cap.description += ' Capture fixture: unrelated description update only.';
      const previous = [...window.liveSeed.changes.changes].reverse().find(change => change.recordId === cap.id)?.record;
      const at = new Date().toISOString(), seq = ++window.liveSeed.changes.cursor;
      const record = { id: cap.id, type: 'capability', version: (previous?.version ?? 0) + 1, createdAt: previous?.createdAt ?? at, updatedAt: at,
        fields: { ...previous?.fields, story: story.id, title: cap.title, description: cap.description, dependsOn: cap.dependsOn, proposed: cap.proposed } };
      window.liveSeed.changes.changes.push({ seq, recordId: cap.id, type: 'capability', action: 'updated', record });
      return { reads: window.liveTreeReads, seq, at: performance.now() };
    }, { restore, from });
    const restored = await update(true);
    await page.waitForFunction(reads => window.liveTreeReads > reads, restored.reads, { timeout: 15000 });
    await page.waitForFunction(() => {
      const frame = window.liveEvidence.frames.at(-1);
      return frame?.phase === 'restored-link' && frame.links.length === 131 && frame.roads.some(road => road.fresh) && frame.roads.every(road => road.fraction >= 1 - 1e-8);
    }, undefined, { timeout: 15000 });
    // gl.render submits work before the software compositor presents it. Let its final picture arrive.
    if (cdp) { await page.waitForTimeout(500); await cdp.send('Page.stopScreencast'); }
    if (!smoke) await page.screenshot({ path: path.join(out, `${name}-complete.png`) });
    const unrelated = await update(false);
    await page.waitForFunction(reads => window.liveTreeReads > reads, unrelated.reads, { timeout: 15000 });
    await page.waitForTimeout(500);
    const observation = await page.evaluate(() => {
      const { gl } = window.__globe, context = gl.getContext(), debug = context.getExtension('WEBGL_debug_renderer_info');
      return { ...window.liveEvidence, reads: window.liveTreeReads, renderer: debug ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER) };
    });
    const first = observation.frames.find(frame => frame.roads.length > 0);
    const initial = observation.frames.filter(frame => frame.phase === 'initial' && frame.roads.length > 0);
    const additions = observation.frames.filter(frame => frame.phase === 'restored-link' && frame.links.length === 131 && frame.roads.some(road => road.fresh));
    const poll = observation.frames.filter(frame => frame.phase === 'unrelated-description' && frame.links.length === 131);
    const freshFrames = additions.map(frame => ({ at: frame.at, roads: frame.roads.filter(road => road.fresh) }));
    const summary = {
      initialFirstRoadFractions: first?.roads.map(road => road.fraction) ?? [], initialLinkCount: first?.links.length,
      initialPartialFrames: initial.filter(frame => frame.roads.some(road => road.fraction > 0 && road.fraction < 1)).length,
      initialCompletedWithoutCaptureInvalidation: initial.length > 0 && initial.at(-1).roads.every(road => road.fraction === 1),
      finalLinkIdentitiesPreserved: JSON.stringify(additions.at(-1)?.links) === JSON.stringify(expected), finalLinkCount: additions.at(-1)?.links.length,
      firstNewOnlyFractions: freshFrames[0]?.roads.map(road => road.fraction) ?? [],
      newOnlyCrossSpans: freshFrames[0]?.roads.length ?? 0,
      partialFrames: freshFrames.filter(frame => frame.roads.some(road => road.fraction > 0 && road.fraction < 1)).length,
      completedWithoutCaptureInvalidation: freshFrames.length > 0 && freshFrames.at(-1).roads.every(road => road.fraction === 1),
      oldSharedRoadsAlwaysWhole: additions.every(frame => frame.roads.filter(road => !road.fresh).every(road => road.fraction === 1)),
      dependencyToDependent: freshFrames.some(frame => frame.roads.some(road => road.fraction > 0 && road.fraction < 1))
        && freshFrames.every(frame => frame.roads.filter(road => road.fraction > 0 && road.fraction < 1).every(road => road.anchorNearerDependency)),
      unrelatedUpdateKeepsRoadsWhole: poll.length > 0 && poll.every(frame => frame.roads.every(road => road.fraction === 1)),
      colouredLanes: Math.max(0, ...observation.frames.map(frame => frame.lanes.length)), pageErrors: errors.length,
    };
    all.runs.push({ name, reduced, summary, errors, restored, unrelated, screencast, ...observation });
    if (!smoke) writeFileSync(path.join(out, `${name}-measurements.json`), JSON.stringify(all.runs.at(-1), null, 2) + '\n');
    await page.close();
  }
  // Smoke runs retain the real first-frame trace in the shared kit's scratch output for a failing CI run.
  writeFileSync(path.join(out, 'live-measurements.json'), JSON.stringify(all, null, 2) + '\n');
  const summary = Object.fromEntries(all.runs.map(run => [run.name, run.summary]));
  console.log(JSON.stringify(summary));
  assert.ok(all.runs.every(run => run.errors.length === 0), 'the real page has no errors');
});
