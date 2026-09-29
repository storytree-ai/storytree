// Pictures for the owner's look at ADR-0754 D4 on the list (forest 7.12): a session holding unmerged work marked with
// its branches, the user's leave-after setting (3 hours here) keeping a two-hour-quiet session listed, and a finished,
// unarchived desktop window counted in "N idle".
// The actual desktop page, built by ../sessions-list/build.mjs; all activity here is synthetic.
// Run through flock /tmp/storytree-heavy.lock after building the page.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '../sessions-list/dist/production');
const as = 'marked';
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
// At work: one mid-turn (it also read the desktop app's record of an unarchived window).
line('co-builder', 25, { kind: 'claimed', source: 'tool', capability: forest.capabilities[0].id, reason: 'Sessions list: leave-after, unmerged', folder: tree('leave-after'), branch: 'leave-after' });
line('co-builder', 25, { kind: 'session-unarchived', source: 'tool', of: 'co-desk', app: 'claude-desktop', folder: tree('leave-after'), branch: 'leave-after' });
line('co-builder', 3, { kind: 'prompt-submitted', folder: tree('leave-after'), branch: 'leave-after' });
// Waiting for you, and holding two unmerged branches: marked.
line('co-asking', 40, { kind: 'file-edited', files: ['hooks.ts'], folder: tree('probe-hooks'), branch: 'probe-hooks' });
line('co-asking', 30, { kind: 'file-edited', files: ['README.md'], folder: tree('tidy-readme'), branch: 'tidy-readme' });
line('co-asking', 12, { kind: 'prompt-submitted', folder: tree('tidy-readme'), branch: 'tidy-readme' });
line('co-asking', 10, { kind: 'turn-ended', folder: tree('tidy-readme'), branch: 'tidy-readme' });
// Quiet three hours, never closed out, its branch unmerged: listed, idle, marked.
line('co-holding', 190, { kind: 'claimed', source: 'tool', capability: forest.capabilities[0].id, reason: 'Arc drawer: fold queued lanes', folder: tree('fold-lanes'), branch: 'fold-lanes' });
line('co-holding', 185, { kind: 'prompt-submitted', folder: tree('fold-lanes'), branch: 'fold-lanes' });
line('co-holding', 180, { kind: 'turn-ended', folder: tree('fold-lanes'), branch: 'fold-lanes' });
// Quiet two hours, nothing unmerged: gone at the 1-hour default, listed (idle) under a 3-hour leave-after.
line('co-quiet', 125, { kind: 'prompt-submitted', folder: home, branch: 'main' });
line('co-quiet', 120, { kind: 'turn-ended', folder: home, branch: 'main' });
// A desktop window, finished four hours ago and not archived: idle.
line('co-desk', 245, { kind: 'prompt-submitted', folder: home, branch: 'main' });
line('co-desk', 240, { kind: 'turn-ended', folder: home, branch: 'main' });
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
  await page.addInitScript(data => {
    const copy = value => structuredClone(value);
    window.storytree = {
      projectSelection: async () => ({ projects: data.projects, current: 'storytree' }),
      projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => ({ changes: [], cursor }),
      linesSince: async (_, cursor) => ({ lines: copy(data.lines.lines.filter(item => item.seq > cursor)), cursor: data.lines.cursor }),
      frontCovers: async () => [], relatedNotes: async () => [], arcView: async () => null, waitHolds: async () => [], heldOnQuestion: async () => [],
      contextReadings: async (_, sessions) => sessions.map(session => ({ session, tokens: 310_000,
        composition: { injected: 40_000, grounding: 150_000, implementation: 90_000, other: 30_000 }, guidance: { value: 700_000 } })),
      idleAfterMs: async () => 30 * 60_000,
      leaveAfterMs: async () => 3 * 60 * 60_000,
      readSurfaces: async () => ({ ok: false }), holds: async () => [],
      windowReading: async (_, session) => ({ session, at: new Date().toISOString(), absent: "no hook has named this session's transcript" }),
    };
  }, seed);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
  const closeHelp = page.getByRole('button', { name: /^Close/ }).first();
  await page.waitForFunction(() => document.body.dataset.state === 'ready', null, { timeout: 15000 });
  if (await closeHelp.isVisible()) await closeHelp.click();
  const list = page.getByRole('complementary', { name: 'Running sessions', exact: true });
  await list.locator('.session-row[data-session-id="co-builder"]').waitFor();
  await page.waitForTimeout(800);
  await list.screenshot({ path: path.join(here, `${as}-list.png`) });
  const fold = list.locator('.session-idle-fold');
  assert.equal(await list.locator('.sessions-count').innerText(), '2');
  assert.equal(await fold.innerText(), '3 idle');
  assert.equal(await list.locator('li:has(> .session-row[data-session-id="co-asking"]) .session-unmerged').innerText(), 'Holding unmerged work: probe-hooks, tidy-readme');
  await fold.click();
  await list.locator('.session-row[data-session-id="co-desk"]').waitFor();
  await page.waitForTimeout(300);
  await list.screenshot({ path: path.join(here, `${as}-idle-open.png`) });
  assert.equal(await list.locator('li:has(> .session-row[data-session-id="co-holding"]) .session-unmerged').innerText(), 'Holding unmerged work: fold-lanes');
  assert.deepEqual(errors, []);
  console.log(`Captured ${as}`);
} finally {
  await browser?.close();
  server.close();
}
