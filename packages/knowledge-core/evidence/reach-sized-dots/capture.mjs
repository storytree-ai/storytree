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
import { captureOutput, runCapture, visibleGlobeTargets, zoomGlobe } from '../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2];
assert.ok(['before', 'after'].includes(label), 'pass a before/after build label');
const rows = path.join(here, '../../../forest/src/view/evidence/code-rows');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(rows, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(rows, 'survey.json'), 'utf8'));

const NOW = Date.now();
const DAY = 86_400_000;
const SESSIONS = { builder: 2, reviewer: 3, scout: 5 };
const SELECTED = 'scout';

const prepare = async ({ page }) => {
  await page.waitForFunction(ids => {
    const state = window.__globe;
    if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
    return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
  }, seed.tree.stories.map(s => s.id), { timeout: 120000 });
  await page.waitForFunction(() => { let dots = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('knowledge-point:')) dots++; }); return dots > 0; }, undefined, { timeout: 60000 });
  for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
};
const rest = async (page, settle) => { await page.waitForTimeout(1500); await settle(page, 24); };
// Observe the real opening once, then seed reads on the dots it shows. No saved facing.json or separate probe run.
const [opening] = await runCapture({
  folder: here, dist: path.join(here, 'dist', label), seed: { ...seed, lines: { lines: [], cursor: 0 } }, survey,
  prepare,
  views: [{ name: 'visible-targets', picture: false,
    prepare: async ({ page, settle }) => { await page.mouse.move(2, 2); await rest(page, settle); },
    measure: ({ page }) => visibleGlobeTargets(page, { x: 0.5, y: 0.6 }),
  }],
});
const notes = opening.dots.map(dot => dot.id);
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
const measure = async page => {
  const { dots: visible } = await visibleGlobeTargets(page, { x: 0.5, y: 0.6 });
  return page.evaluate(visible => {
    const facing = new Set(visible.map(dot => dot.id));
    const dots = {};
    window.__globe.scene.traverse(object => {
      if (!object.name.startsWith('knowledge-point:')) return;
      dots[object.userData.id] = { radius: object.geometry.parameters.radius, facing: facing.has(object.userData.id), lit: object.userData.lit ?? null, window: object.userData.window ?? null };
    });
    return { dots };
  }, visible);
};
// A 1.5x close-up reaches the same wheel notch as the former eight-step loop.
const closeZoom = opening.zoom * 1.5;
const spots = opening.dots.filter(dot => read.slice(0, 6).includes(dot.id));
const zoomAt = spots.reduce((at, dot) => ({ x: at.x + dot.x / spots.length, y: at.y + dot.y / spots.length }), { x: 0, y: 0 });
const frame = async (page, target) => {
  const zoom = await zoomGlobe(page, target, zoomAt);
  assert.ok(Math.abs(zoom / target - 1) <= 0.03, `zoom ${zoom} reaches ${target}`);
  await page.mouse.move(2, 2);
};

const results = { label, selected: SELECTED, opened, stale };
await runCapture({
  folder: here, dist: path.join(here, 'dist', label), seed, survey,
  answers: { windowReading, windowReadings: async (project, sessions) => Promise.all(sessions.map(one => windowReading(project, one))), idleAfterMs: async () => 30 * 60_000, leaveAfterMs: async () => 60 * 60_000 },
  prepare,
  views: [{
    name: `${label}-none-selected`,
    prepare: async ({ page, settle }) => { await page.mouse.move(2, 2); await rest(page, settle); },
    measure: async ({ page, browser }) => {
      results.browser = await browser.version();
      results.noneSelected = await measure(page);
      return results.noneSelected;
    },
  }, {
    name: `${label}-none-selected-near`,
    prepare: async ({ page, settle }) => { await frame(page, closeZoom); await rest(page, settle); },
    measure: async () => ({}),
  }, {
    name: `${label}-one-selected`,
    prepare: async ({ page, settle }) => {
      await frame(page, opening.zoom);
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
    prepare: async ({ page, settle }) => { await frame(page, closeZoom); await rest(page, settle); },
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
