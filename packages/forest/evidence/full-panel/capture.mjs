// Pictures for the sessions list as a full-height, see-through panel, every row expanded, facts as labels (forest 7.9, 7.15-7.17).
// The real desktop page, built by ./build.mjs; all activity is synthetic. Captures the desktop width and a narrow one.
// PLANET_PLAYWRIGHT and PLANET_CHROMIUM point at playwright-core and a headless Chromium on the capturing machine.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist/production');
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

// Working: mid-turn, two commands running (one of them a watch), worked in three folders.
line('fp-builder', 40, { kind: 'claimed', source: 'tool', capability: forest.capabilities[0].id, reason: 'Sessions panel: full height, facts as labels', folder: tree('panel'), branch: 'panel' });
line('fp-builder', 38, { kind: 'file-edited', files: ['a.ts'], folder: tree('tidy-readme'), branch: 'tidy-readme' });
line('fp-builder', 30, { kind: 'file-edited', files: ['b.ts'], folder: home, branch: 'main' });
line('fp-builder', 25, { kind: 'prompt-submitted', folder: tree('panel'), branch: 'panel' });
line('fp-builder', 6, { kind: 'command-started', command: 'pnpm run test --full', call: 'c1', folder: tree('panel'), branch: 'panel' });
line('fp-builder', 3, { kind: 'command-started', command: 'gh pr checks 341 --watch --interval 30 --fail-fast', call: 'c2', folder: tree('panel'), branch: 'panel' });
line('fp-builder', 1, { kind: 'subagent-started', subagent: 'fp-explorer', type: 'explorer', task: 'Find the arcs surface backdrop', folder: tree('panel'), branch: 'panel' });
line('fp-looker', 1, { kind: 'branch-state', of: 'tidy-readme', open: false, how: 'merged', pr: 338, folder: home, branch: 'main' });
// Waiting for you: its turn ended leaving a dev server in the background; its branch is unmerged.
line('fp-waiting', 55, { kind: 'claimed', source: 'tool', increment: 'inc-wait', reason: 'Hosted library location setting', folder: tree('library-location'), branch: 'library-location' });
line('fp-waiting', 18, { kind: 'prompt-submitted', folder: tree('library-location'), branch: 'library-location' });
line('fp-waiting', 17, { kind: 'command-started', command: 'pnpm dev --port 4400', call: 'w1', folder: tree('library-location'), branch: 'library-location' });
line('fp-waiting', 9, { kind: 'turn-ended', background: 1, folder: tree('library-location'), branch: 'library-location' });
// Waiting, its only branch merged.
line('fp-merged', 35, { kind: 'claimed', source: 'tool', capability: forest.capabilities[1].id, reason: 'Wisps orbit their islands', folder: tree('wisps'), branch: 'wisps' });
line('fp-merged', 14, { kind: 'prompt-submitted', folder: tree('wisps'), branch: 'wisps' });
line('fp-merged', 11, { kind: 'turn-ended', background: 0, folder: tree('wisps'), branch: 'wisps' });
line('fp-looker', 10, { kind: 'branch-state', of: 'wisps', open: false, how: 'merged', pr: 331, folder: home, branch: 'main' });
// Said not safe: stays listed, and folds as idle by its state like any quiet session (no words about it).
line('fp-held', 48, { kind: 'prompt-submitted', folder: home, branch: 'main' });
line('fp-held', 40, { kind: 'turn-ended', background: 0, folder: home, branch: 'main' });
line('fp-held', 39, { kind: 'closed-out', source: 'tool', safe: false, why: 'waiting on the look', running: 0, folder: home, branch: 'main' });
// Quiet, never closed out: idle.
for (const [session, minutes, folder] of [['fp-idle-1', 42, 'tidy-hooks'], ['fp-idle-2', 48, 'probe-hooks'], ['fp-idle-3', 52, 'look-wisps']]) {
  line(session, minutes + 5, { kind: 'prompt-submitted', folder: tree(folder), branch: 'main' });
  line(session, minutes, { kind: 'turn-ended', background: 0, folder: tree(folder), branch: 'main' });
}
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
const measures = {};
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PLANET_CHROMIUM, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  for (const [name, width, height] of [['desktop', 1440, 960], ['narrow', 420, 900]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: 'dark' });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.addInitScript(data => {
      const copy = value => structuredClone(value);
      let served = 0;
      const open = (id, resident = true) => ({ kind: 'file', id, call: id, tool: 'Read', resident });
      window.storytree = {
        projectSelection: async () => ({ projects: data.projects, current: 'storytree' }),
        projectTree: async () => copy(data.tree),
        changesSince: async (_, cursor) => ({ changes: [], cursor }),
        linesSince: async (_, cursor) => ({ lines: copy(data.lines.lines.filter(item => item.seq > Math.max(cursor, served))), cursor: (served = data.lines.cursor) }),
        frontCovers: async () => [], relatedNotes: async () => [], arcView: async () => null, waitHolds: async () => [], heldOnQuestion: async () => [],
        contextReadings: async (_, sessions) => sessions.map(session => ({ session, tokens: 310_000,
          composition: { injected: 40_000, grounding: 150_000, implementation: 90_000, other: 30_000 }, guidance: { value: 700_000 } })),
        idleAfterMs: async () => 30 * 60_000, leaveAfterMs: async () => 60 * 60_000,
        readSurfaces: async () => ({ ok: false }), holds: async () => [],
        windowReading: async (_, session) => session === 'fp-builder'
          ? { session, at: new Date().toISOString(), inView: [], glimpses: [], compactions: 0,
            opens: [open('packages/forest/src/view/sessions-list.tsx'), open('packages/forest/src/view/styles.css'), open('packages/agent-link/src/readings.ts', false)] }
          : { session, at: new Date().toISOString(), absent: "no hook has named this session's transcript" },
      };
    }, seed);
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.dataset.state === 'ready', null, { timeout: 15000 });
    const closeHelp = page.getByRole('button', { name: /^Close/ }).first();
    if (await closeHelp.isVisible()) await closeHelp.click();
    const list = page.getByRole('complementary', { name: 'Running sessions', exact: true });
    await list.locator('.session-row[data-session-id="fp-builder"]').waitFor();
    await list.locator('.session-detail-files').first().waitFor();
    await page.waitForTimeout(1500);

    const m = await list.evaluate(node => {
      const box = node.getBoundingClientRect(), pane = node.offsetParent.getBoundingClientRect(), style = getComputedStyle(node);
      const rows = [...node.querySelectorAll('.session-row')];
      return {
        viewport: { width: innerWidth, height: innerHeight },
        pane: { top: pane.top, height: pane.height },
        switcherBottom: (document.querySelector('.forest-views')?.getBoundingClientRect().bottom ?? pane.top) - pane.top,
        box: { left: box.left - pane.left, top: box.top - pane.top, right: pane.right - box.right, bottom: pane.bottom - box.bottom, width: box.width, height: box.height },
        scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight,
        overflowX: style.overflowX, overflowY: style.overflowY, background: style.backgroundColor, backdropFilter: style.backdropFilter,
        rows: rows.length, expandedRows: rows.filter(row => row.querySelector('.session-children-toggle')?.getAttribute('aria-expanded') === 'true').length,
        idleFold: node.querySelector('.session-idle-fold')?.textContent, idleFoldOpen: node.querySelector('.session-idle-fold')?.getAttribute('aria-expanded'),
        worktreeLabels: [...node.querySelectorAll('.session-worktree-state')].map(label => label.textContent),
        running: [...node.querySelectorAll('.session-detail-running li')].map(item => item.textContent),
        text: node.innerText,
      };
    });
    measures[name] = m;
    assert.equal(m.rows > 0 && m.expandedRows, m.rows, 'every row is expanded by default');
    assert.match(m.idleFold, /^4 idle$/); assert.equal(m.idleFoldOpen, 'false', 'the idle fold starts closed');
    assert.doesNotMatch(m.text, /needs you|needing|Holding unmerged|says safe/i, 'no prose about a session');
    assert.ok(m.scrollWidth <= m.clientWidth, `no horizontal scroll: ${m.scrollWidth} > ${m.clientWidth}`);
    assert.equal(m.overflowX, 'hidden');
    assert.deepEqual([m.box.left, m.box.bottom], name === 'narrow' ? [8, 8] : [16, 16], 'the side and bottom margins of the forest pane');
    assert.ok(m.box.top >= m.switcherBottom + 8, `the panel starts below the globe/library switcher: ${m.box.top} vs ${m.switcherBottom}`);
    assert.ok(/^rgba\(/.test(m.background), `a see-through backdrop: ${m.background}`);
    assert.ok(m.worktreeLabels.includes('unmerged') && m.worktreeLabels.includes('merged'));
    assert.equal(m.running.length, 3, `running commands listed: ${JSON.stringify(m.running)}`);
    // The per-row expander still collapses a row.
    const toggle = list.locator('.session-row[data-session-id="fp-waiting"] .session-children-toggle');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(here, `panel-${name}.png`) });
    await list.locator('.session-idle-fold').click();
    await list.locator('.session-row[data-session-id="fp-idle-3"]').waitFor();
    await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(here, `panel-${name}-scrolled-idle-open.png`) });
    assert.deepEqual(errors, []);
    await page.close();
  }
  for (const value of Object.values(measures)) delete value.text;
  writeFileSync(path.join(here, 'measures.json'), JSON.stringify(measures, null, 2) + '\n');
  console.log(JSON.stringify(measures));
} finally {
  await browser?.close();
  server.close();
}
