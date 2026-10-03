// Pictures for forest 7.20 (ADR-0906): one session that worked on main outside a workspace (a warning), one setting up
// git with its first commit pending (a neutral label), and one ordinary row with neither. The actual desktop page, built
// by ../sessions-list/build.mjs; all activity is synthetic, and the agent link's own reading sets each flag from
// `main-state` lines (agent link 4.26).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBridge, withCapture } from '../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '../sessions-list/dist/production');
const seed = JSON.parse(readFileSync(path.join(here, '../../src/view/evidence/library-dots-clickable/seed.json'), 'utf8'));
const now = Date.now();
const at = minutes => new Date(now - minutes * 60_000).toISOString();
const lines = [];
function line(session, minutes, fields) {
  lines.push({ project: 'storytree', source: 'hook', harness: 'claude-code', session, machine: 'mint', seq: lines.length + 1, at: at(minutes), ...fields });
}
const home = '/home/me/code';
line('om-stray', 12, { kind: 'session-named', title: 'Fix the login redirect' });
line('om-stray', 10, { kind: 'file-edited', folder: `${home}/site`, branch: 'main', files: [`${home}/site/src/login.ts`] });
line('om-stray', 2, { kind: 'prompt-submitted', folder: `${home}/site`, branch: 'main' });
line('om-fresh', 9, { kind: 'session-named', title: 'Set up Conduit' });
line('om-fresh', 8, { kind: 'file-edited', folder: `${home}/conduit`, branch: 'main', files: [`${home}/conduit/.github/workflows/ci.yml`] });
line('om-fresh', 1, { kind: 'prompt-submitted', folder: `${home}/conduit`, branch: 'main' });
line('om-plain', 6, { kind: 'session-named', title: 'Sessions strip: work on main' });
line('om-plain', 1, { kind: 'prompt-submitted', folder: `${home}/storytree03/.claude/worktrees/on-main`, branch: 'claude/on-main' });
line('om-looker', 1, { kind: 'main-state', of: `${home}/site`, dirty: true });
line('om-looker', 1, { kind: 'main-state', of: `${home}/conduit`, dirty: true, unborn: true });
seed.lines = { lines, cursor: lines.length };
seed.tree.arcs = [];

await withCapture({ folder: here, dist }, async ({ browser, origin, out }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const bridge = fakeBridge({});
  await bridge.install(page);
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
  const label = id => list.locator(`.session-row[data-session-id="${id}"] .session-on-main`);
  await label('om-stray').waitFor();
  assert.equal(await label('om-stray').innerText(), 'on main');
  assert.equal(await label('om-stray').evaluate(span => getComputedStyle(span, '::before').content), '"⚠ "', 'the warning wears its sign');
  assert.equal(await label('om-fresh').evaluate(span => getComputedStyle(span, '::before').content), 'none', 'the neutral label none');
  assert.equal(await label('om-stray').getAttribute('title'), 'worked on main, outside a workspace');
  assert.equal(await label('om-fresh').innerText(), 'first commit');
  assert.equal(await label('om-plain').count(), 0);
  await page.waitForTimeout(800);
  await list.screenshot({ path: path.join(out, 'on-main-list.png') });
  assert.deepEqual(errors, []);
  console.log('Captured on-main');
});
