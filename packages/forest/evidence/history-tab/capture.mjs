// Pictures for forest 7.21-7.23: the sessions strip's Live and History tabs, a range chosen, and a history row selected.
// The actual desktop page, built by ../sessions-list/build.mjs; all activity is synthetic. Two sessions are at work now;
// the rest have left the live list (a verified close-out, or ended), across today, yesterday and four days ago.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBridge, withCapture } from '../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '../sessions-list/dist/production');
const seed = JSON.parse(readFileSync(path.join(here, '../../src/view/evidence/library-dots-clickable/seed.json'), 'utf8'));
const today = new Date();
const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
// A time `days` before today's midnight, at `hour` local, never later than a minute ago.
const at = (days, hour) => new Date(Math.min(midnight - days * 86_400_000 + hour * 3_600_000, Date.now() - 60_000)).toISOString();
const ago = minutes => new Date(Date.now() - minutes * 60_000).toISOString();
const stories = seed.tree.stories;
const cap = index => stories[index % stories.length].capabilities[0]?.id ?? stories[index % stories.length].id;
const lines = [];
function line(session, time, fields) {
  lines.push({ project: 'storytree', source: 'hook', harness: 'claude-code', session, machine: 'mint', seq: lines.length + 1, at: time, ...fields });
}
// At work now.
line('live-one', ago(20), { kind: 'session-named', title: 'Sessions list: History tab' });
line('live-one', ago(18), { kind: 'claimed', source: 'tool', capability: cap(0), reason: 'Sessions list: History tab' });
line('live-one', ago(1), { kind: 'prompt-submitted' });
line('live-two', ago(30), { kind: 'claimed', source: 'tool', capability: cap(1), reason: 'Arc surface: question cards', harness: 'codex' });
line('live-two', ago(2), { kind: 'prompt-submitted', harness: 'codex' });
// Today, landed: claimed an increment, its pull request merged, closed it as landed, closed out verified.
line('past-landed', at(0, 0.2), { kind: 'session-named', title: 'Near-side names above the strip' });
line('past-landed', at(0, 0.25), { kind: 'claimed', source: 'tool', increment: 'inc-names', reason: 'Near-side names above the strip', branch: 'claude/names' });
line('ci', at(0, 0.9), { kind: 'merged', increment: 'inc-names', holder: 'past-landed', branch: 'claude/names', pr: 523, source: 'tool' });
line('past-landed', at(0, 1), { kind: 'closed', source: 'tool', increment: 'inc-names', disposition: 'landed' });
line('past-landed', at(0, 1.1), { kind: 'closed-out', source: 'tool', safe: true, why: 'merged, clean', running: 0 });
// Today, ended without a close-out.
line('past-quiet', at(0, 0.3), { kind: 'session-started', harness: 'codex', folder: '/home/me/code/storytree03/.claude/worktrees/tidy-docs' });
line('past-quiet', at(0, 0.6), { kind: 'session-ended', harness: 'codex' });
// Yesterday, held on a question asked while it ran.
line('past-held', at(1, 14), { kind: 'claimed', source: 'tool', increment: 'inc-tabs', reason: 'Pick the strip tab layout' });
line('past-held', at(1, 15), { kind: 'session-ended' });
// Yesterday, closed out with nothing to land.
line('past-closed', at(1, 9), { kind: 'session-named', title: 'Read the friction queue', harness: 'codex' });
line('past-closed', at(1, 9.5), { kind: 'closed-out', source: 'tool', safe: true, why: 'nothing to land', running: 0, harness: 'codex' });
// Four days ago, landed two pull requests.
line('past-old', at(4, 10), { kind: 'claimed', source: 'tool', capability: cap(2), reason: 'Context bar legend' });
line('ci', at(4, 11), { kind: 'merged', capability: cap(2), holder: 'past-old', branch: 'claude/legend', pr: 202, source: 'tool' });
line('ci', at(4, 12), { kind: 'merged', capability: cap(2), holder: 'past-old', branch: 'claude/legend-2', pr: 204, source: 'tool' });
line('past-old', at(4, 12.5), { kind: 'closed-out', source: 'tool', safe: true, why: 'merged', running: 0 });
seed.lines = { lines, cursor: lines.length };
seed.tree.arcs = [];
const arcViews = [{ arc: { id: 'arc-strip', type: 'arc', fields: { title: 'The sessions list' } }, state: 'active',
  increments: [
    { id: 'inc-names', type: 'increment', createdAt: at(1, 1), fields: { arc: 'arc-strip', title: 'Near-side names', status: 'closed', touches: [stories[3 % stories.length].id],
      outcome: { date: '2026-10-02', disposition: 'landed', pr: '523' } } },
    { id: 'inc-tabs', type: 'increment', createdAt: at(2, 1), fields: { arc: 'arc-strip', title: 'Tabs', status: 'ready', touches: [stories[4 % stories.length].id], heldOn: ['q-tabs'] } },
  ],
  questions: [{ id: 'q-tabs', type: 'question', createdAt: at(1, 14.5), fields: { arc: 'arc-strip', title: 'Which tab opens first?', lifecycle: 'open' } }] }];

