// Pictures for the owner's look at contract 7.8: a session row, collapsed and expanded to its worktrees and window files.
// The actual desktop page, built by ../sessions-list/build.mjs; all activity here is synthetic.
// Run both through `node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" --` (absolute checkout path). --smoke builds its own page
// into dist/smoke, takes no pictures and skips the fixed rests, so a test proves every wait below still resolves in a real browser.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, fakeBridge, withCapture } from '../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const smoke = process.argv.includes('--smoke');
const dist = smoke ? path.join(here, 'dist/smoke') : path.join(here, '../sessions-list/dist/production');
if (smoke) await buildCapture({ dist });
const seed = JSON.parse(readFileSync(path.join(here, '../../src/view/evidence/library-dots-clickable/seed.json'), 'utf8'));
const forest = seed.tree.stories.find(story => story.title === 'The forest');
const ids = { builder: 'rowdetail-builder', helper: 'rowdetail-helper', quiet: 'rowdetail-quiet' };
const now = Date.now();
const at = minutes => new Date(now - minutes * 60_000).toISOString();
const lines = [];
function line(session, minutes, fields) {
  lines.push({ project: 'storytree', source: 'hook', harness: 'claude-code', session, seq: lines.length + 1, at: at(minutes), ...fields });
}
const home = '/home/me/code/storytree03';
const trees = ['increment-cf029b8fab75-6a0f08', 'increment-21835528d844-1b2c3d', 'increment-f8f6975c481a-9e8f7a'].map(name => `${home}/.claude/worktrees/${name}`);
line(ids.builder, 40, { kind: 'session-started', folder: trees[0] });
line(ids.builder, 38, { kind: 'claimed', source: 'tool', capability: forest.capabilities[0].id, reason: 'Expandable session rows: detail', folder: trees[0] });
line(ids.builder, 20, { kind: 'command-run', command: 'pnpm gate', folder: trees[1] });
line(ids.builder, 2, { kind: 'file-edited', files: ['a.ts'], folder: trees[2] });
line(ids.builder, 30, { kind: 'subagent-started', subagent: ids.helper, type: 'explorer', task: 'Find the window reading' });
line(ids.quiet, 6, { kind: 'session-started', harness: 'codex', folder: `${home}/.claude/worktrees/tidy-readme` });
seed.lines = { lines, cursor: lines.length };
const opened = [
  ['packages/forest/src/view/sessions-list.tsx', true], ['packages/agent-link/src/context/window.ts', false],
  ['packages/forest/src/sessions-list/sessions-list.ts', true], ['packages/app/src/surfaces/reads.ts', true],
  ['packages/forest/src/view/styles.css', true],
].map(([id, resident]) => ({ kind: 'file', id, call: id, tool: 'Read', resident, inViewFrom: [] }));
seed.window = { session: ids.builder, at: new Date(now).toISOString(), inView: [], compactions: 1, opens: opened };
seed.tree.arcs = [];

await withCapture({ folder: here, dist }, async ({ browser, origin, out, settle }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') console.error('console:', message.text()); });
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
      idleAfterMs: async () => 60 * 60_000,
      readSurfaces: async () => ({ ok: false }), holds: async () => [],
      // The list reads every row's window in one batch (forest 7.17), answered as one read per session.
      windowReadings(project, sessions) { return Promise.all(sessions.map(one => this.windowReading(project, one))); },
      windowReading: async (_, session) => session === data.window.session ? copy(data.window) : { session, at: data.window.at, absent: "no hook has named this session's transcript" },
    };
  }, seed);
  await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
  const closeHelp = page.getByRole('button', { name: /^Close/ }).first();
  await page.waitForFunction(() => document.body.dataset.state === 'ready', null, { timeout: 15000 }).catch(async error => { console.error(errors, await page.evaluate(() => [document.body.dataset.state, document.body.innerText.slice(0, 400)])); throw error; });
  if (await closeHelp.isVisible()) await closeHelp.click();
  const list = page.getByRole('complementary', { name: 'Running sessions', exact: true });
  const row = list.locator(`.session-row[data-session-id="${ids.builder}"]`);
  await row.waitFor();
  // Every row starts collapsed (forest 7.8), as the collapsed picture shows it.
  await row.getByRole('button', { name: /^Show detail/ }).waitFor();
  if (!smoke) { await page.waitForTimeout(500); await list.screenshot({ path: path.join(out, 'collapsed.png') }); }
  const toggles = await list.locator('.session-children-toggle').evaluateAll(items => items.map(item => item.getAttribute('aria-expanded')));
  assert.ok(toggles.length > 0 && toggles.every(open => open === 'false'), `every row starts collapsed: ${toggles}`);
  assert.equal(await list.locator('.session-detail').count(), 0, 'no detail drawn while collapsed');
  await row.getByRole('button', { name: /^Show detail/ }).click();
  const detail = list.locator('li', { has: page.locator(`.session-row[data-session-id="${ids.builder}"]`) }).locator('.session-detail');
  await detail.locator('.session-detail-files li').first().waitFor();
  const text = await detail.innerText();
  assert.ok(text.includes('Worktrees') && text.includes('Files'), 'labels both blocks');
  assert.deepEqual(await detail.locator('.session-detail-worktrees li').evaluateAll(items => items.map(item => [item.textContent, item.title])),
    trees.map(tree => [path.basename(tree), tree]), 'each worktree by its folder name, its full path on hover');
  assert.equal(await detail.locator('.session-detail-files li').count(), opened.length);
  assert.equal(await detail.locator('li[data-resident="no"]').count(), 1);
  await list.locator(`.session-row[data-session-id="${ids.helper}"]`).waitFor();
  if (!smoke) { await page.waitForTimeout(300); await list.screenshot({ path: path.join(out, 'expanded.png') }); }
  assert.deepEqual(errors, []);
  console.log(smoke ? 'Smoke run: no pictures' : 'Captured collapsed.png and expanded.png');
  console.log(JSON.stringify({ collapsed: toggles.length, worktrees: await detail.locator('.session-detail-worktrees li').count(),
    files: await detail.locator('.session-detail-files li').count(), muted: await detail.locator('li[data-resident="no"]').count() }));
});
