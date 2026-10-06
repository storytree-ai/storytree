// Seeded, repeatable capture of the actual desktop page (ADR-0825 D3, territory health): the knowledge-under-islands
// snapshot with each capability given a word (below), the session-tints agent log at the fixed clock NOW, the same
// 1440 x 960 viewport and the same programmatic turns; nothing is hand-panned. Run `node build.mjs`, then this, under
// flock /tmp/storytree-heavy.lock. Measures what can be counted before anyone looks, and writes measurements.json.
// --smoke runs the page built by `node build.mjs smoke` and takes no pictures, so a test proves every wait below still
// resolves in a real browser.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const smoke = process.argv.includes('--smoke');
const seed = JSON.parse(readFileSync(path.join(here, '../knowledge-under-islands/seed.json'), 'utf8'));
// survey.json is readCodeSurvey(<this checkout>, seed.tree), precomputed by `tsx survey.mjs`.
const survey = JSON.parse(readFileSync(path.join(here, '../session-tints/survey.json'), 'utf8'));
// The snapshot predates ADR-0744's word, so each capability is given one: its verified column's (passing reads
// healthy, anything else untested), with these seeded so every word shows. Cloud connection is the real library's
// one red card on 2026-10-01; Hooks is red so a failure sits beside a claim on The agent link.
const WORDS = { capability_2417a0fb5578: 'unhealthy', capability_f3c4cf342304: 'unhealthy', capability_b59e959e0da8: 'proposed', capability_cd33386156ad: 'proposed' };
for (const story of seed.tree.stories) for (const capability of story.capabilities) {
  capability.status = WORDS[capability.id] ?? (capability.health.verified.state === 'passing' ? 'healthy' : 'untested');
  capability.proposed = capability.status === 'proposed';
  if (capability.status === 'unhealthy') capability.health = { ...capability.health, verified: { state: 'failing' } };
}
await withCapture({ folder: here, dist: path.join(here, 'dist', ...(smoke ? ['smoke'] : [])) }, async ({ browser, origin, out, settle }) => {
const picture = (page, name) => smoke ? undefined : page.screenshot({ path: path.join(out, name), timeout: 180000 });



// The agent log the stand-in bridge hands the page, at the fixed clock NOW. Real capability ids from the seed tree.
const NOW = Date.parse('2026-10-01T12:00:00.000Z');
// Session ids whose hashed hues sit well apart (207, 301, 248), as in ../session-tints.
const SESSIONS = { A: '3b229329-6239-408a-a88c-2669d839ca45', B: '6f840d71-eb64-48f6-a176-c7f28c62e1e0', C: 'f0697f0c-0b04-458c-a539-c36eab0d0743' };
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

/** What the land drew, counted from the scene and the page: each territory's word and fill, each claim outline, and the rim markers. */
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
          territories.push({ capability: child.userData.capability ?? null, title: child.userData.title ?? 'Unclaimed code', word: child.userData.word ?? null,
            fill: '#' + child.material.color.getHexString(), opacity: child.material.opacity, saturation: Math.round(hsl.s * 100) / 100, claimedBy: child.userData.claimedBy ?? null });
        }
        if (child.name.startsWith('territory-hatch:')) hatches.push({ colour: '#' + child.material.color.getHexString(), opacity: child.material.opacity, segments: child.geometry.attributes.position.count / 2, renderOrder: child.renderOrder });
        if (child.name.startsWith('territory-claim:')) outlines.push({ capability: child.userData.capability, colour: child.userData.colour, drawn: '#' + child.material.color.getHexString(),
          opacity: child.material.opacity, faded: child.userData.faded, triangles: child.geometry.attributes.position.count / 3 });
      });
      islands.push({ story: object.name.slice(7), territories, claimOutlines: outlines, hatches });
    });
    const filled = islands.flatMap(i => i.territories).filter(t => t.opacity > 0 && t.capability !== null);
    const uncharted = islands.flatMap(i => i.territories.filter(t => t.capability === null).map(t => ({ story: i.story, fill: t.fill, opacity: t.opacity, saturation: t.saturation, hatches: i.hatches })));
    const markers = [...document.querySelectorAll('.planet-edge-marker')].map(m => ({ story: m.dataset.failingStory, title: m.title, label: m.getAttribute('aria-label') }));
    return { zoom: camera.zoom, fills: [...new Set(filled.map(t => `${t.word} ${t.fill} ${t.opacity}`))].sort(), greyFills: filled.filter(t => t.saturation < 0.3).length, uncharted, markers, islands };
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
  // The shared stand-in bridge answers whatever the page asks beyond the answers below.
  const bridge = fakeBridge({});
  await bridge.install(page);
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
  await picture(page, 'front.png');

  const AGENT_LINK = 'story_05e45963ca9f', FOREST = 'story_be32e99ed54f', LIBRARY = 'story_eb7d623fb9c8';
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
  for (const [name, story] of [['agent-link', AGENT_LINK], ['forest', FOREST], ['library', LIBRARY], ['command-line', 'story_20549f1d48af']]) {
    await faceIt(story);
    await zoomed();
    results[`closeUp-${name}`] = await measure(page);
    await picture(page, `close-up-${name}.png`);
    await unzoom();
  }
  // Turn the globe half round about its up axis from the library facing: the failures go behind, and their rim markers show.
  await faceIt(LIBRARY);
  await page.evaluate(() => {
    const { camera } = window.__globe, { rotation, onRotate } = window.__nav;
    const Q = camera.quaternion.constructor, V = camera.position.constructor;
    onRotate(new Q().setFromAxisAngle(new V(0, 1, 0).applyQuaternion(camera.quaternion), Math.PI).multiply(rotation));
  });
  await settle(page);
  await page.waitForFunction(() => document.querySelectorAll('.planet-edge-marker').length > 0, undefined, { timeout: 10000 }).catch(() => {});
  await settle(page);
  results.turnedAway = await measure(page);
  await picture(page, 'rim-markers.png');
  await page.mouse.move(2, 2); await settle(page);

  results.browser = await browser.version(); results.errors = errors; results.warnings = [...new Set(warnings)];
  results.seed = seed.stats;
  writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(results, null, 2) + '\n');
  // Page errors are recorded, not asserted: the stand-in bridge answers nothing for panels newer than it (sign-in and
  // the like), which throw on the missing answer. The land's own marks are asserted from the scene below.
  assert.equal(results.front.greyFills, 0);
  console.log(JSON.stringify({ browser: results.browser, fills: results.front.fills, greyFills: results.front.greyFills,
    outlines: results.front.islands.flatMap(i => i.claimOutlines.map(o => [i.story, o.capability, o.colour, o.opacity, o.triangles])), markers: results.turnedAway.markers, errors }));
});