await withCapture({ folder: here, dist }, async ({ browser, origin, out }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const bridge = fakeBridge({});
  await bridge.install(page);
  await page.addInitScript(([data, views]) => {
    const copy = value => structuredClone(value);
    window.storytreeAnswers = {
      projectSelection: async () => ({ projects: data.projects, current: 'storytree' }),
      projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => ({ changes: [], cursor }),
      linesSince: async (_, cursor) => ({ lines: copy(data.lines.lines.filter(item => item.seq > cursor)), cursor: data.lines.cursor }),
      arcViews: async () => copy(views),
      frontCovers: async () => [], relatedNotes: async () => [], arcView: async () => null, waitHolds: async () => [], heldOnQuestion: async () => [],
      contextReadings: async (_, sessions) => sessions.map(session => ({ session, tokens: 210_000,
        composition: { injected: 60_000, grounding: 70_000, implementation: 50_000, other: 30_000 }, guidance: { value: 700_000 } })),
      idleAfterMs: async () => 30 * 60_000,
      leaveAfterMs: async () => 60 * 60_000,
      readSurfaces: async () => ({ ok: false }), holds: async () => [],
      windowReading: async (_, session) => ({ session, at: new Date().toISOString(), absent: "no hook has named this session's transcript" }),
    };
  }, [seed, arcViews]);
  await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
  const closeHelp = page.getByRole('button', { name: /^Close/ }).first();
  await page.waitForFunction(() => document.body.dataset.state === 'ready', null, { timeout: 15000 });
  if (await closeHelp.isVisible()) await closeHelp.click();
  const list = page.getByRole('complementary', { name: 'Running sessions', exact: true });
  await list.locator('.session-row[data-session-id="live-one"]').waitFor();
  await page.waitForTimeout(800);
  await list.screenshot({ path: path.join(out, 'history-live-tab.png') });
  // The globe above the strip (the strip lies over the canvas's lower edge, and is what changes).
  const canvas = await page.locator('canvas').first().boundingBox();
  const strip = await list.boundingBox();
  // The strip is at most 40% of the pane tall (7.17), so the globe's upper half is never under it.
  const above = { x: canvas.x, y: canvas.y, width: canvas.width, height: Math.min(strip.y - canvas.y, canvas.height * 0.5) };
  const globe = { screenshot: () => page.screenshot({ clip: above }) };
  const before = await globe.screenshot();
  await page.waitForTimeout(800);
  assert.ok(before.equals(await globe.screenshot()), 'the globe is still when nothing is done');

  // 7.22: opening History leaves the globe as it was.
  await list.getByRole('tab', { name: 'History' }).click();
  const rows = list.locator('.history-row');
  await rows.first().waitFor();
  assert.deepEqual(await rows.evaluateAll(all => all.map(row => row.dataset.sessionId)), ['past-landed', 'past-quiet'], 'Today: the two that left today, latest first');
  assert.equal(await list.locator('.session-row').count(), 0, 'no live rows under History');
  await page.waitForTimeout(800);
  const after = await globe.screenshot();
  assert.ok(before.equals(after), 'opening History changes nothing on the globe');
  await list.screenshot({ path: path.join(out, 'history-today.png') });

  // A range chosen: seven days.
  await list.getByRole('button', { name: '7 days' }).click();
  assert.deepEqual(await rows.evaluateAll(all => all.map(row => row.dataset.sessionId)), ['past-landed', 'past-quiet', 'past-held', 'past-closed', 'past-old']);
  assert.deepEqual(await list.locator('.history-outcome').allInnerTexts(),
    ['Landed #523', 'Ended without a close-out', 'Held: Which tab opens first?', 'Closed out', 'Landed #202 · #204']);
  await page.waitForTimeout(500);
  assert.ok(before.equals(await globe.screenshot()), 'choosing a range changes nothing on the globe');
  await page.mouse.move(5, 5);
  await list.screenshot({ path: path.join(out, 'history-seven-days.png') });

  // 7.23: selecting a history row selects its session, as a live row does.
  await list.locator('.history-row[data-session-id="past-held"]').click();
  await list.locator('.history-row[data-session-id="past-held"][data-selected]').waitFor();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(out, 'history-row-selected.png') });
  await list.screenshot({ path: path.join(out, 'history-row-selected-strip.png') });
  await list.locator('.history-row[data-session-id="past-held"]').click();
  await list.locator('.history-row[data-selected]').waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  console.log('Captured history-tab');
});
