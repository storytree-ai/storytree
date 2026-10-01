// Picture for the owner's look at ADR-0749 D1/D2: every non-ended session shows, one works in two worktrees.
// The actual desktop page, built by ../sessions-list/build.mjs; all activity here is synthetic.
// Run both through flock /tmp/storytree-heavy.lock.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureOutput, fakeBridge } from '../../../../apps/desktop/src/capture/index.ts'; // the shared stand-in bridge: run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const out = captureOutput(here); // pictures and measurements: a scratch folder unless run with --retake
const dist = path.join(here, '../sessions-list/dist/production');
const seed = JSON.parse(readFileSync(path.join(here, '../../src/view/evidence/library-dots-clickable/seed.json'), 'utf8'));
const forest = seed.tree.stories.find(story => story.title === 'The forest');
const ids = { claimed: 'every-claimed', unclaimed: 'every-unclaimed', twoTrees: 'every-two-worktrees', idle: 'every-idle', ended: 'every-ended' };
const now = Date.now();
const at = minutes => new Date(now - minutes * 60_000).toISOString();
const lines = [];
function line(session, minutes, fields) {
  lines.push({ project: 'storytree', source: 'hook', harness: 'claude-code', session, seq: lines.length + 1, at: at(minutes), ...fields });
}
const home = '/home/me/code/storytree03';
line(ids.claimed, 9, { kind: 'session-started', folder: home });
line(ids.claimed, 8, { kind: 'claimed', source: 'tool', capability: forest.capabilities[0].id, reason: 'Every session shows', folder: home });
line(ids.unclaimed, 6, { kind: 'session-started', harness: 'codex', folder: `${home}/.claude/worktrees/tidy-readme` });
line(ids.unclaimed, 1, { kind: 'file-edited', harness: 'codex', files: ['README.md'], folder: `${home}/.claude/worktrees/tidy-readme` });
line(ids.twoTrees, 20, { kind: 'session-started', folder: `${home}/.claude/worktrees/increment-3682fed188dc` });
line(ids.twoTrees, 12, { kind: 'command-run', command: 'pnpm gate', folder: `${home}/.claude/worktrees/increment-3682fed188dc` });
line(ids.twoTrees, 2, { kind: 'file-edited', files: ['a.ts'], folder: `${home}/.claude/worktrees/increment-410d87e9a1aa` });
line(ids.idle, 90, { kind: 'session-started', folder: `${home}/.claude/worktrees/overnight` });
line(ids.ended, 5, { kind: 'session-started', folder: home });
line(ids.ended, 4, { kind: 'session-ended', reason: 'other' });
seed.lines = { lines, cursor: lines.length };
seed.tree.arcs = [];

const { chromium } = await import(process.env.PLANET_PLAYWRIGHT
  ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!['index.html', 'renderer.js', 'styles.css', 'arc-surface.css', 'app-setup.css', 'forest.css'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(readFileSync(path.join(dist, name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PLANET_CHROMIUM
    ?? '/home/mickh/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell', headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
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
        composition: { injected: 40_000, grounding: 150_000, implementation: 90_000, other: 30_000 } })),
      idleAfterMs: async () => 60 * 60_000,
    };
  }, seed);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
  const closeHelp = page.getByRole('button', { name: /^Close/ }).first();
  await page.waitForFunction(() => document.body.dataset.state === 'ready');
  if (await closeHelp.isVisible()) await closeHelp.click();
  const list = page.getByRole('complementary', { name: 'Running sessions', exact: true });
  await list.locator(`.session-row[data-session-id="${ids.unclaimed}"]`).waitFor();
  const shown = await list.locator('.session-row').evaluateAll(nodes => nodes.map(node => node.dataset.sessionId).sort());
  assert.deepEqual(shown, [ids.claimed, ids.idle, ids.twoTrees, ids.unclaimed].sort(), 'every non-ended session shows; the ended one does not');
  assert.match(await list.locator(`[data-session-id="${ids.unclaimed}"]`).innerText(), /Codex · tidy-readme/);
  assert.match(await list.locator(`[data-session-id="${ids.twoTrees}"]`).innerText(), /2 worktrees/);
  assert.equal(await list.locator(`[data-session-id="${ids.idle}"]`).getAttribute('data-state'), 'idle', 'idle past the 60-minute setting');
  await page.waitForTimeout(500);
  await list.screenshot({ path: path.join(out, 'every-session.png') });
  assert.deepEqual(errors, []);
  console.log('Captured every-session.png:', shown.join(', '));
} finally {
  await browser?.close();
  server.close();
}
