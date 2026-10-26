// Session traversal shows only for a selected session (owner, 2026-10-05): storytree's own globe (the code-rows snapshot and its
// survey) as the app opens it, five running sessions in the stand-in bridge, each holding a capability and with a window that
// opens three notes and a surveyed file no other window opens. Two views: none selected, then one session's row clicked.
// `node --import tsx build.mjs <checkout> before|after`, then `node --import tsx capture.mjs before|after` (append --retake to
// replace the committed pictures; --smoke runs the page built as `smoke`, takes no pictures and skips the fixed rests, so a test
// proves every wait below still resolves in a real browser). Counts, from the scene, every lit note, trail and file circle by colour, and every claimed
// territory, so "no traversal with none selected" and "who holds what unchanged" are measured, not looked at.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFolder, captureOutput, captureSeed, runCapture, seedFile } from '../../../../apps/desktop/src/capture/index.ts';
import { sessionColour } from '../../../forest/src/agent-claims/agent-claims.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
// --retake writes its pictures and measurements into the package's evidence set of this name; nothing here reads them.
const pictures = path.join(here, '../../evidence', 'traversal-when-selected');
const label = process.argv[2];
const smoke = process.argv.includes('--smoke');
assert.ok(['before', 'after'].includes(label), 'pass a before/after build label');
const { seed, survey } = captureSeed('code-rows');

// Every session worked in the last few minutes before the capture runs, so none is idle.
const NOW = Date.now();
const CHECKOUT = '/repo';
// Each session opens a file of one story's package, named by the seed's story title so a package rename cannot desync it.
const SESSIONS = {
  builder: { minutes: 2, reason: 'Build the window replay', capability: 'capability_062b84e5c6b0', story: 'The knowledge core', path: 'src/look-inside/look-inside.ts' },
  reviewer: { minutes: 3, reason: 'Review the sessions list', capability: null, story: 'The forest', path: 'src/sessions-list/sessions-list.ts' },
  curator: { minutes: 4, reason: 'Curate the decision log', capability: null, story: 'The library', path: 'src/api/library.ts' },
  scout: { minutes: 5, reason: 'Survey the agent link', capability: null, story: 'The agent link', path: 'src/activity/activity-log.ts' },
  'lane-north': { minutes: 6, reason: 'Port the command line', capability: null, story: 'The command line', path: 'src/args.ts' },
};
const SELECTED = 'scout';
const ids = Object.keys(SESSIONS);
const storyId = title => seed.tree.stories.find(story => story.title === title).id;
// Each session holds a capability of the story whose file it opens, so the claimed territories show beside the traversal.
for (const one of Object.values(SESSIONS)) {
  one.file = seedFile(seed, one.story, one.path);
  const file = survey[storyId(one.story)].files.find(f => f.path === one.path);
  assert.ok(file, `${one.file} is surveyed`);
  one.capability ??= file.capability;
}

const lines = [];
const line = (session, minutes, fields) => lines.push({ project: 'storytree', source: 'hook', harness: 'claude-code', session, seq: 0,
  at: new Date(NOW - minutes * 60_000).toISOString(), ...fields });
for (const [session, { minutes, reason, capability }] of Object.entries(SESSIONS)) {
  line(session, 40, { kind: 'session-started' });
  line(session, 39, { kind: 'claimed', source: 'tool', capability, reason });
  line(session, minutes, { kind: 'prompt-submitted' });
}
lines.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).forEach((one, i) => { one.seq = i + 1; });
seed.lines = { lines, cursor: lines.length };

