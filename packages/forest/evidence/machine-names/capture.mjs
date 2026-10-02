// Pictures for forest 7.13 and the expander at the row's start: sessions on two machines, each named, one with a
// subagent (+1) and one expanded. The actual desktop page, built by ../sessions-list/build.mjs; all activity is synthetic.
// PLANET_PLAYWRIGHT and PLANET_CHROMIUM point at playwright-core and a headless Chromium on the capturing machine.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBridge, withCapture } from '../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '../sessions-list/dist/production');
const seed = JSON.parse(readFileSync(path.join(here, '../../src/view/evidence/library-dots-clickable/seed.json'), 'utf8'));
const forest = seed.tree.stories.find(story => story.title === 'The forest');
const now = Date.now();
const at = minutes => new Date(now - minutes * 60_000).toISOString();
const lines = [];
function line(session, minutes, machine, fields) {
  lines.push({ project: 'storytree', source: 'hook', harness: 'claude-code', session, machine, seq: lines.length + 1, at: at(minutes), ...fields });
}
const home = '/home/me/code/storytree03';
line('mn-laptop', 20, 'laptop', { kind: 'claimed', source: 'tool', capability: forest.capabilities[0].id, reason: 'Session list: machine names, arrow first', folder: `${home}/.claude/worktrees/machine-names` });
line('mn-laptop', 2, 'laptop', { kind: 'prompt-submitted', folder: `${home}/.claude/worktrees/machine-names` });
line('mn-laptop', 2, 'laptop', { kind: 'subagent-started', subagent: 'mn-explorer', task: 'Find session title source' });
line('mn-mint', 15, 'mint', { kind: 'claimed', source: 'tool', capability: forest.capabilities[0].id, reason: 'Merged branches stop reading unmerged', folder: `${home}/.claude/worktrees/merged-branches` });
line('mn-mint', 1, 'mint', { kind: 'prompt-submitted', folder: `${home}/.claude/worktrees/merged-branches` });
line('mn-plain', 5, 'laptop', { kind: 'prompt-submitted', folder: home });
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
      contextReadings: async (_, sessions) => sessions.map(session => ({ session, tokens: 210_000,
        composition: { injected: 60_000, grounding: 70_000, implementation: 50_000, other: 30_000 }, guidance: { value: 700_000 } })),
      idleAfterMs: async () => 30 * 60_000,
      leaveAfterMs: async () => 60 * 60_000,
      readSurfaces: async () => ({ ok: false }), holds: async () => [],
      windowReading: async (_, session) => ({ session, at: new Date().toISOString(), absent: "no hook has named this session's transcript" }),
    };
  }, seed);
  await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
  const closeHelp = page.getByRole('button', { name: /^Close/ }).first();
  await page.waitForFunction(() => document.body.dataset.state === 'ready', null, { timeout: 15000 });
  if (await closeHelp.isVisible()) await closeHelp.click();
  const list = page.getByRole('complementary', { name: 'Running sessions', exact: true });
  await list.locator('.session-row[data-session-id="mn-mint"]').waitFor();
  // Every row starts expanded (forest 7.17): fold the laptop's row first, for the folded picture.
  await list.locator('.session-row[data-session-id="mn-explorer"]').waitFor();
  await list.locator('.session-row[data-session-id="mn-laptop"] .session-children-toggle').click();
  await list.locator('.session-row[data-session-id="mn-explorer"]').waitFor({ state: 'detached' });
  await page.waitForTimeout(800);
  await list.screenshot({ path: path.join(out, 'machine-names-list.png') });
  assert.equal(await list.locator('.session-row[data-session-id="mn-mint"] .session-machine').innerText(), 'mint');
  assert.equal(await list.locator('.session-row[data-session-id="mn-laptop"] .session-children').innerText(), '+1');
  const first = await list.locator('.session-row[data-session-id="mn-laptop"] > *').first().getAttribute('class');
  assert.equal(first, 'session-children-toggle');
  await list.locator('.session-row[data-session-id="mn-laptop"] .session-children-toggle').click();
  await list.locator('.session-row[data-session-id="mn-explorer"]').waitFor();
  await page.waitForTimeout(300);
  await list.screenshot({ path: path.join(out, 'machine-names-expanded.png') });
  assert.deepEqual(errors, []);
  console.log('Captured machine-names');
});
