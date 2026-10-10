// Pictures for session rows that start collapsed (forest 7.8): the fresh list, one row opened by its expander, and closed again.
// The real desktop page, built by ../bottom-panel/build.mjs; all activity is synthetic. Desktop width only.
// PLANET_PLAYWRIGHT and PLANET_CHROMIUM point at playwright-core and a headless Chromium on the capturing machine.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBridge, withCapture } from '../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '../bottom-panel/dist/production');
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

// Working: mid-turn, two commands running, worked in three folders.
line('fp-builder', 40, { kind: 'claimed', source: 'tool', capability: forest.capabilities[0].id, reason: 'Sessions panel: a wide bottom strip that hides and expands', folder: tree('panel'), branch: 'panel' });
line('fp-builder', 38, { kind: 'file-edited', files: ['a.ts'], folder: tree('tidy-readme'), branch: 'tidy-readme' });
line('fp-builder', 30, { kind: 'file-edited', files: ['b.ts'], folder: home, branch: 'main' });
line('fp-builder', 25, { kind: 'prompt-submitted', folder: tree('panel'), branch: 'panel' });
line('fp-builder', 6, { kind: 'command-started', command: 'pnpm run test --full', call: 'c1', folder: tree('panel'), branch: 'panel' });
line('fp-builder', 3, { kind: 'command-started', command: 'gh pr checks 341 --watch --interval 30 --fail-fast', call: 'c2', folder: tree('panel'), branch: 'panel' });
line('fp-builder', 1, { kind: 'subagent-started', subagent: 'fp-explorer', type: 'explorer', task: 'Find the arcs bar toggle', folder: tree('panel'), branch: 'panel' });
line('fp-looker', 1, { kind: 'branch-state', of: 'tidy-readme', open: false, how: 'merged', pr: 338, folder: home, branch: 'main' });
// Waiting, a dev server left in the background; its branch is unmerged.
line('fp-waiting', 55, { kind: 'claimed', source: 'tool', increment: 'inc-wait', reason: 'Hosted library location setting', folder: tree('library-location'), branch: 'library-location' });
line('fp-waiting', 18, { kind: 'prompt-submitted', folder: tree('library-location'), branch: 'library-location' });
line('fp-waiting', 17, { kind: 'command-started', command: 'pnpm dev --port 4400', call: 'w1', folder: tree('library-location'), branch: 'library-location' });
line('fp-waiting', 9, { kind: 'turn-ended', background: 1, folder: tree('library-location'), branch: 'library-location' });
// Waiting, its only branch merged.
line('fp-merged', 35, { kind: 'claimed', source: 'tool', capability: forest.capabilities[1].id, reason: 'Wisps orbit their islands', folder: tree('wisps'), branch: 'wisps' });
line('fp-merged', 14, { kind: 'prompt-submitted', folder: tree('wisps'), branch: 'wisps' });
line('fp-merged', 11, { kind: 'turn-ended', background: 0, folder: tree('wisps'), branch: 'wisps' });
line('fp-looker', 10, { kind: 'branch-state', of: 'wisps', open: false, how: 'merged', pr: 331, folder: home, branch: 'main' });
// Quiet, never closed out: idle.
for (const [session, minutes, folder] of [['fp-idle-1', 42, 'tidy-hooks'], ['fp-idle-2', 48, 'probe-hooks'], ['fp-idle-3', 52, 'look-wisps']]) {
  line(session, minutes + 5, { kind: 'prompt-submitted', folder: tree(folder), branch: 'main' });
  line(session, minutes, { kind: 'turn-ended', background: 0, folder: tree(folder), branch: 'main' });
}
seed.lines = { lines, cursor: lines.length };
seed.tree.arcs = [];

