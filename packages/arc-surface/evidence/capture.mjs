// Capability 3.1 and 3.4–3.6 acceptance on the actual desktop renderer and app reads.
// Run under the heavy lock, after apps/desktop/build.mjs. No live project is opened or changed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from '@storytree/library';
import { openActivityLog, claim } from '@storytree/agent-link';
// The frame is reached through the desktop app, which mounts this surface: arc-surface itself never depends on it (ADR-0847).
const { pageReads } = await import(createRequire(new URL('../../../apps/desktop/package.json', import.meta.url)).resolve('@storytree/app'));
import { start } from '@storytree/local-postgres';
import { smokeArcSurface } from '../src/index.ts';

const { chromium } = await import(process.env.ARC_PLAYWRIGHT ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(here, 'drawer-shape');
mkdirSync(output, { recursive: true });
const dist = path.resolve(here, '../../../apps/desktop/dist/renderer');
const temporary = mkdtempSync(path.join(tmpdir(), 'storytree-arc-capture-'));
let postgres, store, log, reads, browser, server;
try {
  postgres = await start({ dataDir: path.join(temporary, 'pgdata'), owner: 'arc surface capture' });
  store = await connect({ url: postgres.url }); log = await openActivityLog(postgres.url);
  const project = 'storytree';
  // The supplied snapshot predates plan cutover: real forest, no arcs/questions.
  // Restore it only into this throwaway database, then add the explicit arc fixture.
  const snapshotPath = process.env.ARC_SNAPSHOT ?? '/home/mickh/storytree-lanes/snapshots/2026-09-27T12-40-59-713Z.json';
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  await store.restore(project, snapshot);
  const library = await store.openProject(project);
  const story = await library.addStory({ title: 'Understand the work' });
  const part = await library.addCapability({ story: story.id, title: 'Read the board' });
  await library.addContract({ capability: part.id, title: 'See the agent holding an increment' });
  const makeArc = (title, intent) => library.createArc({ title, intent, endState: 'The work is complete.', stories: [story.id] });
  const build = await makeArc('Arc surface', 'See what has landed, what agents are building, and what is waiting.');
  const landed = await library.addIncrement({ arc: build.id, title: 'Work states', objective: 'Read work states', body: 'Work states', outcome: { disposition: 'landed', pr: '101' } });
  const held = await library.addIncrement({ arc: build.id, title: 'Draw the overlay', objective: 'Draw', body: 'Draw', touches: [part.id] });
  const decision = await makeArc('Choose the release approach', 'Keep the first release small enough to review and use.');
  const question = await library.raiseQuestion({ arc: decision.id, title: 'Which release should go first?', statement: 'Should the first release cover one project or several?', stakes: 'This determines how much work comes before the first useful release.', context: 'A single project is easier to review. Several projects exercise the switcher before release.', options: 'A. One project first. FOR: a smaller first release. AGAINST: switching waits.\n\nB. Several projects. FOR: switching is exercised. AGAINST: a larger first release.', diagram: 'One project → feedback → more projects', analogy: 'Like opening one room of a house before the whole house. Software is easier to revise than a room.', recommendation: 'One project first, with switching next.' });
  const waiting = await library.addIncrement({ arc: decision.id, title: 'Prepare the release', objective: 'Release', body: 'Release', heldOn: [question.id] });
  await library.advanceIncrement(waiting.id, 'ready');
  const queued = await makeArc('Desktop release', 'Package the working board for the owner.');
  await library.addIncrement({ arc: queued.id, title: 'Package the app', objective: 'Package', body: 'Package' });
  await library.addWait(queued.id, build.id, 'The board must land before packaging.');
  const verification = await makeArc('Release verification across the supported desktop platforms before distribution', 'Check the packaged release.');
  await library.addWait(verification.id, queued.id, 'Packaging comes first.');
  for (const title of ['Linux verification', 'Windows verification']) {
    const child = await makeArc(title, 'Verify the release on this platform.');
    await library.addWait(child.id, verification.id, 'Prepare verification first.');
  }
  for (const title of ['Developer workflow', 'Library navigation', 'Workspace recovery', 'Project switching']) {
    const lane = await makeArc(title, 'Keep the working project easy to understand.');
    await library.addIncrement({ arc: lane.id, title: 'First slice', objective: 'Build', body: 'Build', outcome: { disposition: 'landed', pr: '100' } });
    await library.addIncrement({ arc: lane.id, title: 'Earlier attempt', objective: 'Try', body: 'Try', outcome: { disposition: 'withdrawn', note: 'A smaller approach worked better.' } });
    await library.addIncrement({ arc: lane.id, title: 'Next slice', objective: 'Continue', body: 'Continue' });
    if (title === 'Developer workflow' || title === 'Library navigation') {
      for (const suffix of ['follow-up', 'review']) {
        const child = await makeArc(`${title} ${suffix}`, 'Follow the first slice.');
        await library.addWait(child.id, lane.id, 'The first slice comes first.');
      }
    }
  }
  const parked = await makeArc('Later improvements', 'Keep useful ideas available without putting them on the active board.');
  await library.addIncrement({ arc: parked.id, title: 'Explore refinements', objective: 'Explore', body: 'Explore' });
  // Raised before the park: a parked arc takes no new question, and its open one is parked with it (ADR-0835).
  await library.raiseQuestion({ arc: parked.id, title: 'Which refinement comes first?', statement: 'Which refinement should the arc start with?', stakes: 'It sets the first piece of work when the arc returns.', context: 'Asked before the arc was parked.', options: 'A. Polish. FOR: quick. AGAINST: small.\n\nB. Rework. FOR: thorough. AGAINST: slow.' });
  await library.parkArc(parked.id);
  const anotherParked = await makeArc('Another parked idea', 'A distinct fallback selection.');
  await library.parkArc(anotherParked.id);
  const closed = await makeArc('Earlier experiment', 'Keep the outcome, including experiments that did not land.');
  await library.addIncrement({ arc: closed.id, title: 'Alternative layout', objective: 'Explore', body: 'Explore', outcome: { disposition: 'withdrawn', note: 'Kept the smaller layout.' } });
  reads = pageReads({ storytree: store });
  let failRead = false;
  const bridge = { ...reads, projectSelection: async () => ({ current: project, projects: [project] }), arcViews: async (...args) => { if (failRead) throw new Error('temporary read failure'); return reads.arcViews(...args); },
    // The renderer asks for its surfaces setting first; an unread setting means every surface is on.
    readSurfaces: async () => undefined };
  const allowed = ['projectSelection', 'listProjects', 'projectTree', 'changesSince', 'linesSince', 'frontCovers', 'relatedNotes', 'arcViews', 'holds', 'idleAfterMs', 'readSurfaces'];
  server = createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!['index.html', 'renderer.js', 'styles.css', 'app-setup.css', 'arc-surface.css', 'forest.css'].includes(name)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(readFileSync(path.join(dist, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.env.ARC_CHROMIUM ?? '/home/mickh/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell', headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark', deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  // A read the renderer makes beyond these (another surface's) fails as a read error there, never a write.
  const arcRead = (method, args) => { if (!allowed.includes(method) || !bridge[method]) throw new Error(`not carried: ${method}`); return bridge[method](...args); };
  const carry = () => { window.storytree = new Proxy({}, { get: (_, method) => (...args) => window.arcRead(String(method), args) }); };
  // The app menu opens itself when the app's own reads (updates, setup) are not carried here; it is not under test.
  const hideMenu = target => target.evaluate(() => { const menu = document.getElementById('app-menu'); if (menu?.matches(':popover-open')) menu.hidePopover(); });
  await page.exposeFunction('arcRead', arcRead);
  await page.addInitScript(carry);
  await page.addInitScript(() => {
    const realNow = Date.now, realEvery = window.setInterval, realClear = window.clearInterval;
    let offset = 0; const clocks = new Map();
    Date.now = () => realNow() + offset;
    window.setInterval = (run, ms, ...args) => { const id = realEvery(run, ms, ...args); if (ms === 60000) clocks.set(id, run); return id; };
    window.clearInterval = id => { clocks.delete(id); return realClear(id); };
    window.advanceArcClock = ms => { offset += ms; for (const run of clocks.values()) run(); };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 120000 });
  await page.waitForSelector('canvas', { timeout: 120000 });
  await hideMenu(page);
  const handle = page.getByRole('button', { name: 'Open arc surface', exact: true });
  const handleBox = await handle.boundingBox();
  assert.ok(handleBox.x === 0 && handleBox.width === 1440, 'the closed arc bar spans the window'); // its placement is ../arc-bar's acceptance
  await page.screenshot({ path: path.join(output, 'drawer-closed.png') });
  failRead = true;
  await page.locator('[data-open-arcs]').click();
  await page.waitForSelector('.arc-overlay[data-arc-state=error]');
  assert.match(await page.locator('.arc-status').innerText(), /temporary read failure/);
  failRead = false;
  await page.waitForSelector('.arc-overlay[data-arc-state=ready]');
  const drawerBox = await page.locator('.arc-overlay').boundingBox();
  assert.equal(drawerBox.y, handleBox.y + handleBox.height, 'the drawer opens directly below the arc bar');
  assert.equal(drawerBox.width, 1440);
  assert.ok(drawerBox.height <= 500, 'drawer leaves the lower half of the forest exposed');
  await page.locator('canvas').evaluate(canvas => {
    window.forestPointerCount = 0;
    canvas.addEventListener('pointerdown', () => { window.forestPointerCount++; });
  });
  await page.mouse.click(720, 800);
  assert.equal(await page.evaluate(() => window.forestPointerCount), 1, 'forest receives pointer input below the open drawer');
  const rowHeights = await page.locator('.arc-lane').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
  assert.ok(rowHeights.every(height => height <= 65), `dense two-line rows: ${rowHeights}`);
  assert.equal(await page.locator(`[data-arc-select="${queued.id}"]`).count(), 0, 'queued arc starts behind the caret');
  const started = Date.now();
  await log.append(project, { kind: 'session-started', source: 'hook', harness: 'codex', session: 'capture-agent' });
  assert.equal((await claim({ library, log, project, session: 'capture-agent', harness: 'codex' }, held.id, 'Draw the board over the forest.')).ok, true);
  await page.waitForSelector('[data-agent-label=Codex]');
  const claimVisibleMs = Date.now() - started;
  assert.ok(claimVisibleMs < 4000, `claim appeared after ${claimVisibleMs} ms`);
  await page.screenshot({ path: path.join(output, 'drawer-open.png') });
  await page.locator(`[data-arc-queue="${build.id}"]`).click();
  assert.equal(await page.locator(`[data-arc-queue="${build.id}"]`).getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator(`[data-arc-id="${build.id}"] [data-arc-select="${queued.id}"]`).count(), 1, 'queue chip is nested under its blocker');
  const queuedChip = await page.locator(`[data-arc-select="${verification.id}"]`).boundingBox();
  const downstreamCount = await page.locator(`[data-arc-select="${verification.id}"] span`).last().boundingBox();
  assert.ok(downstreamCount.x + downstreamCount.width <= queuedChip.x + queuedChip.width, '+N remains visible beside a long queued title');
  await page.screenshot({ path: path.join(output, 'queue-expanded.png') });
  await page.locator('[data-question-open]').first().click();
  assert.equal(await page.locator('[data-question-open]').count(), 0, 'reading replaces the question list');
  await page.waitForSelector('[data-question-back]');
  await page.locator('.arc-fold > summary').first().click();
  const scrollBefore = await page.locator('.arc-briefing').evaluate(node => { node.scrollTop = node.scrollHeight; return node.scrollTop; });
  assert.ok(scrollBefore > 0, 'the open question has enough content to exercise scrolling');
  // A refresh must preserve the question and reading position.
  await log.append(project, { kind: 'file-edited', source: 'hook', session: 'capture-agent', files: ['view.ts'] });
  await page.waitForTimeout(2300);
  assert.equal(await page.locator('[data-question-back]').count(), 1);
  assert.equal(await page.locator('.arc-fold[open]').count(), 1);
  assert.equal(await page.locator(`[data-arc-queue="${build.id}"]`).getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('.arc-briefing').evaluate(node => node.scrollTop), scrollBefore, 'a live refresh preserves the reading position');
  await page.locator('.arc-briefing').evaluate(node => { node.scrollTop = 0; });
  await page.screenshot({ path: path.join(output, 'question-reading.png') });
  await page.locator('[data-question-back]').click();
  assert.equal(await page.locator('[data-question-open]').count(), 1);
  for (const id of await page.locator('[data-arc-queue]').evaluateAll(nodes => nodes.map(node => node.dataset.arcQueue))) {
    await page.locator(`[data-arc-queue="${id}"]`).evaluate(button => { if (button.getAttribute('aria-expanded') === 'true') button.click(); });
  }
  const problems = await smokeArcSurface({ executeJavaScript: code => page.evaluate(code) }, project, reads);
  assert.deepEqual(problems, []);
  await page.locator(`[data-arc-queue="${build.id}"]`).evaluate(button => { if (button.getAttribute('aria-expanded') !== 'true') button.click(); });
  const history = await library.history();
  await page.evaluate(() => window.advanceArcClock(42 * 60000));
  await page.waitForFunction(() => [...document.querySelectorAll('.arc-chip')].some(node => node.textContent.startsWith('idle ·')));
  const idleChip = await page.locator('.arc-state-idle').innerText();
  await page.locator(`[data-arc-select="${queued.id}"]`).first().click();
  assert.match(await page.locator('.arc-briefing').innerText(), /Package the working board/);
  assert.deepEqual(await library.history(), history, 'all UI actions were read-only');
  await library.settleQuestion(question.id, { answer: 'One project first.' });
  await page.locator(`[data-arc-select="${decision.id}"]`).first().click();
  await page.waitForFunction(() => document.querySelector('.arc-briefing')?.textContent.includes('One project first.'));
  // The forest draws the fixture's agent session once it starts, so the census is taken as the drawer closes;
  // its arcSurface part is the drawer's own reading, not the forest.
  const forest = async () => { const { arcSurface, ...drew } = JSON.parse(await page.getAttribute('body', 'data-drew')); return drew; };
  const forestBefore = await forest();
  await page.locator('[data-close-arcs]').click();
  assert.equal(await page.locator('.arc-overlay').isVisible(), false);
  assert.equal(await page.locator('canvas').count(), 1);
  assert.deepEqual(await forest(), forestBefore, 'closing the drawer leaves the same forest');
  await page.locator('[data-open-arcs]').click();
  await page.waitForSelector('.arc-overlay[data-arc-state=ready]');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.arc-overlay').isVisible(), false);
  // A fresh browser context with the same local storage models the next desktop launch.
  await page.locator('[data-open-arcs]').click();
  await page.locator('[data-arc-scope="parked"]').click();
  await page.locator(`[data-arc-select="${parked.id}"]`).click();
  const saved = await page.context().storageState();
  const url = page.url();
  const renderer = await page.evaluate(() => { const gl = document.querySelector('canvas')?.getContext('webgl2'); const debug = gl?.getExtension('WEBGL_debug_renderer_info'); return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable'; });
  const forestPointerCount = await page.evaluate(() => window.forestPointerCount);
  // The first launch ends before the next begins: two forests drawing at once starve each other in one headless browser.
  await page.close();
  const relaunched = await browser.newPage({ storageState: saved, viewport: { width: 1440, height: 960 } });
  await relaunched.exposeFunction('arcRead', arcRead);
  await relaunched.addInitScript(carry);
  await relaunched.goto(url);
  await relaunched.waitForSelector('.arc-overlay[data-arc-state=ready]');
  assert.equal(await relaunched.locator('[data-arc-scope="parked"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await relaunched.locator(`[data-arc-select="${parked.id}"]`).getAttribute('aria-pressed'), 'true');
  await relaunched.screenshot({ path: path.join(output, 'relaunch-parked-picked.png') });
  assert.match(await relaunched.locator('.arc-briefing h4').first().innerText(), /parked with the arc/i, 'a parked arc\'s question is parked with it, not waiting on you');
  await relaunched.keyboard.press('Escape');
  await relaunched.reload();
  await relaunched.waitForFunction(() => document.body.dataset.state === 'ready');
  assert.equal(await relaunched.locator('.arc-overlay').isVisible(), false, 'closed state survives relaunch');
  await relaunched.close();
  assert.deepEqual(errors, []);
  const result = { snapshot: { takenAt: snapshot.takenAt, records: snapshot.records.length, arcs: snapshot.records.filter(record => record.type === 'arc').length }, drawerBox, rowHeights, forestPointerCount, browser: await browser.version(), renderer, claimVisibleMs, idleChip, smokeProblems: problems, checks: ['read error and retry', 'live claim', 'question reading, fold, queue and scroll survive refresh', 'drawer geometry', 'forest receives input below drawer', 'queue nesting', 'question list swap and back', 'open/scope/selection persist across launch', 'closed state persists', 'all scopes smoke', 'idle without a new line', 'queued briefing', 'read-only UI', 'live settlement', 'close and Escape preserve the forest'], errors };
  writeFileSync(path.join(output, 'capture.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await reads?.close(); await log?.close(); await store?.close(); await postgres?.stop();
  rmSync(temporary, { recursive: true, force: true });
}
