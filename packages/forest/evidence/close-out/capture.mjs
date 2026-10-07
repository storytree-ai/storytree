// Pictures for the owner's look at ADR-0758 (forest 7.9-7.11): the sessions list with a verified close-out gone,
// close-outs that need you flagged with their reason, and the quiet sessions folded into "N idle".
// The actual desktop page, built by ../sessions-list/build.mjs; all activity here is synthetic.
// CAPTURE_DIST=<a dist/production> CAPTURE_AS=<prefix> renders the same activity with another build (the control).
// Run both through `node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" --` (absolute checkout path).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBridge, withCapture } from '../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = process.env.CAPTURE_DIST ?? path.join(here, '../sessions-list/dist/production');
const as = process.env.CAPTURE_AS ?? 'after';
const seed = JSON.parse(readFileSync(path.join(here, '../../src/view/evidence/library-dots-clickable/seed.json'), 'utf8'));
const forest = seed.tree.stories.find(story => story.title === 'The forest');
const now = Date.now();
const at = minutes => new Date(now - minutes * 60_000).toISOString();
const lines = [];
function line(session, minutes, fields) {
  lines.push({ project: 'storytree', source: 'hook', harness: 'claude-code', session, seq: lines.length + 1, at: at(minutes), ...fields });
}
const home = '/home/me/code/storytree03';
const tree = name => `${home}/.claude/worktrees/${name}`;
// At work: one mid-turn, one whose turn just ended (waiting for you).
line('co-builder', 25, { kind: 'claimed', source: 'tool', capability: forest.capabilities[0].id, reason: 'Verified close-out: the list', folder: tree('close-out'), branch: 'close-out' });
line('co-builder', 3, { kind: 'prompt-submitted', folder: tree('close-out'), branch: 'close-out' });
line('co-asking', 9, { kind: 'prompt-submitted', folder: tree('fix-arc-drawer'), branch: 'fix-arc-drawer' });
line('co-asking', 6, { kind: 'turn-ended', folder: tree('fix-arc-drawer'), branch: 'fix-arc-drawer' });
// Said safe, but its branch is unmerged: needs you, with why.
line('co-unsure', 30, { kind: 'file-edited', files: ['login.ts'], folder: tree('fix-login'), branch: 'fix-login' });
line('co-unsure', 12, { kind: 'closed-out', source: 'tool', safe: true, why: 'all landed', running: 0, folder: tree('fix-login'), branch: 'fix-login' });
// Said not safe: needs you, with its why.
line('co-held', 20, { kind: 'prompt-submitted', folder: `${home}`, branch: 'main' });
line('co-held', 15, { kind: 'closed-out', source: 'tool', safe: false, why: "waiting on the owner's look", running: 0, folder: home, branch: 'main' });
// Said safe, and its branch merged: gone at once.
line('co-done', 40, { kind: 'file-edited', files: ['a.ts'], folder: tree('fix-typo'), branch: 'fix-typo' });
line('co-builder', 24, { kind: 'branch-state', of: 'fix-typo', open: false, how: 'merged', pr: 251, folder: tree('close-out'), branch: 'close-out' });
line('co-done', 2, { kind: 'closed-out', source: 'tool', safe: true, why: 'PR 251 merged, tree clean', running: 0, folder: tree('fix-typo'), branch: 'fix-typo' });
// Quiet, never closed out: idle.
for (const [session, minutes, folder] of [['co-idle-1', 42, 'tidy-readme'], ['co-idle-2', 48, 'probe-hooks'], ['co-idle-3', 55, 'look-wisps']]) {
  line(session, minutes + 5, { kind: 'prompt-submitted', folder: tree(folder), branch: 'main' });
  line(session, minutes, { kind: 'turn-ended', folder: tree(folder), branch: 'main' });
}
seed.lines = { lines, cursor: lines.length };
seed.tree.arcs = [];

await withCapture({ folder: here, dist }, async ({ browser, origin, out, settle }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const bridge = fakeBridge({});
  await bridge.install(page);
  process.once('exit', () => console.log('Bridge methods left to the stand-in:', bridge.defaulted.join(', ') || 'none'));
  await page.addInitScript(data => {
    const copy = value => structuredClone(value);
    window.storytreeAnswers = {
      projectSelection: async () => ({ projects: data.projects, current: 'storytree' }),
      projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => ({ changes: [], cursor }),
      linesSince: async (_, cursor) => ({ lines: copy(data.lines.lines.filter(item => item.seq > cursor)), cursor: data.lines.cursor }),
      frontCovers: async () => [], relatedNotes: async () => [], arcView: async () => null, waitHolds: async () => [], heldOnQuestion: async () => [],
      contextReadings: async (_, sessions) => sessions.map(session => ({ session, tokens: 310_000,
        composition: { injected: 40_000, grounding: 150_000, implementation: 90_000, other: 30_000 }, guidance: { value: 700_000 } })),
      idleAfterMs: async () => 30 * 60_000,
      readSurfaces: async () => ({ ok: false }), holds: async () => [],
      windowReading: async (_, session) => ({ session, at: new Date().toISOString(), absent: "no hook has named this session's transcript" }),
    };
  }, seed);
  await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
  const closeHelp = page.getByRole('button', { name: /^Close/ }).first();
  await page.waitForFunction(() => document.body.dataset.state === 'ready', null, { timeout: 15000 });
  if (await closeHelp.isVisible()) await closeHelp.click();
  const list = page.getByRole('complementary', { name: 'Running sessions', exact: true });
  await list.locator('.session-row[data-session-id="co-builder"]').waitFor();
  await page.waitForTimeout(800);
  await list.screenshot({ path: path.join(out, `${as}-list.png`) });
  const fold = list.locator('.session-idle-fold');
  if (as === 'after') {
    assert.equal(await list.locator('.sessions-count').innerText(), '4');
    assert.equal(await list.locator('.session-row[data-session-id="co-done"]').count(), 0, 'a verified close-out is gone');
    assert.equal(await fold.innerText(), '3 idle');
    await fold.click();
    await list.locator('.session-row[data-session-id="co-idle-3"]').waitFor();
    await page.waitForTimeout(300);
    await list.screenshot({ path: path.join(out, `${as}-idle-open.png`) });
  }
  assert.deepEqual(errors, []);
  console.log(`Captured ${as}`);
});
