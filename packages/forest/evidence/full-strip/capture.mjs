// Pictures for the Sessions strip's expand control (forest 7.17, ADR-1002 D3): the usual height and expanded to fill the forest pane,
// with the Arcs drawer closed and open over it. The real desktop page, built by ./build.mjs; all activity is synthetic.
// PLANET_PLAYWRIGHT and PLANET_CHROMIUM point at playwright-core and a headless Chromium on the capturing machine.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureSeed, fakeBridge, seedFile, withCapture } from '../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist/production');
const { seed } = captureSeed('forest');
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
// The window's files, named by the seed's story titles so a package rename cannot desync them.
seed.files = { list: seedFile(seed, 'The forest', 'src/view/sessions-list.tsx'), styles: seedFile(seed, 'The forest', 'src/view/styles.css'),
  readings: seedFile(seed, 'The agent link', 'src/readings.ts') };

await withCapture({ folder: here, dist }, async ({ browser, origin, out, settle }) => {
const measures = {};
  for (const [name, width, height] of [['desktop', 1440, 960], ['narrow', 420, 900]]) {
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
            opens: [open(data.files.list), open(data.files.styles), open(data.files.readings, false)] }
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
    const measure = () => page.evaluate(() => {
      const node = document.querySelector('.sessions-list');
      const box = node.getBoundingClientRect(), pane = node.offsetParent.getBoundingClientRect(), body = node.querySelector('.sessions-body');
      const size = node.querySelector('.sessions-size');
      return {
        pane: { top: pane.top, height: pane.height },
        box: { top: box.top - pane.top, bottom: pane.bottom - box.bottom, left: box.left - pane.left, right: pane.right - box.right, height: box.height },
        heightOfPane: +(box.height / pane.height).toFixed(3),
        dataSize: node.dataset.size ?? null, open: node.dataset.open,
        size: size && { text: size.textContent, pressed: size.getAttribute('aria-pressed'), label: size.getAttribute('aria-label') },
        bodyHidden: body.hidden, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, overflowY: getComputedStyle(body).overflowY,
        headerHeight: Math.round(node.querySelector('header').getBoundingClientRect().height),
        kept: localStorage.getItem('storytree.forest.sessions-size.v1:storytree'),
      };
    });
    // Which surface paints on top where the open Arcs drawer and the strip overlap, sampled down the drawer's left edge.
    const onTop = () => page.evaluate(() => {
      const drawer = document.querySelector('.arc-overlay'), strip = document.querySelector('.sessions-list');
      if (drawer.hidden) return { drawerOpen: false };
      const d = drawer.getBoundingClientRect(), s = strip.getBoundingClientRect();
      const top = Math.max(d.top, s.top), bottom = Math.min(d.bottom, s.bottom);
      if (bottom <= top) return { drawerOpen: true, overlap: 0 };
      const points = [0.1, 0.5, 0.9].map(f => [Math.round(s.left + 40), Math.round(top + (bottom - top) * f)]);
      return { drawerOpen: true, overlap: Math.round(bottom - top),
        hits: points.map(([x, y]) => { const hit = document.elementFromPoint(x, y); return drawer.contains(hit) ? 'drawer' : strip.contains(hit) ? 'strip' : hit?.className || hit?.tagName; }) };
    });
    const shot = async file => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, file) }); };
    const drawer = async open => {
      await page.locator(open ? '.arc-handle[data-open-arcs]' : '.arc-handle[data-close-arcs]').first().click();
      await page.waitForFunction(want => document.querySelector('.arc-overlay').hidden === !want, open);
    };

    await ready();
    await list.locator('.session-row[data-session-id="fp-builder"]').waitFor();
    await page.waitForTimeout(1200);
    const usual = await measure();
    assert.equal(usual.dataSize, null, 'the usual height by default');
    assert.ok(usual.heightOfPane <= 0.4 + 0.001, `at most 40% of the pane: ${usual.heightOfPane}`);
    assert.deepEqual(usual.size, { text: 'Expand', pressed: 'false', label: 'Expand sessions to fill the pane' });
    await shot(`full-${name}-usual.png`);
    if (name === 'desktop') {
      await drawer(true);
      measures.usualUnderDrawer = await onTop();
      assert.ok(measures.usualUnderDrawer.overlap === 0 || measures.usualUnderDrawer.hits.every(hit => hit === 'drawer'), JSON.stringify(measures.usualUnderDrawer));
      await shot('full-desktop-usual-arcs-open.png');
      await drawer(false);
    }

    // Expand by its control: the strip fills the pane from top to bottom, its rows scrolling inside; the header stays where a click folds it.
    await list.locator('.sessions-size').click();
    await page.waitForFunction(() => document.querySelector('.sessions-list').dataset.size === 'full');
    await page.waitForTimeout(300);
    const full = await measure();
    assert.deepEqual([full.box.top, full.box.bottom, full.box.left, full.box.right], [0, 0, 0, 0], `fills the pane: ${JSON.stringify(full.box)}`);
    assert.equal(full.heightOfPane, 1);
    assert.equal(full.overflowY, 'auto');
    assert.equal(full.open, 'true', 'still open: the size control does not fold the strip');
    assert.deepEqual(full.size, { text: 'Restore', pressed: 'true', label: 'Restore sessions to their usual height' });
    assert.equal(full.kept, 'true', 'the size is kept');
    await shot(`full-${name}-expanded.png`);

    // History uses the same height.
    await list.getByRole('tab', { name: 'History' }).click();
    const history = await measure();
    assert.equal(history.heightOfPane, 1, 'History fills the pane too');
    await list.getByRole('tab', { name: 'Live' }).click();

    // Folded by its header, only the header is left; opened again, it comes back expanded; kept across a reload.
    await list.locator('header').click({ position: { x: 5, y: 5 } });
    await page.waitForFunction(() => document.querySelector('.sessions-handle').getAttribute('aria-expanded') === 'false');
    const folded = await measure();
    assert.equal(folded.box.bottom, 0);
    assert.ok(Math.abs(folded.box.height - folded.headerHeight) <= 2, `only the header: ${folded.box.height}`);
    assert.equal(folded.size, null, 'no size control on a folded strip');
    await ready();
    assert.equal(await list.locator('.sessions-handle').getAttribute('aria-expanded'), 'false', 'still folded after a reload');
    await list.locator('.sessions-handle').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.sessions-list').dataset.size === 'full');
    assert.equal((await measure()).heightOfPane, 1, 'opened again, the kept size returns');

    if (name === 'desktop') {
      // An open Arcs drawer lies over the expanded strip, as it lies over the globe.
      await drawer(true);
      measures.fullUnderDrawer = await onTop();
      assert.ok(measures.fullUnderDrawer.overlap > 0, 'the expanded strip runs under the drawer');
      assert.deepEqual(measures.fullUnderDrawer.hits, ['drawer', 'drawer', 'drawer'], JSON.stringify(measures.fullUnderDrawer));
      await shot('full-desktop-expanded-arcs-open.png');
      await drawer(false);

      // Expanded, the strip still keeps clear of an open story panel and of the stale-forest mark.
      const clear = await page.evaluate(() => {
        const panel = document.querySelector('.story-panel');
        panel.hidden = false;
        const mark = document.createElement('p'); mark.id = 'freshness'; mark.textContent = 'As last read. Refreshing…'; panel.parentElement.append(mark);
        const strip = document.querySelector('.sessions-list').getBoundingClientRect();
        const hit = other => { const r = other.getBoundingClientRect(); return !(strip.right <= r.left || r.right <= strip.left || strip.bottom <= r.top || r.bottom <= strip.top); };
        return { panel: hit(panel), mark: hit(mark), strip: { top: strip.top, right: strip.right, bottom: strip.bottom }, panelLeft: panel.getBoundingClientRect().left };
      });
      assert.deepEqual([clear.panel, clear.mark], [false, false], `no collision with the story panel or the stale mark: ${JSON.stringify(clear)}`);
      measures.fullClear = clear;
      await shot('full-desktop-expanded-story-panel-and-stale-mark.png');
      await page.evaluate(() => { document.querySelector('#freshness').remove(); document.querySelector('.story-panel').hidden = true; });
    }

    // Restore from the keyboard: back to at most 40%.
    await list.locator('.sessions-size').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.sessions-list').dataset.size === undefined);
    const restored = await measure();
    assert.ok(restored.heightOfPane <= 0.4 + 0.001, `restored to at most 40%: ${restored.heightOfPane}`);
    assert.equal(restored.kept, 'false');
    measures[name] = { usual, full, history, folded, restored };
    assert.deepEqual(errors, []);
    await context.close();
  }
  writeFileSync(path.join(out, 'measures.json'), JSON.stringify(measures, null, 2) + '\n');
  console.log(JSON.stringify(measures));
});
