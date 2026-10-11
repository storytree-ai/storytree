// Arc surface contract 3.10 (ADR-1002 D3): the open drawer's Expand / Restore control, on the real renderer.
// Geometry and interaction in headless Chromium, over an isolated Postgres holding an explicit fixture, so no live
// project is opened or changed. The fake bridge and Chromium come from the capture kit (apps/desktop/src/capture).
// Run after `node apps/desktop/build.mjs`; add --retake to write the pictures and capture.json into this folder.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connect } from '@storytree/library';
// The frame is reached through the desktop app, which mounts this surface: arc-surface itself never depends on it (ADR-0847).
const { pageReads } = await import(pathToFileURL(createRequire(new URL('../../../../apps/desktop/package.json', import.meta.url)).resolve('@storytree/app')).href);
import { start } from '@storytree/local-postgres';
import { captureOutput, fakeBridge, launch } from '../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = captureOutput(here); // pictures and measurements: a scratch folder unless run with --retake
const dist = path.resolve(here, '../../../../apps/desktop/dist/renderer');
const temporary = mkdtempSync(path.join(tmpdir(), 'storytree-drawer-expand-capture-'));
let postgres, store, reads, browser, server;
try {
  postgres = await start({ dataDir: path.join(temporary, 'pgdata'), owner: 'drawer expand capture' });
  store = await connect({ url: postgres.url });
  const project = 'storytree';
  const library = await store.openProject(project);
  const story = await library.addStory({ title: 'Understand the work' });
  // Enough arcs that the lanes list overflows the half-height drawer: the expanded one then has something to use its height on.
  const names = ['Website', 'Cloud backups', 'Mobile app', 'Docs refresh', 'Billing', 'Search', 'Onboarding', 'Accessibility', 'Offline mode', 'Import and export', 'Notifications', 'Permissions', 'Reports', 'Themes', 'Audit trail', 'Release process'];
  for (const [index, title] of names.entries()) {
    const arc = await library.createArc({ title, intent: `${title}: make it work end to end, so the owner can rely on it without looking over a shoulder. `.repeat(3), endState: `${title} works and is documented.`, stories: [story.id] });
    const work = (name, extra = {}) => library.addIncrement({ arc: arc.id, title: name, objective: name, body: `${name}. `.repeat(8), ...extra });
    await work(`${title}: first slice`, { outcome: { disposition: 'landed', pr: String(100 + index) } });
    await work(`${title}: second slice`);
    const held = await work(`${title}: third slice`);
    if (index % 3 === 0) await library.addWaitFor(held.id, { releaser: 'owner', note: 'pick the approach' });
  }
  reads = pageReads({ storytree: store });
  const pick = (list) => Object.fromEntries(list.map((name) => [name, reads[name]]));
  const bridge = fakeBridge({
    ...pick(['listProjects', 'projectTree', 'changesSince', 'linesSince', 'frontCovers', 'relatedNotes', 'arcView', 'arcViews']),
    holds: async () => library.holds(new Date()),
    projectSelection: async () => ({ current: project, projects: [project] }),
    readSurfaces: async () => undefined,
    agentConnections: async () => [],
    codeSurvey: async () => ({}),
    checkForUpdates: async () => ({ phase: 'unavailable', runningBuild: 'capture', reason: 'not under test' }),
  });
  server = createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!['index.html', 'renderer.js', 'styles.css', 'app-setup.css', 'arc-surface.css', 'forest.css'].includes(name)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(readFileSync(path.join(dist, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark', deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => { errors.push(String(error)); console.error('pageerror', String(error)); });
  await bridge.install(page);
  await page.addInitScript(() => { try { localStorage.setItem('storytree:setup:guide-seen:v1', 'yes'); } catch { /* about:blank has no storage */ } });
  const origin = `http://127.0.0.1:${server.address().port}/`;
  const history = await library.history();
  const ready = async () => {
    await bridge.ready(page, 120000);
    await page.evaluate(() => { const menu = document.getElementById('app-menu'); if (menu?.matches(':popover-open')) menu.hidePopover(); });
    if (await page.locator('.panel-close').isVisible()) await page.locator('.panel-close').evaluate(button => button.click());
  };
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await ready();

  const gear = page.getByRole('button', { name: 'App menu', exact: true });
  const openBar = page.getByRole('button', { name: 'Open arc surface', exact: true });
  const closeBar = page.getByRole('button', { name: 'Close arc surface', exact: true });
  const drawer = page.locator('#arc-drawer');
  const size = page.locator('[data-expand-arcs]');
  const box = async (locator) => locator.boundingBox();
  const bottom = (b) => b.y + b.height;
  const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const view = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const insideDrawer = (x, y) => page.evaluate(([px, py]) => { const el = document.elementFromPoint(px, py); return el ? { inside: !!el.closest('#arc-drawer'), tag: el.tagName, cls: el.className?.toString?.() ?? '' } : null; }, [x, y]);
  const openDrawer = async () => { await openBar.click(); await page.waitForSelector('.arc-overlay[data-arc-state=ready]'); await page.waitForSelector('.arc-lanes > .arc-row, .arc-lanes .arc-lane', { state: 'attached' }); };
  const settled = () => page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => undefined))));
  const measures = {};

  const appBarBox = await box(page.locator('.app-bar'));
  const barBox = await box(openBar);
  const barBottom = bottom(barBox);
  assert.equal(barBox.y, bottom(appBarBox), 'the Arcs bar starts directly below the app bar');
  // Probes: the forest canvas counts pointer input; the Sessions strip is the thing the expanded drawer must cover.
  await page.locator('canvas').evaluate(canvas => { window.pointerCount = 0; canvas.addEventListener('pointerdown', () => window.pointerCount++); });
  const strip = page.locator('aside.sessions-list');
  await strip.waitFor({ state: 'attached' });
  const stripBox = await box(strip);
  assert.ok(stripBox && stripBox.height > 20 && bottom(stripBox) <= 960 + 1, `the Sessions strip is drawn at the window's foot (${JSON.stringify(stripBox)})`);
  const stripPoint = [Math.round(stripBox.x + stripBox.width / 2), Math.round(stripBox.y + stripBox.height / 2)];
  const stripOpenState = () => strip.evaluate(node => ({ box: JSON.stringify(node.getBoundingClientRect()), html: node.innerHTML.length }));
  const stripBefore = await stripOpenState();
  assert.equal((await insideDrawer(...stripPoint)).inside, false, 'drawer closed: the strip is not under the drawer');

  // 1. Opened: half height, control reads Expand, top right inside the drawer, clear of the scope buttons and not on the bar.
  await openDrawer();
  await page.screenshot({ path: path.join(output, 'drawer-half.png') });
  let drawerBox = await box(drawer);
  const half = { drawerBox: { ...drawerBox } };
  assert.deepEqual([drawerBox.x, drawerBox.width], [0, 1440]);
  assert.equal(drawerBox.y, barBottom, 'the drawer opens directly below the Arcs bar');
  assert.ok(Math.abs(drawerBox.height - 480) <= 1, `half the window: 480 px, not ${drawerBox.height}`);
  assert.equal((await size.innerText()).trim(), 'Expand', 'opened, the control reads Expand');
  assert.equal(await drawer.getAttribute('data-expanded'), 'false');
  const sizeBox = await box(size);
  const scopeBoxes = await Promise.all(['active', 'parked', 'closed'].map(async scope => ({ scope, box: await box(page.locator(`[data-arc-scope="${scope}"]`)) })));
  half.sizeBox = sizeBox; half.scopes = scopeBoxes;
  assert.ok(sizeBox.x >= drawerBox.x && sizeBox.y >= drawerBox.y && sizeBox.x + sizeBox.width <= drawerBox.x + drawerBox.width && bottom(sizeBox) <= bottom(drawerBox), 'the control lies inside the drawer');
  assert.ok(drawerBox.x + drawerBox.width - (sizeBox.x + sizeBox.width) <= 40 && sizeBox.y - drawerBox.y <= 12, 'the control is at the drawer top right');
  assert.ok(!overlap(sizeBox, barBox), 'the control is not on the Arcs bar');
  for (const { scope, box: b } of scopeBoxes) assert.ok(b && !overlap(sizeBox, b), `the control does not overlap the ${scope} scope button`);
  const rowTop = Math.min(...scopeBoxes.map(s => s.box.y));
  assert.ok(sizeBox.y >= rowTop - 6 && bottom(sizeBox) <= rowTop + scopeBoxes[0].box.height + 6, 'the control sits on the row the scopes start');
  assert.ok(await page.locator('.arc-lane').count() >= 10, 'the board has lanes: an empty board is not pictured');
  // The lanes pane overflows at half height, so the expanded height has something to use.
  const lanesHalf = await page.locator('.arc-lanes').evaluate(node => ({ clientHeight: node.clientHeight, scrollHeight: node.scrollHeight }));
  half.lanes = lanesHalf;
  assert.ok(lanesHalf.scrollHeight > lanesHalf.clientHeight, 'the lanes overflow the half-height drawer');
  // The bar still toggles at both ends.
  await closeBar.click({ position: { x: barBox.width - 20, y: barBox.height / 2 } });
  assert.equal(await drawer.isVisible(), false, 'a click at the bar\'s right end closes the drawer (the control is not there)');
  await openBar.click({ position: { x: 20, y: barBox.height / 2 } });
  assert.equal(await drawer.isVisible(), true, 'a click at the bar\'s left end opens it');
  assert.deepEqual(await box(closeBar), barBox, 'the bar has not moved');

  // 2. Expand, from the keyboard.
  await size.focus(); await page.keyboard.press('Enter');
  assert.equal((await size.innerText()).trim(), 'Restore', 'pressed, the control reads Restore');
  assert.equal(await size.evaluate(node => node === document.activeElement), true, 'the control keeps focus when pressed from the keyboard');
  assert.equal(await drawer.getAttribute('data-expanded'), 'true');
  const expandedAt = async () => {
    const inner = await view();
    const b = await box(drawer);
    assert.deepEqual([b.x, b.width], [0, inner.width], 'expanded, the drawer is full width');
    assert.equal(b.y, barBottom, 'expanded, the drawer starts at the Arcs bar\'s bottom edge');
    assert.ok(Math.abs(bottom(b) - inner.height) <= 0.5, `expanded, the drawer reaches the window's bottom edge (${bottom(b)} of ${inner.height})`);
    return { inner, drawerBox: b };
  };
  const expanded = await expandedAt();
  await settled(); // the board's own 180 ms pull-down has finished
  const panes = await box(page.locator('.arc-panes'));
  assert.ok(Math.abs(bottom(panes) - bottom(expanded.drawerBox)) <= 1, 'the board\'s panes run to the drawer\'s foot: the new height is used');
  await page.screenshot({ path: path.join(output, 'drawer-expanded.png') }); // before the probes below click into the board
  const covered = [stripPoint, [720, expanded.inner.height - 4], [Math.round(stripBox.x + 40), Math.round(stripBox.y + 8)]];
  for (const [x, y] of covered) assert.equal((await insideDrawer(x, y))?.inside, true, `the point (${x}, ${y}) under the Sessions strip is the drawer's`);
  // Forest canvas and strip receive no pointer input while expanded: clicks over where they are land in the drawer.
  const before = await page.evaluate(() => window.pointerCount);
  await page.mouse.click(...stripPoint);
  await page.mouse.click(720, expanded.inner.height - 40);
  await page.mouse.click(1000, expanded.inner.height - 120);
  assert.equal(await page.evaluate(() => window.pointerCount), before, 'the forest canvas receives no pointer input while expanded');
  assert.deepEqual(await stripOpenState(), stripBefore, 'the Sessions strip was not touched by clicks over it');
  // The gear stays reachable.
  await gear.click();
  assert.equal(await page.locator('#app-menu').isVisible(), true, 'the gear opens the app menu with the drawer expanded');
  await gear.click();
  await page.evaluate(() => { const menu = document.getElementById('app-menu'); if (menu?.matches(':popover-open')) menu.hidePopover(); });
  // The board scrolls inside the drawer; the page does not.
  const lanesFull = await page.locator('.arc-lanes').evaluate(node => { const before = node.scrollTop; node.scrollTop = 150; const after = node.scrollTop; node.scrollTop = before; return { clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, overflowY: getComputedStyle(node).overflowY, scrolled: after }; });
  assert.ok(lanesFull.clientHeight > lanesHalf.clientHeight + 300, `the lanes pane uses the new height (${lanesHalf.clientHeight} to ${lanesFull.clientHeight})`);
  assert.ok(lanesFull.scrollHeight > lanesFull.clientHeight && lanesFull.scrolled > 0 && /auto|scroll/.test(lanesFull.overflowY), 'the lanes pane scrolls inside the drawer');
  const briefing = await page.locator('.arc-briefing').evaluate(node => ({ overflowY: getComputedStyle(node).overflowY, clientHeight: node.clientHeight, bottom: node.getBoundingClientRect().bottom }));
  assert.ok(/auto|scroll/.test(briefing.overflowY) && briefing.clientHeight > 300 && briefing.bottom <= expanded.inner.height + 0.5, 'the briefing pane scrolls inside the drawer');
  const page0 = await page.evaluate(() => ({ scrollHeight: document.scrollingElement.scrollHeight, innerHeight, scrollY }));
  assert.ok(page0.scrollHeight <= page0.innerHeight && page0.scrollY === 0, 'the page itself does not scroll');
  measures.expanded = { ...expanded, sizeBox: await box(size), panes, lanes: lanesFull, briefing, page: page0, covered: covered.map(([x, y]) => ({ x, y })) };

  // 3. Escape closes the expanded drawer and returns focus to the bar; it opens expanded again; a reload keeps it.
  await page.keyboard.press('Escape');
  assert.equal(await drawer.isVisible(), false, 'Escape closes the expanded drawer');
  assert.equal(await openBar.evaluate(node => node === document.activeElement), true, 'Escape returns focus to the bar');
  await openBar.focus(); await page.keyboard.press('Enter');
  assert.equal(await drawer.isVisible(), true);
  await expandedAt();
  assert.equal((await size.innerText()).trim(), 'Restore', 'opening again, it is still expanded');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  await page.waitForSelector('.arc-overlay[data-arc-state=ready]');
  await expandedAt();
  assert.equal((await size.innerText()).trim(), 'Restore', 'after a reload it opens expanded');
  // Restore returns it to half the window's height, and that survives a reload too.
  await size.focus(); await page.keyboard.press('Space');
  assert.equal((await size.innerText()).trim(), 'Expand', 'pressed again, the control reads Expand');
  assert.equal(await size.evaluate(node => node === document.activeElement), true, 'focus stays on the control after Restore');
  drawerBox = await box(drawer);
  assert.ok(Math.abs(drawerBox.height - 480) <= 1 && drawerBox.y === barBottom, 'Restore returns the drawer to half height');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  await page.waitForSelector('.arc-overlay[data-arc-state=ready]');
  drawerBox = await box(drawer);
  assert.ok(Math.abs(drawerBox.height - 480) <= 1, 'after a reload it opens at half height');
  assert.equal((await size.innerText()).trim(), 'Expand');

  // Narrow window: 360 x 640.
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(150);
  const narrowBar = await box(closeBar);
  const narrow = {};
  drawerBox = await box(drawer);
  assert.ok(Math.abs(drawerBox.height - 320) <= 1, `narrow: half the window, 320 px (${drawerBox.height})`);
  const nSize = await box(size);
  const nScopes = await Promise.all(['active', 'parked', 'closed'].map(async scope => await box(page.locator(`[data-arc-scope="${scope}"]`))));
  assert.ok(nSize.x >= 0 && nSize.x + nSize.width <= 360 && nSize.y >= drawerBox.y && bottom(nSize) <= bottom(drawerBox), 'narrow: the control lies inside the drawer');
  for (const b of nScopes) assert.ok(!overlap(nSize, b), 'narrow: the control does not overlap the scope buttons');
  assert.ok(!overlap(nSize, narrowBar), 'narrow: the control is not on the Arcs bar');
  const nStatus = page.locator('.arc-status');
  if (await nStatus.count() && (await nStatus.innerText()).trim()) assert.ok(!overlap(nSize, await box(nStatus)), 'narrow: the control does not cover the status line');
  narrow.half = { drawerBox: { ...drawerBox }, sizeBox: nSize, scopes: nScopes };
  await page.screenshot({ path: path.join(output, 'drawer-half-narrow.png') });
  await closeBar.click({ position: { x: narrowBar.width - 20, y: narrowBar.height / 2 } });
  assert.equal(await drawer.isVisible(), false, 'narrow: a click at the bar\'s right end closes the drawer');
  await openBar.click();
  await size.click();
  const nInner = await view();
  drawerBox = await box(drawer);
  assert.deepEqual([drawerBox.x, drawerBox.width], [0, 360]);
  assert.equal(drawerBox.y, bottom(narrowBar), 'narrow expanded: starts at the Arcs bar\'s bottom edge');
  assert.ok(Math.abs(bottom(drawerBox) - nInner.height) <= 0.5, 'narrow expanded: reaches the window\'s bottom edge');
  assert.equal((await size.innerText()).trim(), 'Restore');
  const nStrip = await box(strip);
  if (nStrip) assert.equal((await insideDrawer(Math.round(nStrip.x + nStrip.width / 2), Math.round(nStrip.y + nStrip.height / 2))).inside, true, 'narrow expanded: the Sessions strip lies under the drawer');
  const nExpandedSize = await box(size);
  assert.ok(nExpandedSize.x + nExpandedSize.width <= 360 && !overlap(nExpandedSize, narrowBar), 'narrow expanded: the control stays inside the window and off the bar');
  for (const scope of ['active', 'parked', 'closed']) assert.ok(!overlap(nExpandedSize, await box(page.locator(`[data-arc-scope="${scope}"]`))), 'narrow expanded: the control clears the scope buttons');
  await page.screenshot({ path: path.join(output, 'drawer-expanded-narrow.png') });
  const narrowGear = await box(gear);
  await gear.click();
  assert.equal(await page.locator('#app-menu').isVisible(), true, 'narrow expanded: the gear opens the app menu');
  await gear.click();
  await page.evaluate(() => { const menu = document.getElementById('app-menu'); if (menu?.matches(':popover-open')) menu.hidePopover(); });
  const nPage = await page.evaluate(() => ({ scrollHeight: document.scrollingElement.scrollHeight, innerHeight, scrollY }));
  assert.ok(nPage.scrollHeight <= nPage.innerHeight, 'narrow expanded: the page itself does not scroll');
  narrow.expanded = { drawerBox: { ...drawerBox }, sizeBox: nExpandedSize, gear: narrowGear, page: nPage };
  await page.keyboard.press('Escape');
  assert.equal(await drawer.isVisible(), false, 'narrow: Escape closes the expanded drawer');

  // 4. Read-only: nothing was written to the library; no page errors.
  assert.deepEqual(await library.history(), history, 'all drawer interactions are read-only');
  await library.close();
  assert.deepEqual(errors, []);
  const result = { browser: await browser.version(), records: history.length, arcs: names.length, wide: { viewport: { width: 1440, height: 960 }, appBarBox, barBox, strip: stripBox, half, ...measures }, narrow: { viewport: { width: 360, height: 640 }, ...narrow }, errors,
    passed: ['half height, control reads Expand, top right, clear of scopes and bar', 'bar closes at its right end, opens at its left', 'Expand from the keyboard keeps focus and reads Restore', 'expanded drawer spans bar bottom to window bottom, full width', 'Sessions strip and forest canvas covered, no pointer input to the forest', 'gear reachable', 'panes fill the height and scroll inside; page does not scroll', 'Escape closes and returns focus to the bar', 'expanded and half sizes survive a reload', 'narrow 360 x 640 half and expanded', 'read-only, no page errors'] };
  writeFileSync(path.join(output, 'capture.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await reads?.close(); await store?.close(); await postgres?.stop();
  rmSync(temporary, { recursive: true, force: true });
}
