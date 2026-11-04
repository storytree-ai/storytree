// Pictures for the owner's look at contracts 7.2 and 7.8: a running session folded, its subagent counted by its "+N", then expanded to its worktrees and its subagent, with no Running or Files block.
// The actual desktop page, built by ../sessions-list/build.mjs; all activity here is synthetic.
// Run both through `node ~/.storytree/your-factory/plugins/micks-dev-loop/src/heavy-lock.mjs --`, from storytree's checkout root. --smoke builds its own page
// into its build folder's smoke/, takes no pictures and skips the fixed rests, so a test proves every wait below still resolves in a real browser.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureSeed, fakeBridge, withCapture } from '../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
// Pictures and measurements go to the package's evidence set of this name (a scratch folder unless --retake); nothing here reads them.
const evidence = path.join(here, '../../evidence', 'row-detail');
const smoke = process.argv.includes('--smoke');
const dist = smoke ? buildFolder(here, 'smoke') : buildFolder(path.join(here, '../sessions-list'), 'production');
if (smoke) await buildCapture({ dist });
const { seed } = captureSeed('forest');
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
seed.tree.arcs = [];

await withCapture({ folder: evidence, dist }, async ({ browser, origin, out, settle }) => {
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
    };
  }, seed);
  await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
  const closeHelp = page.getByRole('button', { name: /^Close/ }).first();
  await page.waitForFunction(() => document.body.dataset.state === 'ready', null, { timeout: 15000 }).catch(async error => { console.error(errors, await page.evaluate(() => [document.body.dataset.state, document.body.innerText.slice(0, 400)])); throw error; });
  if (await closeHelp.isVisible()) await closeHelp.click();
  await page.locator('[data-rail-tab="sessions"]').click(); // the sessions list is the left rail's Sessions tab (ADR-1219)
  const list = page.getByRole('complementary', { name: 'Running sessions', exact: true });
  const row = list.locator(`.session-row[data-session-id="${ids.builder}"]`);
  await row.waitFor();
  // Every row's detail starts closed (forest 7.8), and the running builder's subagent waits behind its "+1" until it is expanded (7.2), as the folded picture shows it.
  await row.locator('.session-children', { hasText: '+1' }).waitFor();
  const helper = list.locator(`.session-row[data-session-id="${ids.helper}"]`);
  if (!smoke) { await page.waitForTimeout(500); await list.screenshot({ path: path.join(out, 'folded.png') }); }
  const toggles = await list.locator('.session-children-toggle').evaluateAll(items => items.map(item => item.getAttribute('aria-expanded')));
  assert.ok(toggles.length > 0 && toggles.every(open => open === 'false'), `every row's detail starts closed: ${toggles}`);
  const folded = await helper.count();
  assert.equal(await list.locator('.session-detail').count(), 0, 'no detail drawn while collapsed');
  await row.getByRole('button', { name: /^Show detail/ }).click();
  const detail = list.locator('li', { has: page.locator(`.session-row[data-session-id="${ids.builder}"]`) }).locator('.session-detail');
  await detail.locator('.session-detail-worktrees li').first().waitFor();
  // Its detail is its words, its worktrees and its children: no Running or Files block (7.8).
  const blocks = await detail.locator('.session-detail-label').allTextContents();
  assert.deepEqual(await detail.locator('.session-detail-worktrees li').evaluateAll(items => items.map(item => [item.textContent, item.title])),
    trees.map(tree => [path.basename(tree), tree]), 'each worktree by its folder name, its full path on hover');
  await helper.waitFor();
  assert.equal(await row.locator('.session-children').count(), 0, 'no "+N" once the children show');
  if (!smoke) { await page.waitForTimeout(300); await list.screenshot({ path: path.join(out, 'expanded.png') }); }
  assert.deepEqual(errors, []);
  console.log(smoke ? 'Smoke run: no pictures' : 'Captured folded.png and expanded.png');
  console.log(JSON.stringify({ closed: toggles.length, folded, children: await helper.count(), worktrees: await detail.locator('.session-detail-worktrees li').count(), blocks }));
});
