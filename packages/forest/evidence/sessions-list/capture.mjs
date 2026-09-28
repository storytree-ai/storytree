// Bounded browser acceptance for forest running sessions and off-plan work.
// A prior read-only forest snapshot supplies the islands; all agent/arc activity here is synthetic.
// Run build.mjs and this script through flock /tmp/storytree-heavy.lock.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(path.join(here, '../../src/view/evidence/library-dots-clickable/seed.json'), 'utf8'));
const forest = seed.tree.stories.find(story => story.title === 'The forest');
const app = seed.tree.stories.find(story => story.title === 'The app');
const librarian = seed.tree.stories.find(story => story.title === 'The librarian');
const ids = {
  parent: 'sessions-list-supervisor', child: 'sessions-list-build-lane', digest: 'sessions-list-digest',
  idle: 'sessions-list-idle', offPlan: 'sessions-list-off-plan', ended: 'sessions-list-ended',
  arc: 'arc_sessions_list_fixture', increment: 'increment_sessions_list_fixture', question: 'question_sessions_list_fixture',
};
const now = Date.now();
const at = minutes => new Date(now - minutes * 60_000).toISOString();
const lines = [];
function line(session, minutes, fields) {
  lines.push({ project: 'storytree', source: 'hook', harness: 'claude-code', session,
    seq: lines.length + 1, at: at(minutes), ...fields });
}
line(ids.parent, 5, { kind: 'session-started' });
line(ids.parent, 4, { kind: 'claimed', source: 'tool', capability: forest.capabilities[0].id, reason: 'Build the running sessions list' });
line(ids.parent, 4, { kind: 'claimed', source: 'tool', capability: app.capabilities[0].id, reason: 'Build the running sessions list' });
line(ids.parent, 3, { kind: 'subagent-started', subagent: ids.child, type: 'worker', task: 'Capture the running sessions view' });
line(ids.child, 3, { kind: 'session-started', harness: 'codex' });
line(ids.child, 2, { kind: 'claimed', harness: 'codex', source: 'tool', capability: forest.capabilities[1].id, reason: 'Capture the running sessions view' });
line(ids.parent, 2, { kind: 'subagent-started', subagent: ids.digest, type: 'explorer', task: 'Read the list contracts' });
line(ids.idle, 61, { kind: 'session-started' });
line(ids.idle, 60, { kind: 'claimed', source: 'tool', capability: librarian.capabilities[0].id, reason: 'Check the library links' });
line(ids.offPlan, 3, { kind: 'session-started', harness: 'codex' });
line(ids.offPlan, 2, { kind: 'file-edited', harness: 'codex', files: ['src/example.ts', 'src/example.test.ts'] });
line(ids.offPlan, 1, { kind: 'file-edited', harness: 'codex', files: ['src/example.ts'] });
line(ids.offPlan, 0, { kind: 'command-run', harness: 'codex', command: 'pnpm test -- sessions-list' });
line(ids.ended, 5, { kind: 'session-started' });
line(ids.ended, 4, { kind: 'session-ended', reason: 'finished' });
seed.lines = { lines, cursor: lines.length };
const record = (id, type, fields) => ({ id, type, version: 1, fields, createdAt: at(10), updatedAt: at(0) });
seed.arcView = {
  arc: record(ids.arc, 'arc', { title: 'Running sessions', description: 'Synthetic browser evidence', stories: [forest.id, app.id] }),
  state: 'active',
  increments: [record(ids.increment, 'increment', { arc: ids.arc, title: 'Running sessions list', objective: 'Readable current sessions',
    body: 'Synthetic browser evidence', status: 'active', touches: [forest.capabilities[0].id, app.capabilities[0].id], heldOn: [ids.question] })],
  questions: [record(ids.question, 'question', { arc: ids.arc, title: 'Read this list at a glance', stakes: 'Readability', statement: 'Does the list read clearly?',
    context: 'Synthetic browser evidence', options: 'Look at the running sessions', lifecycle: 'open' })],
};
seed.tree.arcs = [{ id: ids.arc, title: 'Running sessions', description: 'Synthetic browser evidence', stories: [forest.id, app.id] }];
seed.fixtureIds = ids;

