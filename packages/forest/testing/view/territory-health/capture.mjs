import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildFolder, fakeBridge, withCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.join(here, '../../../src/view/evidence', 'territory-health');
const smoke = process.argv.includes('--smoke');
const started = performance.now();
const phase = message => console.error(`[territory health +${Math.round(performance.now() - started)}ms] ${message}`);
const seed = JSON.parse(readFileSync(path.join(here, '../knowledge-under-islands/seed.json'), 'utf8'));
const survey = JSON.parse(readFileSync(path.join(here, '../session-tints/survey.json'), 'utf8'));
const WORDS = { capability_2417a0fb5578: 'unhealthy', capability_f3c4cf342304: 'unhealthy', capability_b59e959e0da8: 'proposed', capability_cd33386156ad: 'proposed' };
const PARKED = { capability_60a15402b053: 'Board redesign', capability_b59e959e0da8: 'Identity' };
for (const story of seed.tree.stories) for (const capability of story.capabilities) {
  capability.status = WORDS[capability.id] ?? (capability.health.verified.state === 'passing' ? 'healthy' : 'untested');
  capability.proposed = capability.status === 'proposed';
  if (capability.status === 'unhealthy') capability.health = { ...capability.health, verified: { state: 'failing' } };
  if (PARKED[capability.id]) capability.parkedOn = [{ arc: `arc-${PARKED[capability.id]}`, title: PARKED[capability.id] }];
}
phase('launch browser');
await withCapture({ folder: evidence, dist: buildFolder(here, ...(smoke ? ['smoke'] : [])) }, async ({ browser, origin, out, settle }) => {
phase('browser ready');
const settleView = page => settle(page, smoke ? 2 : 12);
const picture = (page, name) => smoke ? undefined : page.screenshot({ path: path.join(out, name), timeout: 180000 });



const NOW = Date.parse('2026-10-01T12:00:00.000Z');
const SESSIONS = { A: '3b229329-6239-408a-a88c-2669d839ca45', B: '6f840d71-eb64-48f6-a176-c7f28c62e1e0', C: 'f0697f0c-0b04-458c-a539-c36eab0d0743' };
const CAP = { agentTools: 'capability_4da153322012', claims: 'capability_05ff7e9f0f99', libraryTransactions: 'capability_75abfdd699c0', storyNodeRender: 'capability_9f02379a2e1a' };
const lines = [];
const add = (minutesAgo, session, line) => lines.push({ ...line, session, harness: 'claude-code', project: 'storytree', seq: lines.length + 1, at: new Date(NOW - minutesAgo * 60_000).toISOString() });
const claim = (id, reason) => ({ kind: 'claimed', source: 'tool', capability: id, reason });
add(50, SESSIONS.A, { kind: 'session-started', source: 'hook' });
add(49, SESSIONS.A, { kind: 'prompt-submitted', source: 'hook' });
add(40, SESSIONS.A, claim(CAP.agentTools, 'tool call arguments'));
add(38, SESSIONS.A, claim(CAP.libraryTransactions, 'transaction retries'));
add(1, SESSIONS.A, { kind: 'file-edited', source: 'hook', files: ['packages/agent-link/src/tools.ts'] });
add(30, SESSIONS.B, { kind: 'session-started', source: 'hook' });
add(29, SESSIONS.B, { kind: 'prompt-submitted', source: 'hook' });
add(20, SESSIONS.B, claim(CAP.claims, 'takeover of an idle claim'));
add(0.5, SESSIONS.B, { kind: 'file-edited', source: 'hook', files: ['packages/agent-link/src/claims.ts'] });
add(80, SESSIONS.C, { kind: 'session-started', source: 'hook' });
add(79, SESSIONS.C, { kind: 'prompt-submitted', source: 'hook' });
add(60, SESSIONS.C, claim(CAP.storyNodeRender, 'territory colours'));
add(45, SESSIONS.C, { kind: 'turn-ended', source: 'hook' });
const log = { lines, cursor: lines.length };

function measure(page) {
  return page.evaluate(() => {
    const { scene, camera } = window.__globe;
    scene.updateMatrixWorld(true);
    const islands = [];
    scene.traverse(object => {
      if (!object.name.startsWith('planet:story_')) return;
      const territories = [], outlines = [], hatches = [];
      object.traverse(child => {
        if (child.name.startsWith('territory:')) {
          const hsl = child.material.color.getHSL({ h: 0, s: 0, l: 0 });
          territories.push({ capability: child.userData.capability ?? null, title: child.userData.title ?? 'Unclaimed code', word: child.userData.word ?? null, parked: child.userData.parked === true,
            fill: '#' + child.material.color.getHexString(), opacity: child.material.opacity, saturation: Math.round(hsl.s * 100) / 100, claimedBy: child.userData.claimedBy ?? null });
        }
        if (child.name.startsWith('territory-hatch:')) hatches.push({ colour: '#' + child.material.color.getHexString(), opacity: child.material.opacity, segments: child.geometry.attributes.position.count / 2, renderOrder: child.renderOrder });
        if (child.name.startsWith('territory-claim:')) {
          const pennant = child.getObjectByName('flag-pennant');
          outlines.push({ capability: child.userData.capability, colour: child.userData.colour, drawn: pennant ? '#' + pennant.material.color.getHexString() : null,
            faded: child.userData.faded, triangles: pennant ? pennant.geometry.attributes.position.count / 3 : 0 });
        }
      });
      islands.push({ story: object.name.slice(7), territories, claimOutlines: outlines, hatches });
    });
    const filled = islands.flatMap(i => i.territories).filter(t => t.opacity > 0 && t.capability !== null);
    const uncharted = islands.flatMap(i => i.territories.filter(t => t.capability === null).map(t => ({ story: i.story, fill: t.fill, opacity: t.opacity, saturation: t.saturation, hatches: i.hatches })));
    let fileMarks = 0;
    scene.traverse(object => { if (object.name.startsWith('file:') || object.name === 'file-circles') fileMarks++; });
    const markers = [...document.querySelectorAll('.planet-edge-marker')].map(m => ({ story: m.dataset.failingStory, title: m.title, label: m.getAttribute('aria-label') }));
    return { zoom: camera.zoom, fills: [...new Set(filled.map(t => `${t.word}${t.parked ? ' parked' : ''} ${t.fill} ${t.opacity}`))].sort(), greyFills: filled.filter(t => t.saturation < 0.3 && !t.parked).length,
      parked: filled.filter(t => t.parked).map(t => t.capability).sort(), fileMarks, uncharted, markers, islands };
  });
}

  const page = await browser.newPage({ viewport: smoke ? { width: 640, height: 480 } : { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const errors = [], warnings = [], failed = [];
  page.on('response', r => { if (r.status() >= 400) failed.push(r.url()); });
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (!['error', 'warning'].includes(message.type())) return;
    (message.type() === 'warning' ? warnings : errors).push(message.text());
  });
  const failedWait = async (stage, error) => {
    let timer;
    const scene = await Promise.race([
      page.evaluate(ids => {
        const state = window.__globe;
        const targets = ids.map(id => {
          const planet = state?.scene.getObjectByName(`planet:${id}`);
          return { id, planet: !!planet, ground: !!planet?.getObjectByName('island-ground'),
            children: planet?.children.map(child => child.name || child.type) ?? [] };
        });
        const planets = [];
        let objects = 0, grounds = 0, files = 0, outlines = 0;
        state?.scene.traverse(object => {
          objects++;
          if (object.name.startsWith('planet:')) planets.push(object.name);
          if (object.name === 'island-ground') grounds++;
          if (object.name.startsWith('file:')) files++;
          if (object.name.startsWith('territory-claim:')) outlines++;
        });
        const canvas = state?.gl.domElement;
        const rect = canvas?.getBoundingClientRect();
        return { state: document.body.dataset.state, empty: document.querySelector('.empty')?.innerText ?? '',
          at: performance.now(), lastReadinessPollAt: window.__territoryHealthPollAt ?? null,
          visibility: document.visibilityState, globe: !!state, navigation: !!window.__nav,
          missingPlanets: targets.filter(target => !target.planet).map(target => target.id),
          missingGround: targets.filter(target => target.planet && !target.ground).map(target => target.id),
          targets, planets, objects, grounds, files, outlines,
          frameloop: state?.frameloop, active: state?.internal.active, pendingFrames: state?.internal.frames,
          contextLost: state?.gl.getContext().isContextLost(),
          canvas: rect && { width: rect.width, height: rect.height, bufferWidth: canvas.width, bufferHeight: canvas.height } };
      }, seed.tree.stories.map(story => story.id)).catch(readError => ({ readError: String(readError) })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ readTimedOut: true }), 3000); }),
    ]);
    clearTimeout(timer);
    console.error(`territory-health failure: ${JSON.stringify({ stage, error: String(error), scene, errors, urls: failed, warnings: warnings.slice(0, 5) })}`);
    throw error;
  };
  const bridge = fakeBridge({});
  await bridge.install(page);
  await page.addInitScript(({ data, survey, log, now }) => {
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...args) { if (args.length === 0) super(now); else super(...args); }
      static now() { return now; }
    }
    globalThis.Date = FixedDate;
    const copy = value => structuredClone(value);
    let current = data.projects.includes('storytree') ? 'storytree' : data.projects[0];
    window.storytreeAnswers = {
      projectSelection: async () => copy({ projects: data.projects, current }),
      chooseProject: async name => { current = name; return copy({ projects: data.projects, current }); },
      listProjects: async () => copy(data.projects), projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
      linesSince: async (_, cursor) => cursor === 0 ? copy(log) : { lines: [], cursor: log.cursor },
      frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [], readSurfaces: async () => undefined,
      codeSurvey: async () => copy(survey),
    };
  }, { data: seed, survey, log, now: NOW });
  phase('navigate desktop');
  await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  phase('wait for island meshes');
  await page.waitForFunction(ids => {
    window.__territoryHealthPollAt = performance.now();
    const state = window.__globe;
    if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
    return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
  }, seed.tree.stories.map(s => s.id), { timeout: 60000, polling: 100 }).catch(error => failedWait('seeded islands', error));
  phase('wait for territory and claim meshes');
  await page.waitForFunction(({ ids, claimed }) => {
    const flags = new Set(); window.__globe.scene.traverse(o => { if (o.name.startsWith('territory-claim:')) flags.add(o.name.slice(16)); });
    const landed = id => { let found = false; window.__globe.scene.getObjectByName(`planet:${id}`)?.traverse(o => { if (o.name.startsWith('territory:')) found = true; }); return found; };
    return claimed.every(capability => flags.has(capability)) && ids.every(landed);
  }, { ids: seed.tree.stories.filter(s => s.capabilities.length > 0 && survey[s.id] !== undefined).map(s => s.id), claimed: Object.values(CAP) }, { timeout: 30000, polling: 100 }).catch(error => failedWait('claim flags and territories', error));
  phase('wait for the land to finish drawing on');
  await page.waitForFunction(claimed => {
    let full = true; const opacities = [], flags = new Set();
    window.__globe.scene.traverse(o => {
      if (o.name === 'territory-borders' && o.geometry.drawRange.count !== Infinity) full = false;
      if (o.name.startsWith('territory:')) opacities.push(o.material.opacity);
      if (o.name.startsWith('territory-claim:')) flags.add(o.name.slice(16));
    });
    if (!claimed.every(capability => flags.has(capability))) full = false;
    const key = full ? opacities.join() : '';
    window.__territoryDrawn = key !== '' && key === window.__territoryDrawnKey ? (window.__territoryDrawn ?? 0) + 1 : 0;
    window.__territoryDrawnKey = key;
    return window.__territoryDrawn >= 2;
  }, Object.values(CAP), { timeout: 30000, polling: 200 }).catch(error => failedWait('territories drawn on', error));
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  await settleView(page);
  const results = { now: new Date(NOW).toISOString(), sessions: SESSIONS, capabilities: CAP, logLines: lines.length };
  results.sessionRows = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('storytree.forest.sessions.v1:'));
    const kept = key === undefined ? null : JSON.parse(localStorage.getItem(key));
    const rows = kept?.rows ?? kept;
    return { key: key ?? null, rows: Array.isArray(rows) ? rows.map(r => ({ id: r.id, label: r.label, agent: r.agent, state: r.state, idle: r.idle, stories: r.stories })) : kept };
  });
  results.front = await measure(page);
  await picture(page, 'front.png');

  const AGENT_LINK = 'story_05e45963ca9f', FOREST = 'story_be32e99ed54f', LIBRARY = 'story_eb7d623fb9c8';
  const faceIt = async story => {
    if (!await page.evaluate(id => window.storytreeGlobe.face({ kind: 'story', story: id }), story)) throw new Error(`close-up: no camera stop for ${story}`);
    await page.waitForFunction(() => window.storytreeGlobe.still(), undefined, { timeout: 30000, polling: 100 });
    await settleView(page);
  };
  const zoomed = async () => { await page.evaluate(() => { const { camera, invalidate } = window.__globe; camera.zoom *= 2.6; camera.updateProjectionMatrix(); invalidate(); }); await settleView(page); };
  const unzoom = async () => { await page.evaluate(() => { const { camera, invalidate } = window.__globe; camera.zoom /= 2.6; camera.updateProjectionMatrix(); invalidate(); }); await settleView(page); };
  const onScreen = async (name, story) => {
    const island = await page.evaluate(id => window.storytreeGlobe.islands().find(i => i.story === id), story);
    if (!island?.visible) throw new Error(`close-up ${name}: island ${story} is not on screen (${JSON.stringify(island ?? null)})`);
  };
  if (!smoke) for (const [name, story] of [['agent-link', AGENT_LINK], ['forest', FOREST], ['library', LIBRARY], ['command-line', 'story_20549f1d48af'], ['arc-surface', 'story_78b33d16d0b6']]) {
    await faceIt(story);
    await zoomed();
    await onScreen(name, story);
    results[`closeUp-${name}`] = await measure(page);
    await picture(page, `close-up-${name}.png`);
    await unzoom();
  }

  phase('read completed observation');
  results.browser = await browser.version(); results.errors = errors; results.warnings = [...new Set(warnings)];
  results.seed = seed.stats;
  writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(results, null, 2) + '\n');
  assert.equal(results.front.greyFills, 0);
  console.log(JSON.stringify({ browser: results.browser, fills: results.front.fills, greyFills: results.front.greyFills, parked: results.front.parked, fileMarks: results.front.fileMarks,
    flags: results.front.islands.flatMap(i => i.claimOutlines.map(o => [i.story, o.capability, o.colour, o.faded, o.triangles])),
    listed: Array.isArray(results.sessionRows.rows) ? results.sessionRows.rows.map(row => Object.keys(SESSIONS).find(name => SESSIONS[name] === row.id) ?? row.id) : null, errors }));
  phase('stop redraws after observation');
  let cleanupTimer;
  try {
    await Promise.race([
      page.evaluate(() => {
        const state = window.__globe;
        state.internal.frames = 0;
        state.setFrameloop('never');
      }),
      new Promise((_, reject) => { cleanupTimer = setTimeout(() => reject(new Error('renderer cleanup exceeded 10 seconds')), 10000); }),
    ]);
  } finally { clearTimeout(cleanupTimer); }
  phase('close page');
  await page.close();
  phase('close browser and capture server');
});
phase('capture browser and server closed');
