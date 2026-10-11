// Pictures for idle sessions moving from the Live tab to a searchable History (forest 7.10, 7.21, 7.28, ADR-1002 D4): Live with
// no idle row, History with the idle sessions first, and a search typed. The real desktop page, built by ./build.mjs; all activity is synthetic.
// CAPTURE_PLAYWRIGHT and CAPTURE_CHROMIUM point at playwright-core and a headless Chromium on the capturing machine.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureSeed, fakeBridge, withCapture } from '../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist/production');
const { seed } = captureSeed('forest');
const forest = seed.tree.stories.find(story => story.title === 'The forest');
const now = Date.now();
const at = minutes => new Date(now - minutes * 60_000).toISOString();
const lines = [];
function line(session, minutes, fields) {
  lines.push({ project: 'storytree', source: 'hook', harness: 'claude-code', session, seq: lines.length + 1, at: at(minutes), ...fields });
}
const home = '/home/me/code/storytree03';
const tree = name => `${home}/.claude/worktrees/${name}`;

// At work: one mid-turn, one waiting within the idle-after time.
line('ih-builder', 40, { kind: 'claimed', source: 'tool', capability: forest.capabilities[0].id, reason: 'Idle sessions to searchable History', folder: tree('idle-history'), branch: 'idle-history' });
line('ih-builder', 25, { kind: 'prompt-submitted', folder: tree('idle-history'), branch: 'idle-history' });
line('ih-builder', 4, { kind: 'command-started', command: 'pnpm gate', call: 'c1', folder: tree('idle-history'), branch: 'idle-history' });
line('ih-waiting', 30, { kind: 'claimed', source: 'tool', increment: 'inc-wait', reason: 'Hosted library location setting', folder: tree('library-location'), branch: 'library-location' });
line('ih-waiting', 18, { kind: 'prompt-submitted', folder: tree('library-location'), branch: 'library-location' });
line('ih-waiting', 9, { kind: 'turn-ended', background: 0, folder: tree('library-location'), branch: 'library-location' });
// Idle: quiet past the idle-after time, never closed out, still listed.
line('ih-idle-1', 50, { kind: 'claimed', source: 'tool', capability: forest.capabilities[1].id, reason: 'Wisps orbit their islands', folder: tree('wisps'), branch: 'wisps' });
for (const [session, minutes, folder] of [['ih-idle-1', 42, 'wisps'], ['ih-idle-2', 48, 'probe-hooks'], ['ih-idle-3', 52, 'tidy-readme']]) {
  line(session, minutes + 5, { kind: 'prompt-submitted', folder: tree(folder), branch: folder });
  line(session, minutes, { kind: 'turn-ended', background: 0, folder: tree(folder), branch: folder });
}
// Ended: quiet past the leave-after time, so the live list no longer lists them.
line('ih-lander', 200, { kind: 'claimed', source: 'tool', capability: forest.capabilities[2].id, reason: 'The strip expands to fill the pane', folder: tree('full-strip'), branch: 'full-strip' });
line('ih-lander', 180, { kind: 'prompt-submitted', folder: tree('full-strip'), branch: 'full-strip' });
line('ih-lander', 120, { kind: 'turn-ended', background: 0, folder: tree('full-strip'), branch: 'full-strip' });
line('ih-looker', 119, { kind: 'merged', capability: forest.capabilities[2].id, holder: 'ih-lander', branch: 'full-strip', pr: 1181, folder: home, branch: 'main' });
line('ih-ender', 240, { kind: 'prompt-submitted', folder: tree('probe-globe'), branch: 'probe-globe' });
line('ih-ender', 150, { kind: 'turn-ended', background: 0, folder: tree('probe-globe'), branch: 'probe-globe' });
// Their branches are merged, so no open work keeps them listed.
line('ih-looker', 118, { kind: 'branch-state', of: 'full-strip', open: false, how: 'merged', pr: 1181, folder: home, branch: 'main' });
line('ih-looker', 117, { kind: 'branch-state', of: 'probe-globe', open: false, how: 'merged', pr: 1175, folder: home, branch: 'main' });
seed.lines = { lines, cursor: lines.length };
seed.tree.arcs = [];

