// Session traversal shows only for a selected session (owner, 2026-10-05): storytree's own globe (the code-rows snapshot and its
// survey) as the app opens it, five running sessions in the stand-in bridge, each holding a capability and with a window that
// opens three notes and a surveyed file no other window opens. Two views: none selected, then one session's row clicked.
// `node --import tsx build.mjs <checkout> before|after`, then `node --import tsx capture.mjs before|after` (append --retake to
// replace the committed pictures; --smoke runs the page built as `smoke`, takes no pictures and skips the fixed rests, so a test
// proves every wait below still resolves in a real browser). Counts, from the scene, every lit note, trail and file circle by colour, and every claimed
// territory, so "no traversal with none selected" and "who holds what unchanged" are measured, not looked at.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureOutput, runCapture } from '../../../../apps/desktop/src/capture/index.ts';
import { sessionColour } from '../../../forest/src/agent-claims/agent-claims.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2];
const smoke = process.argv.includes('--smoke');
assert.ok(['before', 'after'].includes(label), 'pass a before/after build label');
const rows = path.join(here, '../../../forest/src/view/evidence/code-rows');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(rows, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(rows, 'survey.json'), 'utf8'));

// Every session worked in the last few minutes before the capture runs, so none is idle.
const NOW = Date.now();
const CHECKOUT = '/repo';
// The paths are the seed's: its snapshot of the library predates the agent link's rename to Session management.
const SESSIONS = {
  builder: { minutes: 2, reason: 'Build the window replay', capability: 'capability_062b84e5c6b0', file: 'packages/knowledge-core/src/look-inside/look-inside.ts' },
  reviewer: { minutes: 3, reason: 'Review the sessions list', capability: null, file: 'packages/forest/src/sessions-list/sessions-list.ts' },
  curator: { minutes: 4, reason: 'Curate the decision log', capability: null, file: 'packages/library/src/api/library.ts' },
  scout: { minutes: 5, reason: 'Survey the agent link', capability: null, file: 'packages/agent-link/src/activity/activity-log.ts' },
  'lane-north': { minutes: 6, reason: 'Port the command line', capability: null, file: 'packages/cli/src/args.ts' },
};
const SELECTED = 'scout';
const ids = Object.keys(SESSIONS);
// Each session holds a capability of the story whose file it opens, so the claimed territories show beside the traversal.
const storyOfPackage = { 'knowledge-core': 'story_d754d997f22a', forest: 'story_deee4230348c', library: 'story_754e87e7d531', 'agent-link': 'story_609c3b171b3f', cli: 'story_f9fb5136c28f' };
for (const one of Object.values(SESSIONS)) {
  const [, pkg, rest] = /^packages\/([^/]+)\/(.+)$/.exec(one.file);
  const file = survey[storyOfPackage[pkg]].files.find(f => f.path === rest);
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

const results = { label, sessions: SESSIONS, selected: SELECTED, colours: colour, reads };
await runCapture({
  folder: here, dist: path.join(here, 'dist', smoke ? 'smoke' : label), seed, survey,
  answers: { windowReading, windowReadings: async (project, sessions) => Promise.all(sessions.map(one => windowReading(project, one))), idleAfterMs: async () => 30 * 60_000, leaveAfterMs: async () => 60 * 60_000 },
  prepare: async ({ page }) => {
    await page.waitForFunction(ids => {
      const state = window.__globe;
      if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
      return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
    }, seed.tree.stories.map(s => s.id), { timeout: 120000 });
    await page.waitForFunction(() => { let outlines = 0, files = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('territory-claim:')) outlines++; if (o.name.startsWith('file:')) files++; }); return outlines > 0 && files > 0; }, undefined, { timeout: 60000 });
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  },
  views: [{
    name: `${label}-none-selected`, ...(smoke ? { picture: false } : {}),
    prepare: async ({ page, settle }) => { await page.mouse.move(2, 2); await rest(page, settle); if (!smoke) await page.waitForTimeout(11_000); await rest(page, settle); },
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
      await row.hover();
      await page.waitForFunction(story => !!window.__globe.scene.getObjectByName(`session-highlight:${story}`), storyOfPackage['agent-link'], { timeout: 30000 });
      await settle(page);
      await row.click();
      await page.waitForFunction(([want, hsl]) => {
        const lit = {}; window.__globe.scene.traverse(o => { if (o.name.startsWith('knowledge-point:') && o.userData.window) lit[o.userData.id] = o.userData.colour; });
        return want.every(note => lit[note] === hsl);
      }, [reads[SELECTED], colour[SELECTED]], { timeout: 30000 });
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
results.summary = { rows: results.rows.length, noneSelected: summary(results.noneSelected), oneSelected: summary(results.oneSelected), windowsAskedWithNoneSelected: results.noneSelected.windowsAsked.length };
writeFileSync(path.join(captureOutput(here), `measurements-${label}.json`), JSON.stringify(results, null, 1) + '\n');
console.log(label, JSON.stringify(results.summary));
