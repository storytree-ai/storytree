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
const started = performance.now();
let currentPhase;
const phase = message => { currentPhase = message; console.error(`[live pathways +${Math.round(performance.now() - started)}ms] ${message}`); };

phase('launch browser');
await withCapture({ folder, dist }, async ({ browser, origin, out, settle }) => {
  phase('browser ready');
  browser.on('disconnected', () => phase('browser disconnected'));
  const closeBrowser = async () => {
    phase(`close browser (${browser.contexts().length} contexts remain)`);
    await browser.close();
    phase('browser close returned; finish capture server cleanup');
  };
  const all = { label, browser: await browser.version(), dist, restoredLink, expected, runs: [] };
  for (const reduced of [false, true]) {
    const name = reduced ? 'reduced' : 'normal';
    phase(`${name}: create page`);
    // Smoke observes world-space geometry, not pictures. Keep the full scene but limit
    // software-compositor pixels so slow CI frames do not exhaust the animation's budget.
    const page = await browser.newPage({ viewport: smoke ? { width: 320, height: 240 } : { width: 1440, height: 960 }, deviceScaleFactor: 1,
      colorScheme: 'dark', reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const errors = [];
    const frameReports = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
      if (message.text().startsWith('live-pathway-frame:')) {
        frameReports.push(JSON.parse(message.text().slice('live-pathway-frame:'.length)));
        if (frameReports.length > 24) frameReports.shift();
      }
    });
    const failedWait = async (stage, error) => {
      // Keep a Node-side tail even when a busy renderer cannot answer this bounded final read.
      phase(`${name}: ${stage} failed; read passive renderer state`);
      let timer;
      const current = await Promise.race([
        page.evaluate(() => {
          const state = window.__globe;
          const rect = state?.gl.domElement.getBoundingClientRect();
          return { at: performance.now(), visibility: document.visibilityState, frameloop: state?.frameloop,
            pendingFrames: state?.internal.frames, active: state?.internal.active,
            canvas: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            renderer: window.liveEvidence?.renderer,
            frames: window.liveEvidence?.frames.length, lastRender: window.liveEvidence?.lastRender,
            lastFrame: window.liveEvidence?.frames.at(-1) };
        }).catch(readError => ({ readError: String(readError) })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ readTimedOut: true }), 3000); }),
      ]);
      clearTimeout(timer);
      const report = { stage, name, error: String(error), errors, frameReports, current };
      writeFileSync(path.join(out, `${name}-failure.json`), JSON.stringify(report, null, 2) + '\n');
      console.error(`live pathway failure: ${JSON.stringify(report)}`);
      throw error;
    };
    const closePage = async () => {
      // Only after the complete observation: release this page's software-GL resources before
      // closing its owned context. A browser shutdown must not wait for a live scene's GPU work.
      phase(`${name}: release renderer after observation`);
      let timer;
      try {
        await Promise.race([
          page.evaluate(() => {
            const state = window.__globe;
            if (!state) return;
            state.internal.frames = 0;
            state.setFrameloop('never');
            state.gl.dispose();
            state.gl.forceContextLoss();
          }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('renderer cleanup exceeded 10 seconds')), 10000); }),
        ]);
      } finally { clearTimeout(timer); }
      phase(`${name}: close page`);
      await page.close();
    };
    try {
    const bridge = fakeBridge({
      projectSelection: async () => ({ projects: seed.projects, current: seed.projects[0] }),
      listProjects: async () => seed.projects,
      linesSince: async (_, cursor) => cursor === 0 ? seed.lines : { lines: [], cursor: seed.lines.cursor },
      frontCovers: async () => [], codeSurvey: async () => survey,
    });
    phase(`${name}: install seeded bridge and first-frame observer`);
    await bridge.install(page);
    if (smoke || initialOnly) {
      // A returning user's dismissed guide leaves the actual forest visible from its first frame.
      await page.addInitScript(() => localStorage.setItem('storytree:setup:guide-seen:v1', 'yes'));
    }
    await page.addInitScript(({ seed, from, to, restoredLink, initialLinks, dependencyStory, telemetry }) => {
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
          const context = state.gl.getContext(), debug = context.getExtension('WEBGL_debug_renderer_info');
          window.liveEvidence.renderer = debug ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER);
          state.gl.render = function (...args) {
            const observedAt = performance.now();
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
            const update = window.liveDescriptionUpdate;
            const descriptionConsumed = update !== undefined
              && scene.getObjectByName('territory:' + update.capability)?.userData.description === update.description;
            const frame = { phase: window.liveEvidence.phase, at: performance.now(), observerMs: performance.now() - observedAt,
              descriptionConsumed, links, roads, lanes };
            window.liveEvidence.frames.push(frame);
            window.liveEvidence.lastRender = { frame: window.liveEvidence.frames.length, startedAt: frame.at };
            const report = boundary => {
              const current = get(), rect = current.gl.domElement.getBoundingClientRect();
              console.debug('live-pathway-frame:' + JSON.stringify({ boundary, frame: window.liveEvidence.frames.length,
                at: performance.now(), phase: frame.phase, observerMs: frame.observerMs, links: links.length, roads: roads.length,
                minProgress: Math.min(...roads.map(road => road.fraction)), maxProgress: Math.max(...roads.map(road => road.fraction)),
                incomplete: roads.filter(road => road.fraction < 1).slice(0, 3).map(road => ({ name: road.name, reveal: road.reveal })),
                frameloop: current.frameloop, pendingFrames: current.internal.frames, active: current.internal.active,
                visibility: document.visibilityState, canvas: { width: rect.width, height: rect.height } }));
            };
            if (telemetry) report('before render');
            const result = render.apply(this, args);
            window.liveEvidence.lastRender.completedAt = performance.now();
            frame.renderMs = window.liveEvidence.lastRender.completedAt - frame.at;
            if (telemetry) report('after render');
            return result;
          };
        }; },
      });
    }, { seed, from, to, restoredLink, initialLinks, dependencyStory, telemetry: smoke });
    let initialCdp;
    const initialScreencast = [];
    if (initialOnly) {
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
    phase(`${name}: navigate desktop`);
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    phase(`${name}: wait for bridge ready`);
    // These predicates read existing state; they must not need another RAF after demand drawing ends.
    await Promise.race([
      page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 60000, polling: 100 }),
      bridge.unanswered,
    ]);
    phase(`${name}: wait for island meshes`);
    await page.waitForFunction(ids => window.__globe && window.__nav && ids.every(id => window.__globe.scene.getObjectByName('planet:' + id)?.getObjectByName('island-ground')),
      [dependencyStory, dependentStory], { timeout: 60000, polling: 100 });
    // Observe initial growth to completion before any camera settling or later dependency addition.
    phase(`${name}: wait for initial 130-link roads to complete`);
    await page.waitForFunction(() => {
      const frame = window.liveEvidence.frames.at(-1);
      return frame?.links.length === 130 && frame.roads.length > 0 && frame.roads.every(road => road.fraction >= 1 - 1e-8);
    }, undefined, { timeout: 30000, polling: 100 });
    if (initialOnly) {
      await page.waitForTimeout(500);
      await initialCdp.send('Page.stopScreencast');
      await page.screenshot({ path: path.join(out, 'initial-complete.png') });
      const observation = await page.evaluate(() => ({ ...window.liveEvidence, timeOrigin: performance.timeOrigin }));
      writeFileSync(path.join(out, 'initial-measurements.json'), JSON.stringify({ label, dist, errors, screencast: initialScreencast, ...observation }, null, 2) + '\n');
      assert.deepEqual(errors, []);
      await closePage();
      await closeBrowser();
      return;
    }
    // Framing and RAF-based settling serve pictures only. The smoke reads world-space meshes and
    // preserves the same real graph without waiting for an otherwise unnecessary camera redraw.
    if (!smoke) {
      phase(`${name}: frame the two islands for pictures`);
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
      await page.screenshot({ path: path.join(out, `${name}-initial.png`) });
    }

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
      else {
        cap.description += ' Capture fixture: unrelated description update only.';
        window.liveDescriptionUpdate = { capability: cap.id, description: cap.description };
      }
      const previous = [...window.liveSeed.changes.changes].reverse().find(change => change.recordId === cap.id)?.record;
      const at = new Date().toISOString(), seq = ++window.liveSeed.changes.cursor;
      const record = { id: cap.id, type: 'capability', version: (previous?.version ?? 0) + 1, createdAt: previous?.createdAt ?? at, updatedAt: at,
        fields: { ...previous?.fields, story: story.id, title: cap.title, description: cap.description, dependsOn: cap.dependsOn, proposed: cap.proposed } };
      window.liveSeed.changes.changes.push({ seq, recordId: cap.id, type: 'capability', action: 'updated', record });
      return { reads: window.liveTreeReads, seq, at: performance.now(), capability: cap.id, description: cap.description };
    }, { restore, from });
    phase(`${name}: restore saved dependency and wait for real poll`);
    const restored = await update(true);
    await page.waitForFunction(reads => window.liveTreeReads > reads, restored.reads, { timeout: 15000, polling: 100 });
    phase(`${name}: wait for new crossing to complete`);
    await page.waitForFunction(() => {
      const frame = window.liveEvidence.frames.at(-1);
      return frame?.phase === 'restored-link' && frame.links.length === 131 && frame.roads.some(road => road.fresh) && frame.roads.every(road => road.fraction >= 1 - 1e-8);
    }, undefined, { timeout: 15000, polling: 100 });
    // gl.render submits work before the software compositor presents it. Let its final picture arrive.
    if (cdp) { await page.waitForTimeout(500); await cdp.send('Page.stopScreencast'); }
    if (!smoke) await page.screenshot({ path: path.join(out, `${name}-complete.png`) });
    phase(`${name}: update unrelated description and wait for real poll`);
    const unrelated = await update(false);
    await page.waitForFunction(reads => window.liveTreeReads > reads, unrelated.reads, { timeout: 15000, polling: 100 });
    phase(`${name}: wait for a frame with the consumed description`);
    await page.waitForFunction(() => window.liveEvidence.frames.some(frame =>
      frame.phase === 'unrelated-description' && frame.links.length === 131 && frame.descriptionConsumed),
    undefined, { timeout: 15000, polling: 100 });
    phase(`${name}: read submitted frames`);
    // The saved trace is plain JSON. Transfer it as one string rather than recursively walking
    // every frame/road object through Playwright's protocol, then retain the same full data.
    const observation = JSON.parse(await page.evaluate(() => {
      const { gl } = window.__globe, context = gl.getContext(), debug = context.getExtension('WEBGL_debug_renderer_info');
      return JSON.stringify({ ...window.liveEvidence, reads: window.liveTreeReads, renderer: debug ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER) });
    }));
    const first = observation.frames.find(frame => frame.roads.length > 0);
    const initial = observation.frames.filter(frame => frame.phase === 'initial' && frame.roads.length > 0);
    const additions = observation.frames.filter(frame => frame.phase === 'restored-link' && frame.links.length === 131 && frame.roads.some(road => road.fresh));
    const poll = observation.frames.filter(frame => frame.phase === 'unrelated-description' && frame.links.length === 131);
    const freshFrames = additions.map(frame => ({ at: frame.at, roads: frame.roads.filter(road => road.fresh) }));
    const summary = {
      renderer: observation.renderer,
      initialFrameCount: initial.length,
      initialElapsedMs: initial.length ? initial.at(-1).at - initial[0].at : undefined,
      maxFrameGapMs: Math.max(0, ...initial.slice(1).map((frame, i) => frame.at - initial[i].at)),
      maxRenderMs: Math.max(0, ...observation.frames.map(frame => frame.renderMs)),
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
      unrelatedFrameCount: poll.length,
      unrelatedDescriptionFrames: poll.filter(frame => frame.descriptionConsumed).length,
      unrelatedFrameProgress: poll.map(frame => ({ at: frame.at, descriptionConsumed: frame.descriptionConsumed,
        min: Math.min(...frame.roads.map(road => road.fraction)), max: Math.max(...frame.roads.map(road => road.fraction)) })),
      unrelatedUpdateKeepsRoadsWhole: poll.some(frame => frame.descriptionConsumed) && poll.every(frame => frame.roads.every(road => road.fraction === 1)),
      colouredLanes: Math.max(0, ...observation.frames.map(frame => frame.lanes.length)), pageErrors: errors.length,
    };
    all.runs.push({ name, reduced, summary, errors, restored, unrelated, screencast, ...observation });
    phase(`${name}: submitted-frame timing ${JSON.stringify({ renderer: summary.renderer, initialFrames: summary.initialFrameCount,
      initialElapsedMs: summary.initialElapsedMs, maxFrameGapMs: summary.maxFrameGapMs, maxRenderMs: summary.maxRenderMs })}`);
    if (!smoke) writeFileSync(path.join(out, `${name}-measurements.json`), JSON.stringify(all.runs.at(-1), null, 2) + '\n');
    await closePage();
    phase(`${name}: complete`);
    } catch (error) { await failedWait(currentPhase, error); }
  }
  // Smoke runs retain the real first-frame trace in the shared kit's scratch output for a failing CI run.
  writeFileSync(path.join(out, 'live-measurements.json'), JSON.stringify(all, null, 2) + '\n');
  const summary = Object.fromEntries(all.runs.map(run => [run.name, run.summary]));
  console.log(JSON.stringify(summary));
  assert.ok(all.runs.every(run => run.errors.length === 0), 'the real page has no errors');
  await closeBrowser();
});
phase('capture browser and server closed');
