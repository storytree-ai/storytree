// The owner's ovals and planted flags (increment_1cccfcf809e9) on the actual desktop renderer and app reads:
// each increment a flat oval in its state colour, a claimed one carrying its holder's flag (live, and idle:
// furled and greyed), the row tight under the lane's title, in the dark and the light theme at true size.
// Run after apps/desktop/build.mjs. Its fake bridge and Chromium come from the capture kit
// (apps/desktop/src/capture); an isolated Postgres holds an explicit fixture, so no live project is
// opened or changed. CAPTURE_PLAYWRIGHT and CAPTURE_CHROMIUM name others by path.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connect } from '@storytree/library';
import { openActivityLog } from '@storytree/session-management';
// The frame is reached through the desktop app, which mounts this surface: arc-surface itself never depends on it (ADR-0847).
const { pageReads } = await import(pathToFileURL(createRequire(new URL('../../../../apps/desktop/package.json', import.meta.url)).resolve('@storytree/app')).href);
import { start } from '@storytree/local-postgres';
import { captureOutput, fakeBridge, launch } from '../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = captureOutput(here); // pictures and measurements: a scratch folder unless run with --retake
const dist = path.resolve(here, '../../../../apps/desktop/dist/renderer');
const temporary = mkdtempSync(path.join(tmpdir(), 'storytree-ovals-and-flags-'));
let postgres, store, log, reads, browser, server;
try {
  postgres = await start({ dataDir: path.join(temporary, 'pgdata'), owner: 'ovals and flags capture' });
  store = await connect({ url: postgres.url }); log = await openActivityLog(postgres.url);
  const project = 'storytree';
  const library = await store.openProject(project);
  const story = await library.addStory({ title: 'Understand the work' });
  const makeArc = (title) => library.createArc({ title, intent: `${title}.`, endState: 'Done.', stories: [story.id] });
  const work = (arc, title, extra = {}) => library.addIncrement({ arc: arc.id, title, objective: title, body: title, ...extra });
  // (a) Every kind side by side: landed, waiting on the owner, unclaimed, held by a live session, held by an idle one.
  const website = await makeArc('Website');
  for (const n of [1, 2, 3]) await work(website, `Landed page ${n}`, { outcome: { disposition: 'landed', pr: String(40 + n) } });
  await library.addWaitFor((await work(website, 'Switch the DNS')).id, { releaser: 'owner', note: 'approve the DNS cutover' });
  await work(website, 'Fix the sitemap');
  const live = await work(website, 'Fix the footer links');
  const idle = await work(website, 'Fix the contact form');
  // (b) A lane with no claims, to judge that it does not stand off its title.
  const docs = await makeArc('Docs refresh');
  await work(docs, 'Quick start', { outcome: { disposition: 'landed', pr: '12' } });
  await work(docs, 'Rewrite the glossary');
  await work(docs, 'Add the tutorials');

  reads = pageReads({ storytree: store });
  const pick = (names) => Object.fromEntries(names.map((name) => [name, reads[name]]));
  const bridge = fakeBridge({
    ...pick(['listProjects', 'projectTree', 'changesSince', 'linesSince', 'frontCovers', 'relatedNotes', 'arcView', 'arcViews', 'holds']),
    projectSelection: async () => ({ current: project, projects: [project] }),
    readSurfaces: async () => undefined,
    agentConnections: async () => [],
    codeSurvey: async () => ({}),
    checkForUpdates: async () => ({ phase: 'unavailable', runningBuild: 'capture', reason: 'not under test' }),
  });
  server = createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!['index.html', 'renderer.js', 'arc-surface.css', 'styles.css'].includes(name)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(readFileSync(path.join(dist, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  // The claims are hook lines: one session went quiet 42 minutes ago, one is working now.
  const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000 - 20_000).toISOString();
  const claimLine = (session, increment, reason) => ({ session, harness: 'claude-code', source: 'hook', kind: 'claimed', increment, reason });
  await log.append(project, claimLine('quiet-contact', idle.id, 'Fix the contact form.'), { at: minutesAgo(42) });
  await log.append(project, claimLine('working-now', live.id, 'Fix the footer links.'), { at: new Date().toISOString() });
  browser = await launch();
  const result = { browser: await browser.version() };
  // True size, then a 4x close-up of the same page to read the flags by.
  for (const [scheme, scale] of [['dark', 1], ['light', 1], ['dark', 4], ['light', 4]]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, colorScheme: scheme, deviceScaleFactor: scale });
    const named = scale === 1 ? scheme : `${scheme}-4x`;
    const errors = []; page.on('pageerror', error => { errors.push(String(error)); console.error('pageerror', String(error)); });
    await bridge.install(page);
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
    await bridge.ready(page);
    await page.evaluate(() => { const menu = document.getElementById('app-menu'); if (menu?.matches(':popover-open')) menu.hidePopover(); });
    await page.locator('[data-open-arcs]').click();
    await page.waitForSelector('.arc-overlay[data-arc-state=ready]');
    await page.waitForSelector('[data-agent-session]', { state: 'attached' });
    const lanes = await page.locator('.arc-lanes > .arc-row').evaluateAll(nodes => nodes.map(row => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      return {
        title: row.querySelector('.arc-title').textContent,
        head: box(row.querySelector('.arc-lane-head')),
        ovals: [...row.querySelectorAll('.arc-bar')].map(bar => ({ ...box(bar), colour: getComputedStyle(bar).backgroundColor, radius: getComputedStyle(bar).borderRadius })),
        flags: [...row.querySelectorAll('.arc-agent-mark')].map(flag => ({ session: flag.dataset.agentSession, pennant: box(flag.querySelector('.arc-flag-pennant')), pole: box(flag.querySelector('line')), fill: flag.querySelector('.arc-flag-pennant').getAttribute('fill'), on: box(flag.closest('.arc-bar')) })),
        text: row.querySelector('.arc-bars').textContent,
      };
    }));
    const by = (title) => lanes.find(lane => lane.title === title);
    for (const lane of lanes) {
      assert.ok(lane.ovals.every(oval => oval.width === 16 && oval.height === 8 && oval.radius === '50%'), `${lane.title}: each increment is a 16 x 8 oval`);
      assert.equal(lane.text, '', `${lane.title}: no dot`);
    }
    const website = by('Website');
    assert.equal(website.ovals.length, 7);
    assert.deepEqual(website.flags.map(({ session }) => session).sort(), ['quiet-contact', 'working-now']);
    for (const flag of website.flags) {
      const foot = { x: flag.pole.x + flag.pole.width / 2, y: flag.pole.y + flag.pole.height };
      assert.ok(Math.abs(foot.y - (flag.on.y + flag.on.height / 2)) <= 1, `${flag.session}: the pole's foot is at the oval's middle`);
      assert.ok(foot.x < flag.on.x + flag.on.width / 2 && foot.x > flag.on.x, `${flag.session}: a little left of centre`);
      const top = Math.min(flag.pennant.y, flag.pole.y);
      assert.ok(top - (website.head.y + website.head.height) >= 0.5 && top - (website.head.y + website.head.height) <= 3.5, `${flag.session}: the flag's top clears the title row by about 2 px (${top - website.head.y - website.head.height})`);
    }
    const quiet = website.flags.find(({ session }) => session === 'quiet-contact'), working = website.flags.find(({ session }) => session === 'working-now');
    assert.ok(quiet.pennant.width < working.pennant.width * 0.6, 'the idle holder\'s flag is furled');
    const docs = by('Docs refresh');
    assert.equal(docs.flags.length, 0);
    const gap = docs.ovals[0].y - (docs.head.y + docs.head.height);
    assert.ok(gap <= 4, `a lane with no claims sits close under its title (${gap} px)`);
    assert.deepEqual(errors, []);
    const lanesBox = await page.locator('.arc-lanes').boundingBox();
    await page.screenshot({ path: path.join(output, `lanes-${named}.png`), clip: { x: lanesBox.x, y: lanesBox.y, width: 480, height: 120 } });
    if (scale === 1) await page.screenshot({ path: path.join(output, `board-${named}.png`), clip: { x: 0, y: 0, width: 1000, height: 300 } });
    result[named] = lanes.map(({ title, head, ovals, flags }) => ({ title, headBottom: head.y + head.height, firstOvalTop: ovals[0].y, flags: flags.map(({ session, fill, pennant, pole }) => ({ session, fill, top: Math.min(pennant.y, pole.y), pennantWidth: pennant.width })) }));
    await page.close();
  }
  writeFileSync(path.join(output, 'capture.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await reads?.close(); await log?.close(); await store?.close(); await postgres?.stop();
  rmSync(temporary, { recursive: true, force: true });
}
