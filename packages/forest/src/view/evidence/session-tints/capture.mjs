// Seeded, repeatable capture of the actual desktop page (session claims, ADR-0923 narrowing ADR-0804 D9): same seed (the
// knowledge-under-islands snapshot), the same agent log written out below, the page's clock fixed at NOW,
// same 1440 x 960 viewport, same programmatic turns; nothing is hand-panned. Run under `node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" --` after
// `node build.mjs`. Measures what can be counted before anyone looks, and writes measurements.json.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(path.join(here, '../knowledge-under-islands/seed.json'), 'utf8'));
// survey.json is readCodeSurvey(<this checkout>, seed.tree), precomputed by `tsx survey.mjs`.
const survey = JSON.parse(readFileSync(path.join(here, 'survey.json'), 'utf8'));
await withCapture({ folder: here, dist: path.join(here, 'dist') }, async ({ browser, origin, out, settle }) => {



// The agent log the stand-in bridge hands the page, at the fixed clock NOW. Real capability ids from the seed tree.
const NOW = Date.parse('2026-10-01T12:00:00.000Z');
// Default: three ids whose hashed hues sit well apart (207, 301, 248). CAPTURE_IDS=as-hashed: three arbitrary ids whose hues
// (356, 335, 336) sit close, to show what two neighbouring hues look like; its files carry the prefix as-hashed-.
const HASHED = process.env.CAPTURE_IDS === 'as-hashed';
const prefix = HASHED ? 'as-hashed-' : '';
const SESSIONS = HASHED
  ? { A: 'a3f81c52-7d0e-4b96-8a14-2c5e9d10b7f3', B: '5be07d94-1c28-4f6a-b3d9-e8a4c60f2117', C: 'c91d6e08-42fa-4a7b-95c3-0d7b18e3a5d2' }
  : { A: '3b229329-6239-408a-a88c-2669d839ca45', B: '6f840d71-eb64-48f6-a176-c7f28c62e1e0', C: 'f0697f0c-0b04-458c-a539-c36eab0d0743' };
const CAP = { agentTools: 'capability_4da153322012', claims: 'capability_05ff7e9f0f99', libraryTransactions: 'capability_75abfdd699c0', storyNodeRender: 'capability_9f02379a2e1a' };
const lines = [];
const add = (minutesAgo, session, line) => lines.push({ ...line, session, harness: 'claude-code', project: 'storytree', seq: lines.length + 1, at: new Date(NOW - minutesAgo * 60_000).toISOString() });
const claim = (id, reason) => ({ kind: 'claimed', source: 'tool', capability: id, reason });
// A: live; holds Agent tools (The agent link) and Library transactions (The library); a turn in progress, last line a minute ago.
add(50, SESSIONS.A, { kind: 'session-started', source: 'hook' });
add(49, SESSIONS.A, { kind: 'prompt-submitted', source: 'hook' });
add(40, SESSIONS.A, claim(CAP.agentTools, 'tool call arguments'));
add(38, SESSIONS.A, claim(CAP.libraryTransactions, 'transaction retries'));
add(1, SESSIONS.A, { kind: 'file-edited', source: 'hook', files: ['packages/agent-link/src/tools.ts'] });
// B: live; holds Claims (The agent link, beside A's Agent tools); last line 30 seconds ago.
add(30, SESSIONS.B, { kind: 'session-started', source: 'hook' });
add(29, SESSIONS.B, { kind: 'prompt-submitted', source: 'hook' });
add(20, SESSIONS.B, claim(CAP.claims, 'takeover of an idle claim'));
add(0.5, SESSIONS.B, { kind: 'file-edited', source: 'hook', files: ['packages/agent-link/src/claims.ts'] });
// C: quiet past the 30-minute quiet time (last line 45 minutes ago) but not yet the 1-hour leave time; holds Story node render (The forest).
add(80, SESSIONS.C, { kind: 'session-started', source: 'hook' });
add(79, SESSIONS.C, { kind: 'prompt-submitted', source: 'hook' });
add(60, SESSIONS.C, claim(CAP.storyNodeRender, 'territory colours'));
add(45, SESSIONS.C, { kind: 'turn-ended', source: 'hook' });
const log = { lines, cursor: lines.length };

/** What the sessions drew, counted from the scene: coast-tint bands, claimed territories, anything called a wisp. */
function measure(page) {
  return page.evaluate(() => {
    const { scene, camera } = window.__globe;
    scene.updateMatrixWorld(true);
    const islands = [];
    let wispObjects = 0;
    scene.traverse(object => {
      const text = `${object.name} ${Object.keys(object.userData ?? {}).join(' ')} ${JSON.stringify(object.userData ?? {})}`;
      if (/wisp/i.test(text)) wispObjects++;
    });
    scene.traverse(object => {
      if (!object.name.startsWith('planet:story_')) return;
      const bands = [], claimed = [];
      let territories = 0;
      object.traverse(child => {
        if (child.name.startsWith('coast-tint:')) {
          const positions = child.geometry.attributes.position;
          bands.push({ name: child.name, session: child.userData.session, colour: child.userData.colour, drawnColour: '#' + child.material.color.getHexString(),
            opacity: child.material.opacity, vertices: positions.count });
        }
        if (child.name.startsWith('territory:')) {
          territories++;
          if (child.userData.claimedBy !== undefined) claimed.push({ name: child.name, capability: child.userData.capability, title: child.userData.title, claimedBy: child.userData.claimedBy, drawnColour: '#' + child.material.color.getHexString(), opacity: child.material.opacity });
        }
      });
      islands.push({ story: object.name.slice(7), coastTintBands: bands, territories, claimedTerritories: claimed });
    });
    return { zoom: camera.zoom, wispObjects, islands };
  });
}

  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const errors = [], warnings = [], failed = [];
  page.on('response', r => { if (r.status() >= 400) failed.push(r.url()); });
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (!['error', 'warning'].includes(message.type())) return;
    (message.type() === 'warning' ? warnings : errors).push(message.text());
  });
  const bridge = fakeBridge({});
  await bridge.install(page);
  process.once('exit', () => console.log('Bridge methods left to the stand-in:', bridge.defaulted.join(', ') || 'none'));
  await page.addInitScript(({ data, survey, log, now }) => {
    // The page's clock stands still at the capture's NOW, so the quiet times judge the same on every run.
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
  await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(ids => {
    const state = window.__globe;
    if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
    return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
  }, seed.tree.stories.map(s => s.id), { timeout: 60000 }).catch(async error => {
    console.error(JSON.stringify({ state: await page.evaluate(() => document.body.dataset.state + ' | ' + (document.querySelector('.empty')?.innerText ?? '')), errors, urls: failed, warnings: warnings.slice(0, 5) }));
    throw error;
  });
  // Territories arrive with the survey, and the claim outlines with the first read of the log: wait until both are drawn.
  await page.waitForFunction(() => { let outlines = 0, files = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('territory-claim:')) outlines++; if (o.name.startsWith('file:')) files++; }); return outlines > 0 && files > 0; }, undefined, { timeout: 30000 });
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  await settle(page);
  const results = { now: new Date(NOW).toISOString(), sessions: SESSIONS, capabilities: CAP, logLines: lines.length };
  // The rows the page's sessions list drew (it keeps them in page storage), as sessionRows made them.
  results.sessionRows = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('storytree.forest.sessions.v1:'));
    const kept = key === undefined ? null : JSON.parse(localStorage.getItem(key));
    const rows = kept?.rows ?? kept;
    return { key: key ?? null, rows: Array.isArray(rows) ? rows.map(r => ({ id: r.id, label: r.label, agent: r.agent, state: r.state, idle: r.idle, stories: r.stories })) : kept };
  });
  results.front = await measure(page);
  await page.screenshot({ path: path.join(out, `${prefix}front.png`), timeout: 180000 });

  const AGENT_LINK = 'story_05e45963ca9f', FOREST = 'story_be32e99ed54f';
  const faceIt = async story => {
    await page.evaluate(id => {
      const { scene, camera } = window.__globe, { rotation, onRotate } = window.__nav;
      const V = camera.position.constructor;
      const at = scene.getObjectByName(`planet:${id}`).getWorldPosition(new V()).normalize();
      const eye = camera.position.clone().normalize();
      const Q = camera.quaternion.constructor;
      onRotate(new Q().setFromUnitVectors(at, eye).multiply(rotation));
    }, story);
    await settle(page);
  };
  const zoomed = async () => { await page.evaluate(() => { const { camera, invalidate } = window.__globe; camera.zoom *= 2.6; camera.updateProjectionMatrix(); invalidate(); }); await settle(page); };
  const unzoom = async () => { await page.evaluate(() => { const { camera, invalidate } = window.__globe; camera.zoom /= 2.6; camera.updateProjectionMatrix(); invalidate(); }); await settle(page); };
  await faceIt(AGENT_LINK);
  await zoomed();
  results.closeUpAgentLink = await measure(page);
  await page.screenshot({ path: path.join(out, `${prefix}close-up-agent-link.png`), timeout: 180000 });
  await unzoom();
  await faceIt(FOREST);
  await zoomed();
  results.closeUpForest = await measure(page);
  await page.screenshot({ path: path.join(out, `${prefix}close-up-forest.png`), timeout: 180000 });
  await page.mouse.move(2, 2); await settle(page);

  results.browser = await browser.version(); results.errors = errors; results.warnings = [...new Set(warnings)];
  results.seed = seed.stats;
  writeFileSync(path.join(out, `${prefix}measurements.json`), JSON.stringify(results, null, 2) + '\n');
  assert.deepEqual(errors, []);
  // ADR-0923 D1: a claimed territory's outline is the only claim mark; no island's coast is tinted.
  for (const view of [results.front, results.closeUpAgentLink, results.closeUpForest]) assert.deepEqual(view.islands.flatMap(i => i.coastTintBands), [], 'no coast tint');
  console.log(JSON.stringify({ browser: results.browser, sessionRows: results.sessionRows, wispObjects: results.front.wispObjects,
    islands: results.front.islands.filter(i => i.coastTintBands.length || i.claimedTerritories.length).map(i => [i.story, i.coastTintBands.map(b => [b.session, b.colour, b.opacity]), i.claimedTerritories.map(t => [t.capability, t.claimedBy])]), errors }));
});
