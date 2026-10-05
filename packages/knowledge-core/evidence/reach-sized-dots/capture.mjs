// Knowledge dots sized by 90-day reach (ADR-0926): storytree's own globe (the code-rows snapshot and its survey) as the app
// opens it, with 40 past sessions' reads in the activity log spread over the last 90 days (a few notes read widely, most by
// a session or two, some only peeked, one read only 120 days ago) and three running sessions, one with a window. Two views:
// none selected, then that session's row clicked. `node --import tsx build.mjs <checkout> before|after`, then
// `node --import tsx capture.mjs before|after` (append --retake to replace the committed pictures). Measures every
// knowledge dot's drawn radius, as a fraction of the globe's, from the scene, so "size follows reach" and "a lit note
// keeps its size" are counted, not looked at.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureOutput, runCapture } from '../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2];
assert.ok(['before', 'after', 'probe'].includes(label), 'pass a before/after build label, or probe');
// `probe` (run on the before build) lists the knowledge dots facing the camera into facing.json, so the reads fall where they can be seen.
const facingFile = path.join(here, 'facing.json');
const rows = path.join(here, '../../../forest/src/view/evidence/code-rows');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(rows, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(rows, 'survey.json'), 'utf8'));

const NOW = Date.now();
const DAY = 86_400_000;
const SESSIONS = { builder: 2, reviewer: 3, scout: 5 };
const SELECTED = 'scout';
const ids = Object.keys(SESSIONS);

// Accepted decisions, in a stable order: the first is read most widely, reach falling off down the list.
const latest = new Map(seed.changes.changes.map(change => [change.recordId, change]));
const accepted = [...latest.values()].filter(c => c.type === 'decision' && c.action !== 'deleted' && c.record?.fields?.status === 'accepted').map(c => c.recordId).sort();
const notes = label === 'probe' ? accepted : JSON.parse(readFileSync(facingFile, 'utf8'));
assert.ok(notes.length >= 31, `${notes.length} facing notes: at least 31 are needed`);
const read = notes.slice(0, 24);
const PAST = 40;
const lines = [];
const line = (session, at, fields) => lines.push({ project: 'storytree', source: 'hook', harness: 'claude-code', session, seq: 0, at: new Date(at).toISOString(), ...fields });
const noteRead = (session, at, note, how) => line(session, at, { kind: 'note-read', source: 'tool', note, found: 'search', read: how, agent: 'orchestrator' });
for (let s = 0; s < PAST; s++) {
  const session = `past-${s}`, at = NOW - (2 + s * 2) * DAY;
  // Note i is read whole by about PAST / (i + 1) sessions; the last eight of the list are only peeked, by a few.
  read.forEach((note, i) => {
    if (i < 16 && s % (i + 1) === 0) { noteRead(session, at, note, 'whole'); noteRead(session, at + 60_000, note, 'whole'); }
    else if (i >= 16 && s % (i - 12) === 0) noteRead(session, at, note, 'peek');
  });
}
// Read widely, but only 120 days ago: outside the window, so it reaches nobody now.
const stale = notes[24];
for (let s = 0; s < PAST; s++) noteRead(`ancient-${s}`, NOW - 120 * DAY, stale, 'whole');
for (const [session, minutes] of Object.entries(SESSIONS)) {
  line(session, NOW - 40 * 60_000, { kind: 'session-started' });
  line(session, NOW - minutes * 60_000, { kind: 'prompt-submitted' });
}
lines.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).forEach((one, i) => { one.seq = i + 1; });
seed.lines = { lines, cursor: lines.length };

// The selected session's window opens a widely read note, a rarely read one and one nobody read.
const opened = [read[0], read[12], notes[30]];
const windows = { [SELECTED]: { session: SELECTED, at: new Date(NOW).toISOString(), compactions: 0, inView: [], glimpses: [], opens: opened.map((id, i) => ({ kind: 'note', id, call: `c${i}`, tool: 'Bash', resident: true })) } };
const unread = session => ({ session, at: new Date(NOW).toISOString(), absent: 'no hook has named this session\'s transcript' });
const windowReading = async (_, session) => windows[session] ?? unread(session);