await withCapture({ folder: here, dist }, async ({ browser, origin, out, settle }) => {
const measures = {};
  for (const [name, width, height] of [['desktop', 1440, 960]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: 'dark' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    const bridge = fakeBridge({});
    await bridge.install(page);
    process.once('exit', () => console.log('Bridge methods left to the stand-in:', bridge.defaulted.join(', ') || 'none'));
    await page.addInitScript(data => {
      const copy = value => structuredClone(value);
      let served = 0;
      const open = (id, resident = true) => ({ kind: 'file', id, call: id, tool: 'Read', resident });
      window.storytreeAnswers = {
        projectSelection: async () => ({ projects: data.projects, current: 'storytree' }),
        projectTree: async () => copy(data.tree),
        changesSince: async (_, cursor) => ({ changes: [], cursor }),
        linesSince: async (_, cursor) => ({ lines: copy(data.lines.lines.filter(item => item.seq > Math.max(cursor, served))), cursor: (served = data.lines.cursor) }),
        frontCovers: async () => [], relatedNotes: async () => [], arcView: async () => null, waitHolds: async () => [], heldOnQuestion: async () => [],
        contextReadings: async (_, sessions) => sessions.map(session => ({ session, tokens: 310_000,
          composition: { injected: 40_000, grounding: 150_000, implementation: 90_000, other: 30_000 }, guidance: { value: 700_000 } })),
        idleAfterMs: async () => 30 * 60_000, leaveAfterMs: async () => 60 * 60_000,
        readSurfaces: async () => ({ ok: false }), holds: async () => [],
        // The list reads every row's window in one batch (forest 7.17), answered as one read per session.
        windowReadings(project, sessions) { return Promise.all(sessions.map(one => this.windowReading(project, one))); },
        windowReading: async (_, session) => session === 'fp-builder'
          ? { session, at: new Date().toISOString(), inView: [], glimpses: [], compactions: 0,
            opens: [open('packages/forest/src/view/sessions-list.tsx'), open('packages/forest/src/view/styles.css'), open('packages/session-management/src/readings.ts', false)] }
          : { session, at: new Date().toISOString(), absent: "no hook has named this session's transcript" },
      };
    }, seed);
    const url = `${origin}/index.html`;
    const list = page.getByRole('complementary', { name: 'Running sessions', exact: true });
    const ready = async () => {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.body.dataset.state === 'ready', null, { timeout: 15000 });
      const closeHelp = page.getByRole('button', { name: /^Close/ }).first();
      if (await closeHelp.isVisible()) await closeHelp.click();
      await list.locator('header').waitFor();
    };
    const measure = () => list.evaluate(node => {
      const box = node.getBoundingClientRect(), pane = node.offsetParent.getBoundingClientRect(), body = node.querySelector('.sessions-body');
      const handle = node.querySelector('.sessions-handle');
      const rows = [...node.querySelectorAll('.session-row')];
      return {
        pane: { width: pane.width, height: pane.height },
        box: { left: box.left - pane.left, right: pane.right - box.right, bottom: pane.bottom - box.bottom, width: box.width, height: box.height },
        heightOfPane: +(box.height / pane.height).toFixed(3),
        handleExpanded: handle.getAttribute('aria-expanded'), handleLabel: handle.getAttribute('aria-label'),
        caret: node.querySelector('.sessions-caret').textContent,
        bodyHidden: body.hidden, scrollWidth: body.scrollWidth, clientWidth: body.clientWidth, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight,
        overflowX: getComputedStyle(body).overflowX, overflowY: getComputedStyle(body).overflowY,
        background: getComputedStyle(node).backgroundColor, backdropFilter: getComputedStyle(node).backdropFilter,
        rows: rows.length, rowHeights: rows.map(row => Math.round(row.getBoundingClientRect().height)),
        headerHeight: Math.round(node.querySelector('header').getBoundingClientRect().height),
        idleFold: node.querySelector('.session-idle-fold')?.textContent,
        worktreeLabels: [...node.querySelectorAll('.session-worktree-state')].map(label => label.textContent),
        running: [...node.querySelectorAll('.session-detail-running li')].length,
        kept: localStorage.getItem('storytree.forest.sessions-open.v1:storytree'),
      };
    });

    const rowsState = () => list.evaluate(node => ({
      rows: [...node.querySelectorAll('.session-row')].map(row => row.dataset.sessionId),
      toggles: [...node.querySelectorAll('.session-children-toggle')].map(button => button.getAttribute('aria-expanded')),
      details: node.querySelectorAll('.session-detail').length,
      height: Math.round(node.getBoundingClientRect().height),
    }));
    const expander = list.locator('.session-row[data-session-id="fp-builder"] .session-children-toggle');

    await ready();
    await expander.waitFor();
    await page.waitForTimeout(1500);
    const fresh = await rowsState();
    assert.ok(fresh.toggles.length >= 3 && fresh.toggles.every(open => open === 'false'), `every row starts collapsed: ${fresh.toggles}`);
    assert.equal(fresh.details, 0, 'no detail drawn');
    assert.ok(!fresh.rows.includes('fp-explorer'), 'children stay folded under their parent');
    await page.screenshot({ path: path.join(out, 'collapsed.png') });

    await expander.click();
    await list.locator('.session-detail-files').first().waitFor();
    await page.waitForTimeout(500);
    const opened = await rowsState();
    assert.equal(opened.details, 1, 'only the opened row shows its detail');
    assert.ok(opened.rows.includes('fp-explorer'), 'its child shows under it');
    await page.screenshot({ path: path.join(out, 'one-expanded.png') });

    await expander.click();
    await page.waitForFunction(() => document.querySelectorAll('.session-detail').length === 0);
    const closed = await rowsState();
    assert.deepEqual(closed.rows, fresh.rows, 'closing it again restores the fresh list');
    measures[name] = { fresh, opened, closed };
    assert.deepEqual(errors, []);
    await context.close();
  }
  writeFileSync(path.join(out, 'measures.json'), JSON.stringify(measures, null, 2) + '\n');
  console.log(JSON.stringify(measures));
});