// Three accepted decisions per session, none shared, so every lit note names one reader.
const latest = new Map(seed.changes.changes.map(change => [change.recordId, change]));
const notes = [...latest.values()].filter(c => c.type === 'decision' && c.action !== 'deleted' && c.record?.fields?.status === 'accepted').map(c => c.recordId).slice(-3 * ids.length);
const reads = Object.fromEntries(ids.map((session, i) => [session, notes.slice(3 * i, 3 * i + 3)]));
const windows = Object.fromEntries(ids.map(session => {
  const [a, b, c] = reads[session];
  return [session, { session, at: new Date(NOW).toISOString(), compactions: 0, inView: [], glimpses: [], opens: [
    { kind: 'note', id: a, call: `${session}-1`, tool: 'Bash', resident: true },
    { kind: 'file', id: `${CHECKOUT}/${SESSIONS[session].file}`, call: `${session}-2`, tool: 'Read', resident: true },
    { kind: 'note', id: b, call: `${session}-3`, tool: 'Bash', resident: true },
    { kind: 'note', id: c, call: `${session}-4`, tool: 'Bash', resident: true },
  ] }];
}));
const unread = session => ({ session, at: new Date(NOW).toISOString(), absent: 'no hook has named this session\'s transcript' });
const asked = [];
const windowReading = async (_, session) => { asked.push(session); return windows[session] ?? unread(session); };
const colour = Object.fromEntries(ids.map(session => [session, sessionColour(session)]));
assert.equal(new Set(Object.values(colour)).size, ids.length, 'five sessions, five colours');

/** What the globe draws for the sessions, counted from the scene. */
const measure = page => page.evaluate(() => {
  const { scene } = window.__globe;
  const trails = [], litNotes = {}, windowNotes = {}, litFiles = [], claimed = [];
  scene.traverse(object => {
    if (object.name.startsWith('knowledge-trail:')) trails.push({ from: object.userData.from, to: object.userData.to, colour: object.userData.colour });
    if (object.name.startsWith('knowledge-point:') && object.userData.lit) litNotes[object.userData.id] = object.userData.lit;
    if (object.name.startsWith('knowledge-point:') && object.userData.window) windowNotes[object.userData.id] = object.userData.colour;
    if (object.name.startsWith('file-lit:')) litFiles.push(object.name.slice('file-lit:'.length));
    if (object.name.startsWith('territory:') && object.userData.claimedBy !== undefined) claimed.push({ capability: object.userData.capability, claimedBy: object.userData.claimedBy });
  });
  return { trails, litNotes, windowNotes, litFiles, claimed };
});
const rowsShown = page => page.getByRole('complementary', { name: 'Running sessions', exact: true }).locator('.session-row').evaluateAll(list => list.map(row => row.dataset.sessionId));
const rest = async (page, settle) => { if (!smoke) await page.waitForTimeout(1500); await settle(page, 24); };