/** Every knowledge dot's drawn radius as a fraction of the globe's, and which are lit or windowed. */
const measure = page => page.evaluate(() => {
  const { scene, camera } = window.__globe;
  const dots = {};
  scene.traverse(object => {
    if (!object.name.startsWith('knowledge-point:')) return;
    const at = object.getWorldPosition(object.position.clone());
    const ndc = at.clone().project(camera);
    // Facing: nearer the camera than the globe's centre is, and in the middle of the picture.
    const facing = at.distanceTo(camera.position) < camera.position.length() && Math.abs(ndc.x) < 0.5 && Math.abs(ndc.y) < 0.6;
    dots[object.userData.id] = { radius: object.geometry.parameters.radius, facing, lit: object.userData.lit ?? null, window: object.userData.window ?? null };
  });
  return { dots };
});
// Zoom in on the most-read notes with the mouse wheel, as a user would, so dots a few pixels across at the globe's full view
// can be told apart; zooming out again by the same steps returns to the full view.
const ZOOM_STEPS = 8;
const zoom = async (page, ids, direction) => {
  const at = await page.evaluate(ids => {
    const { scene, camera, gl } = window.__globe;
    const box = gl.domElement.getBoundingClientRect();
    const spots = [];
    scene.traverse(o => {
      if (!o.name.startsWith('knowledge-point:') || !ids.includes(o.userData.id)) return;
      const p = o.getWorldPosition(o.position.clone()).project(camera);
      spots.push([box.left + (p.x + 1) / 2 * box.width, box.top + (1 - p.y) / 2 * box.height]);
    });
    return spots.reduce(([x, y], [a, b]) => [x + a / spots.length, y + b / spots.length], [0, 0]);
  }, ids);
  await page.mouse.move(at[0], at[1]);
  for (let i = 0; i < ZOOM_STEPS; i++) { await page.mouse.wheel(0, direction * 240); await page.waitForTimeout(120); }
  await page.mouse.move(2, 2);
};
const rest = async (page, settle) => { await page.waitForTimeout(1500); await settle(page, 24); };

const results = { label, selected: SELECTED, opened, stale };
await runCapture({
  folder: here, dist: path.join(here, 'dist', label), seed, survey,
  answers: { windowReading, windowReadings: async (project, sessions) => Promise.all(sessions.map(one => windowReading(project, one))), idleAfterMs: async () => 30 * 60_000, leaveAfterMs: async () => 60 * 60_000 },
  prepare: async ({ page }) => {
    await page.waitForFunction(ids => {
      const state = window.__globe;
      if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
      return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
    }, seed.tree.stories.map(s => s.id), { timeout: 120000 });
    await page.waitForFunction(() => { let dots = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('knowledge-point:')) dots++; }); return dots > 0; }, undefined, { timeout: 60000 });
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  },
  views: [{
    name: `${label}-none-selected`,
    prepare: async ({ page, settle }) => { await page.mouse.move(2, 2); await rest(page, settle); },
    measure: async ({ page, browser }) => {
      results.browser = await browser.version();
      results.noneSelected = await measure(page);
      if (label === 'probe') {
        const facing = Object.entries(results.noneSelected.dots).filter(([, dot]) => dot.facing).map(([id]) => id).sort();
        writeFileSync(facingFile, JSON.stringify(facing, null, 1) + '\n');
        console.log(`${facing.length} facing dots`);
        process.exit(0);
      }
      return results.noneSelected;
    },
  }, {
    name: `${label}-none-selected-near`,
    prepare: async ({ page, settle }) => { await zoom(page, read.slice(0, 6), -1); await rest(page, settle); },
    measure: async () => ({}),
  }, {
    name: `${label}-one-selected`,
    prepare: async ({ page, settle }) => {
      await zoom(page, read.slice(0, 6), 1);
      const row = page.getByRole('complementary', { name: 'Running sessions', exact: true }).locator(`.session-row[data-session-id="${SELECTED}"]`);
      await row.click();
      await page.waitForFunction(want => {
        const shown = new Set(); window.__globe.scene.traverse(o => { if (o.name.startsWith('knowledge-point:') && o.userData.window) shown.add(o.userData.id); });
        return want.every(note => shown.has(note));
      }, opened, { timeout: 30000 });
      await rest(page, settle);
    },
    measure: async ({ page, errors }) => {
      results.oneSelected = await measure(page);
      results.errors = errors;
      return results.oneSelected;
    },
  }, {
    name: `${label}-one-selected-near`,
    prepare: async ({ page, settle }) => { await zoom(page, read.slice(0, 6), -1); await rest(page, settle); },
    measure: async () => ({}),
  }],
});
// The globe's radius is not in the scene's userData; a dot's size is read relative to the smallest drawn.
const sizes = view => Object.values(view.dots).map(({ radius }) => radius);
const summary = view => {
  const all = sizes(view), floor = Math.min(...all);
  const of = note => view.dots[note] === undefined ? null : +(view.dots[note].radius / floor).toFixed(3);
  return { dots: all.length, distinctSizes: new Set(all.map(r => r.toFixed(6))).size, largestOverFloor: +(Math.max(...all) / floor).toFixed(3),
    mostRead: of(read[0]), rarelyRead: of(read[12]), peekedOnly: of(read[23]), readOnly120DaysAgo: of(stale), opened: Object.fromEntries(opened.map(note => [note, of(note)])) };
};
results.summary = { noneSelected: summary(results.noneSelected), oneSelected: summary(results.oneSelected) };
delete results.noneSelected.dots; delete results.oneSelected.dots;
writeFileSync(path.join(captureOutput(here), `measurements-${label}.json`), JSON.stringify(results, null, 1) + '\n');
console.log(label, JSON.stringify(results.summary));