await withCapture({ folder: here, dist }, async ({ browser, origin, out }) => {
  const measures = {};
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const bridge = fakeBridge({});
  await bridge.install(page);
  await page.addInitScript(data => {
    const copy = value => structuredClone(value);
    let served = 0;
    window.storytreeAnswers = {
      projectSelection: async () => ({ projects: data.projects, current: 'storytree' }),
      projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => ({ changes: [], cursor }),
      linesSince: async (_, cursor) => ({ lines: copy(data.lines.lines.filter(item => item.seq > Math.max(cursor, served))), cursor: (served = data.lines.cursor) }),
      frontCovers: async () => [], relatedNotes: async () => [], arcView: async () => null, waitHolds: async () => [], heldOnQuestion: async () => [],
      contextReadings: async (_, sessions) => sessions.map(session => ({ session, tokens: 310_000,
        composition: { injected: 40_000, grounding: 150_000, implementation: 90_000, other: 30_000 }, guidance: { value: 700_000 } })),
      idleAfterMs: async () => 30 * 60_000, leaveAfterMs: async () => 60 * 60_000,
      readSurfaces: async () => ({ ok: false }), holds: async () => [],
      windowReadings: async (_, sessions) => sessions.map(session => ({ session, at: new Date().toISOString(), absent: "no hook has named this session's transcript" })),
    };
  }, seed);
  const list = page.getByRole('complementary', { name: 'Running sessions', exact: true });
  await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.state === 'ready', null, { timeout: 15000 });
  const closeHelp = page.getByRole('button', { name: /^Close/ }).first();
  if (await closeHelp.isVisible()) await closeHelp.click();
  await list.locator('.session-row[data-session-id="ih-builder"]').waitFor();
  await page.waitForTimeout(1200);
  const shot = async file => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, file) }); };
  const ids = selector => list.locator(selector).evaluateAll(nodes => nodes.map(node => node.dataset.sessionId));

  // Live: only the sessions at work, no idle row; the header still counts them.
  measures.live = { rows: await ids('.session-row'), count: await list.locator('.sessions-count').textContent(), idleFold: await list.locator('.session-idle-fold').count() };
  assert.deepEqual(measures.live.rows.sort(), ['ih-builder', 'ih-waiting'], JSON.stringify(measures.live));
  assert.equal(measures.live.count, '2');
  assert.equal(measures.live.idleFold, 0);
  await shot('live-at-work-only.png');

  // History: the idle sessions first, led by "idle", each with its expander; then the ones that left today.
  await list.getByRole('tab', { name: 'History' }).click();
  await list.locator('.history-search').waitFor();
  measures.history = { rows: await ids('[data-session-id]'), leads: await list.locator('.history-outcome').allTextContents() };
  assert.deepEqual(measures.history.rows.slice(0, 3).sort(), ['ih-idle-1', 'ih-idle-2', 'ih-idle-3'], JSON.stringify(measures.history));
  assert.deepEqual(measures.history.rows.slice(3), ['ih-lander', 'ih-ender'], JSON.stringify(measures.history));
  assert.deepEqual(measures.history.leads, ['idle', 'idle', 'idle', 'Landed #1181', 'Ended without a close-out']);
  assert.equal(await list.locator('.session-row[data-session-id="ih-idle-1"] .session-children-toggle').count(), 1, 'an idle row keeps its expander');
  await list.locator('.session-row[data-session-id="ih-idle-1"] .session-children-toggle').click();
  await list.locator('.session-detail').first().waitFor();
  await shot('history-idle-first.png');
  await list.locator('.session-row[data-session-id="ih-idle-1"] .session-children-toggle').click();

  // A search typed: every word, whatever the case.
  await list.locator('.history-search').fill('WISPS idle');
  measures.searchWisps = await ids('[data-session-id]');
  assert.deepEqual(measures.searchWisps, ['ih-idle-1']);
  await list.locator('.history-search').fill('landed 1181');
  measures.searchLanded = await ids('[data-session-id]');
  assert.deepEqual(measures.searchLanded, ['ih-lander']);
  await shot('history-search-typed.png');
  await list.locator('.history-search').fill('nothing like it');
  assert.equal(await list.getByText('No sessions match the search').count(), 1);
  await shot('history-search-none.png');
  await list.locator('.history-search').fill('');
  assert.equal((await ids('[data-session-id]')).length, 5, 'emptied, every row returns');
  assert.deepEqual(errors, []);
  await context.close();
  writeFileSync(path.join(out, 'measures.json'), JSON.stringify(measures, null, 2) + '\n');
  console.log(JSON.stringify(measures));
});