// Each phase goes to stderr as it starts, so a run killed from outside still says where it was (four macOS runs were killed
// at a fixed 180 s limit with nothing said, increment_724389f3f21d).
const started = performance.now();
const phase = message => console.error(`[traversal +${Math.round(performance.now() - started)} ms] ${message}`);
// A loaded runner draws the page's frames seconds apart, so a wait goes on while frames keep coming and fails, naming what it
// waited for, when none comes for STALL_MS (the page cannot draw) or at its cap (frames came, but the target never was drawn).
const STALL_MS = 30_000;
const framesDrawn = page => page.evaluate(() => {
  if (window.__captureFrames === undefined) {
    window.__captureFrames = 0;
    const tick = () => { window.__captureFrames++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  return window.__captureFrames;
});
const whileFramesCome = async (page, target, predicate, arg, capMs) => {
  phase(`wait for ${target}`);
  const from = performance.now();
  let seen = await framesDrawn(page);
  for (;;) {
    const left = capMs - (performance.now() - from);
    if (left <= 0) break;
    const slice = Math.min(STALL_MS, left);
    const done = await page.waitForFunction(predicate, arg, { timeout: slice }).then(() => true, error => { if (error.name !== 'TimeoutError') throw error; return false; });
    if (done) return phase(`${target}: drawn`);
    const now = await framesDrawn(page);
    if (now === seen && slice === STALL_MS) throw new Error(`${target}: no new frame for ${STALL_MS} ms (${now} frames drawn): rendering stalled`);
    seen = now;
  }
  throw new Error(`${target}: still not drawn after ${capMs} ms, though frames kept coming`);
};

const results = { label, sessions: SESSIONS, selected: SELECTED, colours: colour, reads };
phase('launch the browser and load the page');
await runCapture({
  folder: pictures, dist: buildFolder(here, smoke ? 'smoke' : label), seed, survey,
  answers: { windowReading, windowReadings: async (project, sessions) => Promise.all(sessions.map(one => windowReading(project, one))), idleAfterMs: async () => 30 * 60_000, leaveAfterMs: async () => 60 * 60_000 },
  prepare: async ({ page }) => {
    phase('page loaded');
    // The traversal is drawn on the knowledge graph under the glass sheet, which the Library face turns the sheet over to (ADR-1043 D3).
    await whileFramesCome(page, 'the ready page and its Library switch', () => document.body.dataset.state === 'ready' && !!document.querySelector('[data-globe-switch="library"]'), undefined, 120_000);
    await page.evaluate(() => document.querySelector('[data-globe-switch="library"][aria-pressed="false"]')?.click());
    await whileFramesCome(page, 'the glass sheet over every island', ids => {
      const state = window.__globe;
      if (document.body.dataset.state !== 'ready' || !state || !window.__nav || !state.scene.getObjectByName('sheet:under')) return false;
      return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
    }, seed.tree.stories.map(s => s.id), 120_000);
    await whileFramesCome(page, 'the claimed territories and file circles', () => { let outlines = 0, files = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('territory-claim:')) outlines++; if (o.name.startsWith('file:')) files++; }); return outlines > 0 && files > 0; }, undefined, 60_000);
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  },
  views: [{
    name: `${label}-none-selected`, ...(smoke ? { picture: false } : {}),
    prepare: async ({ page, settle }) => { phase('view: none selected'); await page.mouse.move(2, 2); await rest(page, settle); if (!smoke) await page.waitForTimeout(11_000); await rest(page, settle); },
    measure: async ({ page, browser }) => {
      results.browser = await browser.version();
      results.rows = await rowsShown(page);
      results.noneSelected = { ...(await measure(page)), windowsAsked: [...new Set(asked)] };
      return results.noneSelected;
    },
  }, {
    name: `${label}-one-selected`, ...(smoke ? { picture: false } : {}),
    prepare: async ({ page, settle }) => {
      const row = page.getByRole('complementary', { name: 'Running sessions', exact: true }).locator(`.session-row[data-session-id="${SELECTED}"]`);
      // Pointing at the row lights its session's islands, the globe's first draw of that highlight, which compiles six new shaders
      // (slow in software GL on a busy Windows runner). The click waits until that highlight is drawn, so its press and release
      // do not queue behind the compile (a click timed out there, PR #764's Windows run).
      phase('view: one selected; point at its row');
      await row.hover();
      await whileFramesCome(page, 'the pointed row\'s island highlight', story => !!window.__globe.scene.getObjectByName(`session-highlight:${story}`), storyId(SESSIONS[SELECTED].story), 60_000);
      await settle(page);
      phase('click the row');
      await row.click();
      await whileFramesCome(page, 'the selected window\'s notes in its colour', ([want, hsl]) => {
        const lit = {}; window.__globe.scene.traverse(o => { if (o.name.startsWith('knowledge-point:') && o.userData.window) lit[o.userData.id] = o.userData.colour; });
        return want.every(note => lit[note] === hsl);
      }, [reads[SELECTED], colour[SELECTED]], 60_000);
      await rest(page, settle);
    },
    measure: async ({ page, errors }) => {
      results.oneSelected = await measure(page);
      results.errors = errors;
      return results.oneSelected;
    },
  }],
});
const summary = view => ({ trails: view.trails.length, trailColours: [...new Set(view.trails.map(t => t.colour))].length, litNotes: Object.keys(view.litNotes).length,
  windowNotes: Object.keys(view.windowNotes).length, litFiles: view.litFiles.length, claimedTerritories: view.claimed.length });
phase('browser closed');
results.summary = { rows: results.rows.length, noneSelected: summary(results.noneSelected), oneSelected: summary(results.oneSelected), windowsAskedWithNoneSelected: results.noneSelected.windowsAsked.length };
writeFileSync(path.join(captureOutput(pictures), `measurements-${label}.json`), JSON.stringify(results, null, 1) + '\n');
console.log(label, JSON.stringify(results.summary));
