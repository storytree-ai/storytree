// ADR-0980 D5 on the actual desktop renderer and app reads: the arc's detail panel is rows you scan
// (a folded intent, one table of questions with a status each, a table of increments with what each
// waits on, landed ones folded) and prose appears only when a row is opened.
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
import { openActivityLog, claim } from '@storytree/session-management';
// The frame is reached through the desktop app, which mounts this surface: arc-surface itself never depends on it (ADR-0847).
const { pageReads } = await import(pathToFileURL(createRequire(new URL('../../../../apps/desktop/package.json', import.meta.url)).resolve('@storytree/app')).href);
import { start } from '@storytree/local-postgres';
import { captureOutput, fakeBridge, launch } from '../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = captureOutput(here); // pictures and measurements: a scratch folder unless run with --retake
const dist = path.resolve(here, '../../../../apps/desktop/dist/renderer');
const temporary = mkdtempSync(path.join(tmpdir(), 'storytree-detail-panel-'));
const DAY = 86_400_000;
const day = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
let postgres, store, log, reads, browser, server;
try {
  postgres = await start({ dataDir: path.join(temporary, 'pgdata'), owner: 'detail panel capture' });
  store = await connect({ url: postgres.url }); log = await openActivityLog(postgres.url);
  const project = 'storytree';
  const library = await store.openProject(project);
  const story = await library.addStory({ title: 'Understand the work' });
  const part = await library.addCapability({ story: story.id, title: 'Take card payments' });
  const intent = (title) => `${title}: ${'Make the public site the front door for new users, with pricing, payments and a domain of its own. '.repeat(6)}`;
  const makeArc = (title) => library.createArc({ title, intent: intent(title), endState: 'Done.', stories: [story.id] });
  const work = (arc, title, extra = {}) => library.addIncrement({ arc: arc.id, title, objective: `${title}, so that the site can take its next step.`, body: `PLANNING BODY of ${title}`, ...extra });

  // A website arc with every kind of row: owner, other work, event, a passed check-back, held, free, failed, landed.
  const website = await makeArc('Website');
  for (let n = 1; n <= 39; n++) await work(website, `Landed page ${n}`, { outcome: { disposition: 'landed', pr: `storytree-ai/storytree#${200 + n}` } });
  await work(website, 'Move the blog', { outcome: { disposition: 'failed', note: 'The old engine could not export.' } });
  const q1 = await library.raiseQuestion({ arc: website.id, title: 'Which payment provider should take card payments for the first paid plan?', statement: 'Which provider should take card payments?', stakes: 'It sets fees and the review we wait on.', context: 'Two quotes are in.', options: 'A. The cheaper one. FOR: fees. AGAINST: slower review.\n\nB. The faster one. FOR: review. AGAINST: fees.', diagram: 'site → provider → bank', recommendation: 'The faster one.' });
  const q2 = await library.raiseQuestion({ arc: website.id, title: 'Should the domain move before launch?', statement: 'Move the domain now or after launch?', stakes: 'A late move risks broken links.', context: 'The registrar allows either.', options: 'A. Now.\n\nB. After.' });
  await library.settleQuestion(q2.id, { answer: 'Move it now, before anyone links to the old one.' });
  const payments = await work(website, 'Add card payments', { heldOn: [q1.id], capabilities: [part.id] });
  const dns = await work(website, 'Switch the DNS');
  await library.addWaitFor(dns.id, { releaser: 'owner', note: 'approve the DNS cutover' });
  const pricing = await work(website, 'Publish the pricing page');
  await library.addWait(pricing.id, payments.id, 'Prices name the provider’s fees.');
  const review = await work(website, 'Pass the provider review');
  await library.addWaitFor(review.id, { releaser: 'event', note: 'payment provider review', checkBack: day(14) });
  const footer = await work(website, 'Fix the footer links');
  await work(website, 'Write the about page');
  assert.equal((await claim({ library, log, project, session: 'capture-agent', harness: 'codex' }, footer.id, 'Fix the footer links')).ok, true);
  // A quiet arc with no questions.
  const docs = await makeArc('Docs refresh');
  await work(docs, 'Rewrite the quick start');

  reads = pageReads({ storytree: store });
  const pick = (names) => Object.fromEntries(names.map((name) => [name, reads[name]]));
  const bridge = fakeBridge({
    ...pick(['listProjects', 'projectTree', 'changesSince', 'linesSince', 'frontCovers', 'relatedNotes', 'arcView', 'arcViews']),
    holds: async () => library.holds(),
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
  browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, colorScheme: 'dark', deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', error => { errors.push(String(error)); console.error('pageerror', String(error)); });
  await bridge.install(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
  await bridge.ready(page);
  await page.evaluate(() => { const menu = document.getElementById('app-menu'); if (menu?.matches(':popover-open')) menu.hidePopover(); });
  await page.locator('[data-open-arcs]').click();
  await page.waitForSelector('.arc-overlay[data-arc-state=ready]');
  await page.locator(`[data-arc-select="${website.id}"]`).first().click();
  await page.waitForSelector('.arc-briefing .arc-increment');
  const panel = page.locator('.arc-briefing');
  const shot = async (name) => { const box = await page.locator('.arc-overlay').boundingBox(); await page.screenshot({ path: path.join(output, name), clip: box }); };
  const redraw = () => page.waitForTimeout(2600); // past the two-second live reading

  // Closed: nothing of any prose until a row is opened.
  const closed = await panel.evaluate((node) => ({
    intentOpen: node.querySelector('.arc-intent-fold').open,
    questions: [...node.querySelectorAll('.arc-question-row')].map((row) => [row.querySelector('.arc-row-title').textContent, row.querySelector('.arc-status-chip').textContent]),
    increments: [...node.querySelectorAll(':scope .arc-table > .arc-increment')].map((row) => [row.querySelector('.arc-increment-title').textContent, [...row.querySelectorAll('.arc-status-chip')].map((chip) => chip.textContent)]),
    landedFold: node.querySelector('.arc-landed-fold > summary')?.textContent,
    visibleText: node.innerText,
  }));
  assert.equal(closed.intentOpen, false);
  assert.deepEqual(closed.questions.map(([, status]) => status), ['open', 'settled']);
  assert.equal(closed.landedFold, '39 landed');
  assert.doesNotMatch(closed.visibleText, /PLANNING BODY|Move it now|Make the public site|so that the site/);
  const cells = Object.fromEntries(closed.increments);
  assert.deepEqual(cells['Add card payments'], ['you']);
  assert.deepEqual(cells['Switch the DNS'], ['you']);
  assert.deepEqual(cells['Publish the pricing page'], ['you', '1 increment'], 'it waits on work that waits behind your question');
  assert.deepEqual(cells['Pass the provider review'], ['event']);
  assert.match(cells['Fix the footer links'].join(), /min quiet/);
  assert.deepEqual(cells['Write the about page'], ['to take']);
  assert.deepEqual(cells['Move the blog'], ['not completed']);
  await shot('panel-closed.png');

  // An increment row open, kept across a live redraw.
  await panel.locator('.arc-increment > summary', { hasText: 'Publish the pricing page' }).click();
  await redraw();
  const opened = await panel.locator('.arc-increment[open]').evaluate((node) => node.innerText);
  assert.match(opened, /Objective[\s\S]*Publish the pricing page, so that[\s\S]*Waits on[\s\S]*Add card payments \(Website\): Prices name/);
  assert.doesNotMatch(opened, /PLANNING BODY/);
  await shot('increment-open.png');
  await panel.locator('.arc-increment[open] > summary').click();

  // The landed fold and the intent fold open, kept across a live redraw.
  await panel.locator('.arc-landed-fold > summary').click();
  await panel.locator('.arc-intent-fold > summary').click();
  await redraw();
  assert.equal(await panel.locator('.arc-landed-fold').evaluate((node) => node.open), true);
  assert.equal(await panel.locator('.arc-intent-fold').evaluate((node) => node.open), true);
  assert.equal(await panel.locator('.arc-landed-fold .arc-increment').count(), 39);
  assert.match(await panel.locator('.arc-landed-fold .arc-increment').first().innerText(), /^Landed page \d+\n#2\d\d$/);
  await shot('landed-open.png');
  await panel.locator('.arc-landed-fold > summary').click();
  await panel.locator('.arc-intent-fold > summary').click();

  // A settled question open: its answer on top of the full reading.
  await panel.locator('.arc-question-row', { hasText: 'domain' }).click();
  const reading = await panel.innerText();
  assert.match(reading, /^Answer\s+Move it now/);
  assert.match(reading, /back to questions/);
  await shot('question-open.png');
  await panel.locator('[data-question-back]').click();

  // An arc with no questions shows no questions section.
  await page.locator(`[data-arc-select="${docs.id}"]`).first().click();
  assert.doesNotMatch(await panel.innerText(), /Questions/);
  assert.deepEqual(errors, []);
  const result = { browser: await browser.version(), closed: { ...closed, visibleText: undefined }, opened, errors };
  writeFileSync(path.join(output, 'capture.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ questions: closed.questions, increments: closed.increments, landedFold: closed.landedFold }));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await reads?.close(); await log?.close(); await store?.close(); await postgres?.stop();
  rmSync(temporary, { recursive: true, force: true });
}
