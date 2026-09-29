// Pictures for the owner's look at contract 7.8: a session row, collapsed and expanded to its worktrees and window files.
// The actual desktop page, built by ../sessions-list/build.mjs; all activity here is synthetic.
// Run both through flock /tmp/storytree-heavy.lock.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '../sessions-list/dist/production');
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
  page.on('console', message => { if (message.type() === 'error') console.error('console:', message.text()); });
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
      idleAfterMs: async () => 60 * 60_000,
      readSurfaces: async () => ({ ok: false }), holds: async () => [],
      windowReading: async (_, session) => session === data.window.session ? copy(data.window) : { session, at: data.window.at, absent: "no hook has named this session's transcript" },
    };
  }, seed);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
  const closeHelp = page.getByRole('button', { name: /^Close/ }).first();
  await page.waitForFunction(() => document.body.dataset.state === 'ready', null, { timeout: 15000 }).catch(async error => { console.error(errors, await page.evaluate(() => [document.body.dataset.state, document.body.innerText.slice(0, 400)])); throw error; });
  if (await closeHelp.isVisible()) await closeHelp.click();
  const list = page.getByRole('complementary', { name: 'Running sessions', exact: true });
  const row = list.locator(`.session-row[data-session-id="${ids.builder}"]`);
  await row.waitFor();
  await page.waitForTimeout(500);
  await list.screenshot({ path: path.join(here, 'collapsed.png') });
  await row.getByRole('button', { name: /^Show detail/ }).click();
  const detail = list.locator('.session-detail');
  await detail.locator('.session-detail-files li').first().waitFor();
  const text = await detail.innerText();
  for (const tree of trees) assert.ok(text.includes(tree), `lists ${tree}`);
  assert.equal(await detail.locator('.session-detail-files li').count(), opened.length);
  assert.equal(await detail.locator('li[data-resident="no"]').count(), 1);
  await list.locator(`.session-row[data-session-id="${ids.helper}"]`).waitFor();
  await page.waitForTimeout(300);
  await list.screenshot({ path: path.join(here, 'expanded.png') });
  assert.deepEqual(errors, []);
  console.log('Captured collapsed.png and expanded.png');
} finally {
  await browser?.close();
  server.close();
}