const { chromium } = await import(process.env.PLANET_PLAYWRIGHT
  ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (name === 'favicon.ico') { res.writeHead(204).end(); return; }
  if (!['index.html', 'renderer.js', 'renderer.js.map', 'renderer.css', 'styles.css', 'arc-surface.css', 'app-setup.css', 'forest.css'].includes(name)) {
    res.writeHead(404).end(); return;
  }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.map') ? 'application/json' : 'text/html');
  res.end(readFileSync(path.join(here, 'dist/production', name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PLANET_CHROMIUM
    ?? '/home/mickh/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell', headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  page.setDefaultTimeout(15_000);
  const errors = [], warnings = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'warning') warnings.push(message.text());
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(data => {
    const copy = value => structuredClone(value);
    window.__sessionLines = copy(data.lines.lines);
    window.__libraryChanges = copy(data.changes.changes);
    window.__arcView = copy(data.arcView);
    window.storytree = {
      projectSelection: async () => ({ projects: data.projects, current: 'storytree' }),
      projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => ({ changes: copy(window.__libraryChanges.filter(change => change.seq > cursor)),
        cursor: window.__libraryChanges.at(-1)?.seq ?? cursor }),
      linesSince: async (_, cursor) => ({ lines: copy(window.__sessionLines.filter(item => item.seq > cursor)),
        cursor: window.__sessionLines.at(-1)?.seq ?? cursor }),
      frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [],
      arcView: async (_, id) => id === data.fixtureIds.arc ? copy(window.__arcView) : null,
      waitHolds: async () => [],
      heldOnQuestion: async (_, id) => id === data.fixtureIds.increment && window.__arcView.questions[0].fields.lifecycle === 'open'
        ? [data.fixtureIds.question] : [],
    };
  }, seed);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && window.__globe && window.__nav);
  const closeHelp = page.getByRole('button', { name: 'Close help', exact: true });
  if (await closeHelp.isVisible()) await closeHelp.click();
  const list = page.getByRole('complementary', { name: 'Running sessions', exact: true });
  await list.waitFor();
  const row = session => list.locator(`.session-row[data-session-id="${session}"]`);
  await row(ids.parent).waitFor();
  await row(ids.idle).waitFor();
  await row(ids.offPlan).waitFor();
  const visibleIds = () => list.locator('.session-row:visible').evaluateAll(nodes => nodes.map(node => node.dataset.sessionId).sort());
  assert.deepEqual(await visibleIds(), [ids.parent, ids.idle, ids.offPlan].sort(), 'one row per root session; ended and nested sessions hidden');
  assert.match(await row(ids.parent).innerText(), /Build the running sessions list/);
  assert.equal(await row(ids.idle).getAttribute('data-state'), 'idle', 'idle remains visible');
  assert.doesNotMatch(await list.innerText(), /hooks not running/i);
  assert.equal(await page.locator('.unclaimed').count(), 0, 'the old separate unclaimed surface is not mounted');
  const bounds = await list.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x < 160 && 960 - bounds.y - bounds.height < 100, 'list sits at the lower left');
  const context = await list.locator('.session-row:visible').evaluateAll(nodes => nodes.map(node => {
    const slot = node.querySelector('.session-context-slot'), total = node.querySelector('.session-total');
    return { session: node.dataset.sessionId, slot: Boolean(slot), segments: slot?.children.length,
      slotText: slot?.textContent, total: total?.textContent, totalTitle: total?.getAttribute('title'), totalLabel: total?.getAttribute('aria-label') };
  }));
  for (const item of context) {
    assert.equal(item.slot, true, 'every row reserves its context bar slot');
    assert.equal(item.segments, 0, 'no invented context composition');
    assert.equal(item.slotText, '');
    assert.ok(item.total && !/\d/.test(item.total), 'the unavailable context total is not invented');
  }
  assert.match(await row(ids.parent).innerText(), /needs you/);
  assert.doesNotMatch(await row(ids.idle).innerText(), /needs you/);
  assert.doesNotMatch(await row(ids.offPlan).innerText(), /needs you/);
  const stateColors = await list.locator('.session-row:visible').evaluateAll(nodes => nodes.flatMap(node =>
    [...node.children].filter(child => child.textContent.trim()).map(child => ({
      className: child.className, text: child.textContent.trim(), color: getComputedStyle(child).color,
    }))));
  for (const item of stateColors) {
    const channels = item.color.match(/[\d.]+/g).slice(0, 3).map(Number);
    const spread = Math.max(...channels) - Math.min(...channels);
    assert.equal(spread > 30, item.className === 'session-needs-you', `needs you is the only coloured row state: ${JSON.stringify({ item, errors })}`);
  }

  // Turn the forest island toward the camera using the production navigation's ordinary setter.
  await page.evaluate(id => {
    const { scene, camera } = window.__globe;
    scene.updateMatrixWorld(true);
    const V = camera.position.constructor, Q = camera.quaternion.constructor;
    const plate = scene.getObjectByName(`planet:${id}`);
    const normal = new V(0, 1, 0).applyQuaternion(plate.getWorldQuaternion(new Q()));
    const eye = new V(0, 0, 1).applyQuaternion(camera.quaternion);
    window.__nav.onRotate(new Q().setFromUnitVectors(normal, eye).multiply(window.__nav.rotation));
  }, forest.id);
  const frames = async () => page.evaluate(async () => {
    for (let i = 0; i < 8; i++) { window.__globe.invalidate(); await new Promise(requestAnimationFrame); }
  });
  await frames();
  await page.screenshot({ path: path.join(here, 'sessions-list.png') });

  const plateState = async () => page.evaluate(storyIds => {
    const plates = [];
    window.__globe.scene.traverse(plate => {
      if (!storyIds.includes(plate.name.slice('planet:'.length)) || !plate.name.startsWith('planet:')) return;
      const materials = [];
      plate.traverse(object => {
        if (!object.isMesh) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.push({ object: object.uuid, material: material.uuid, color: material.color?.getHexString(), opacity: material.opacity,
            transparent: material.transparent, brightness: material.userData.sessionBrightness ?? null });
        }
      });
      plates.push({ id: plate.name.slice('planet:'.length), emphasis: plate.userData.sessionEmphasis ?? null, materials });
    });
    return plates.sort((a, b) => a.id.localeCompare(b.id));
  }, seed.tree.stories.map(story => story.id));
  const baseline = await plateState();
  await row(ids.parent).hover();
  await frames();
  const hovered = await plateState();
  await page.screenshot({ path: path.join(here, 'sessions-list-hover.png') });
  console.log('Hover reading:', JSON.stringify(hovered.map(({ id, emphasis, materials }) => ({ id, emphasis, brightness: [...new Set(materials.map(material => material.brightness))] }))));
  for (const plate of hovered) {
    assert.equal(plate.emphasis, [forest.id, app.id].includes(plate.id) ? 'held' : 'dimmed', 'all held islands light together and the rest dim');
    assert.ok(plate.materials.some(material => material.brightness === (plate.emphasis === 'held' ? 1.16 : 0.24)), 'brightness reaches the island materials');
  }
  const rings = await page.evaluate(() => {
    const found = [];
    window.__globe.scene.traverse(object => {
      if (object.name.startsWith('session-highlight:')) found.push({ story: object.name.slice('session-highlight:'.length), color: object.material.color.getHexString() });
    });
    return found.sort((a, b) => a.story.localeCompare(b.story));
  });
  assert.deepEqual(rings.map(ring => ring.story), [forest.id, app.id].sort(), 'each highlighted island has its own ring');
  assert.ok(rings.every(ring => ring.color === 'edf4ee'), 'session rings use the neutral highlight');
  assert.notDeepEqual(hovered.find(plate => plate.id === librarian.id).materials,
    baseline.find(plate => plate.id === librarian.id).materials, 'dimmed is applied to real island materials');
  await page.mouse.move(1400, 930);
  await frames();
  assert.deepEqual(await plateState(), baseline, 'pointer leave restores the original materials');
  await row(ids.parent).focus();
  await frames();
  assert.deepEqual((await plateState()).map(({ id, emphasis }) => ({ id, emphasis })), hovered.map(({ id, emphasis }) => ({ id, emphasis })), 'keyboard focus links the same islands');
  await page.getByRole('button', { name: 'Open arc surface', exact: true }).focus();
  await frames();
  assert.deepEqual(await plateState(), baseline, 'focus leaving the row restores the forest');

  const children = row(ids.parent).locator('.session-children-toggle');
  assert.equal(await children.getAttribute('aria-expanded'), 'false');
  assert.match(await children.innerText(), /\+2/);
  await children.click();
  assert.equal(await children.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(await visibleIds(), [ids.parent, ids.child, ids.digest, ids.idle, ids.offPlan].sort(), 'explicit subagents expand once, including a child with its own log');
  assert.match(await row(ids.child).innerText(), /Capture the running sessions view/);
  assert.match(await row(ids.digest).innerText(), /Read the list contracts/);

  const offPlan = row(ids.offPlan).locator('.session-off-plan');
  assert.match(await offPlan.getAttribute('aria-label'), /^Show off-plan work for /);
  assert.match(await offPlan.innerText(), /off plan.*2 files/i, 'repeated edit counts the same file once');
  await offPlan.click();
  assert.equal(await offPlan.getAttribute('aria-expanded'), 'true');
  const expandedText = await list.innerText();
  assert.match(expandedText, /src\/example\.ts/);
  assert.match(expandedText, /src\/example\.test\.ts/);
  assert.match(expandedText, /pnpm test -- sessions-list/);
  await page.mouse.move(1400, 930);
  await page.getByRole('button', { name: 'Open arc surface', exact: true }).focus();
  await frames();
  await page.screenshot({ path: path.join(here, 'sessions-list-expanded.png') });

  // Exercise real two-second polling, without remounting: settle the question and end the child.
  await page.evaluate(({ child }) => {
    const question = window.__arcView.questions[0];
    question.fields.lifecycle = 'settled'; question.fields.answer = 'The list reads clearly.'; question.updatedAt = new Date().toISOString();
    window.__libraryChanges.push({ seq: window.__libraryChanges.at(-1).seq + 1, recordId: question.id, type: 'question', action: 'edited', record: structuredClone(question) });
    window.__sessionLines.push({ project: 'storytree', source: 'hook', harness: 'codex', session: child,
      seq: window.__sessionLines.at(-1).seq + 1, at: new Date().toISOString(), kind: 'session-ended', reason: 'finished' });
  }, ids);
  await page.waitForFunction(parent => !document.querySelector(`.session-row[data-session-id="${parent}"]`)?.textContent.includes('needs you'), ids.parent);
  await row(ids.child).waitFor({ state: 'hidden' });
  assert.equal(await children.getAttribute('aria-expanded'), 'true', 'polling preserves the expanded parent');
  assert.match(await children.innerText(), /\+1/);
  assert.equal(await offPlan.getAttribute('aria-expanded'), 'true', 'polling preserves off-plan expansion');
  await children.click();
  assert.equal(await children.getAttribute('aria-expanded'), 'false');
  await row(ids.digest).waitFor({ state: 'hidden' });
  assert.deepEqual(errors, [], 'no browser runtime or console errors');
  const renderer = await page.evaluate(() => {
    const ctx = window.__globe.gl.getContext(), debug = ctx.getExtension('WEBGL_debug_renderer_info');
    return debug && ctx.getParameter(debug.UNMASKED_RENDERER_WEBGL);
  });
  const result = { browser: await browser.version(), renderer,
    fixture: 'prior read-only library snapshot; synthetic root, nested, idle, off-plan and ended sessions; one open owner question',
    bounds, rootSessions: [ids.parent, ids.idle, ids.offPlan], context, stateColors,
    hover: hovered.map(({ id, emphasis }) => ({ id, emphasis })), rings,
    assertions: ['root rows deduplicate claims', 'idle visible; ended hidden', 'two explicit children collapsed and expandable',
      'empty bar slots and unavailable totals', 'off-plan files deduplicate; edit and command details expand',
      'hover and focus link all claimed islands and restore materials', 'question settlement refreshes',
      'session ending refreshes', 'polling preserves both expansions'],
    errors, warnings: [...new Set(warnings)] };
  writeFileSync(path.join(here, 'capture.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
