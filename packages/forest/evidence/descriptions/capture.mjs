// Pictures for forest 7.14: rows named by their app's title, and an expanded row opening with its description (its app's
// title, its increment's objective, its app's latest status). Sessions on two machines, as 7.13 draws them. The actual desktop page, built by ../sessions-list/build.mjs; all activity is synthetic.
// PLANET_PLAYWRIGHT and PLANET_CHROMIUM point at playwright-core and a headless Chromium on the capturing machine.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeBridge } from '../../../../apps/desktop/src/capture/index.ts'; // the shared stand-in bridge: run with node --import tsx

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
line('mn-laptop', 20, 'laptop', { kind: 'claimed', source: 'tool', capability: forest.capabilities[1].id, reason: 'Session list: titles and descriptions', folder: `${home}/.claude/worktrees/machine-names` });
line('mn-laptop', 2, 'laptop', { kind: 'prompt-submitted', folder: `${home}/.claude/worktrees/machine-names` });
line('mn-laptop', 2, 'laptop', { kind: 'subagent-started', subagent: 'mn-explorer', task: 'Find session title source' });
line('mn-mint', 15, 'mint', { kind: 'claimed', source: 'tool', capability: forest.capabilities[0].id, reason: 'Merged branches stop reading unmerged', folder: `${home}/.claude/worktrees/merged-branches` });
line('mn-mint', 1, 'mint', { kind: 'prompt-submitted', folder: `${home}/.claude/worktrees/merged-branches` });
line('mn-plain', 5, 'laptop', { kind: 'prompt-submitted', folder: home });
line('mn-mint', 1, 'mint', { kind: 'session-described', of: 'mn-laptop', app: 'claude-desktop', title: 'Sessions list labelling and machine names', status: 'PR #309 merged; labels increment in CI' });
line('mn-mint', 1, 'mint', { kind: 'session-described', of: 'mn-plain', app: 'claude-desktop', title: 'Windows temp cleanup EBUSY/EPERM', status: 'Waiting for your call on the retry budget' });
seed.lines = { lines, cursor: lines.length };
seed.tree.arcs = [];

const { chromium } = await import(pathToFileURL(process.env.PLANET_PLAYWRIGHT).href);
const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!['index.html', 'renderer.js', 'styles.css', 'arc-surface.css', 'app-setup.css', 'forest.css'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(readFileSync(path.join(dist, name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PLANET_CHROMIUM, headless: true,
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
      contextReadings: async (_, sessions) => sessions.map(session => ({ session, tokens: 210_000,
        composition: { injected: 60_000, grounding: 70_000, implementation: 50_000, other: 30_000 }, guidance: { value: 700_000 } })),
      idleAfterMs: async () => 30 * 60_000,
      leaveAfterMs: async () => 60 * 60_000,
      readSurfaces: async () => ({ ok: false }), holds: async () => [],
      windowReading: async (_, session) => ({ session, at: new Date().toISOString(), absent: "no hook has named this session's transcript" }),
    };
  }, seed);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
  const closeHelp = page.getByRole('button', { name: /^Close/ }).first();
  await page.waitForFunction(() => document.body.dataset.state === 'ready', null, { timeout: 15000 });
  if (await closeHelp.isVisible()) await closeHelp.click();
  const list = page.getByRole('complementary', { name: 'Running sessions', exact: true });
  await list.locator('.session-row[data-session-id="mn-mint"]').waitFor();
  await page.waitForTimeout(800);
  await list.screenshot({ path: path.join(here, 'descriptions-list.png') });
  assert.equal(await list.locator('.session-row[data-session-id="mn-mint"] .session-machine').innerText(), 'mint');
  assert.equal(await list.locator('.session-row[data-session-id="mn-laptop"] .session-children').innerText(), '+1');
  const first = await list.locator('.session-row[data-session-id="mn-laptop"] > *').first().getAttribute('class');
  assert.equal(first, 'session-children-toggle');
  await list.locator('.session-row[data-session-id="mn-laptop"] .session-children-toggle').click();
  await list.locator('.session-row[data-session-id="mn-explorer"]').waitFor();
  assert.equal(await list.locator('.session-row[data-session-id="mn-laptop"] .session-label').innerText(), 'Session list: titles and descriptions');
  assert.equal(await list.locator('.session-description p').first().innerText(), 'Sessions list labelling and machine names');
  assert.equal(await list.locator('.session-row[data-session-id="mn-plain"] .session-label').innerText(), 'Windows temp cleanup EBUSY/EPERM');
  await page.waitForTimeout(300);
  await list.screenshot({ path: path.join(here, 'descriptions-expanded.png') });
  assert.deepEqual(errors, []);
  console.log('Captured descriptions');
} finally {
  await browser?.close();
  server.close();
}
