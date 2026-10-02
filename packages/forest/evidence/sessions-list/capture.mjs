// Bounded browser evidence for the current running-sessions strip and row detail.
// A prior read-only forest snapshot supplies the islands; all agent/arc activity here is synthetic.
// Run build.mjs and this script through flock /tmp/storytree-heavy.lock.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBridge, withCapture } from '../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(path.join(here, '../../src/view/evidence/library-dots-clickable/seed.json'), 'utf8'));
// This older snapshot predates annotated status words. Carry its verified contract
// states into today's fixture shape so the panel never renders an undefined word.
for (const story of seed.tree.stories) for (const capability of story.capabilities) {
  capability.proposed ??= false;
  const verified = capability.contracts.map(contract => contract.health.verified.state);
  capability.status ??= capability.proposed ? 'proposed' : verified.includes('failing') ? 'unhealthy'
    : verified.length > 0 && verified.every(state => state === 'passing') ? 'healthy' : 'untested';
}
const forest = seed.tree.stories.find(story => story.title === 'The forest');
const app = seed.tree.stories.find(story => story.title === 'The app');
const librarian = seed.tree.stories.find(story => story.title === 'The librarian');
const ids = {
  parent: 'sessions-list-supervisor', child: 'sessions-list-build-lane', digest: 'sessions-list-digest',
  idle: 'sessions-list-idle', offPlan: 'sessions-list-off-plan', pusher: 'sessions-list-pusher',
  belowLine: 'sessions-list-below-line', ended: 'sessions-list-ended',
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
line(ids.idle, 36, { kind: 'session-started' });
line(ids.idle, 35, { kind: 'claimed', source: 'tool', capability: librarian.capabilities[0].id, reason: 'Check the library links' });
line(ids.offPlan, 3, { kind: 'session-started', harness: 'codex' });
// Unclaimed membership is independent of edit counts, pushes or pull requests.
line(ids.offPlan, 2, { kind: 'session-named', harness: 'codex', title: 'Review the session window' });
line(ids.offPlan, 1, { kind: 'file-edited', harness: 'codex', files: ['src/example.ts'] });
line(ids.pusher, 3, { kind: 'session-started' });
line(ids.pusher, 2, { kind: 'session-named', title: 'Check the build output' });
line(ids.pusher, 1, { kind: 'command-run', command: 'pnpm test' });
line(ids.belowLine, 3, { kind: 'session-started' });
line(ids.belowLine, 2, { kind: 'session-named', title: 'Read the library notes' });
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

await withCapture({ folder: here, dist: path.join(here, 'dist/production') }, async ({ browser, origin, out, settle }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  page.setDefaultTimeout(15_000);
  const errors = [], warnings = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'warning') warnings.push(message.text());
    if (message.type() === 'error') errors.push(message.text());
  });
  const bridge = fakeBridge({});
  await bridge.install(page);
  process.once('exit', () => console.log('Bridge methods left to the stand-in:', bridge.defaulted.join(', ') || 'none'));
  await page.addInitScript(data => {
    const copy = value => structuredClone(value);
    window.__sessionLines = copy(data.lines.lines);
    window.__libraryChanges = copy(data.changes.changes);
    window.__arcView = copy(data.arcView);
    window.__arcReads = 0;
    window.storytreeAnswers = {
      projectSelection: async () => ({ projects: data.projects, current: 'storytree' }),
      projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => ({ changes: copy(window.__libraryChanges.filter(change => change.seq > cursor)),
        cursor: window.__libraryChanges.at(-1)?.seq ?? cursor }),
      linesSince: async (_, cursor) => ({ lines: copy(window.__sessionLines.filter(item => item.seq > cursor)),
        cursor: window.__sessionLines.at(-1)?.seq ?? cursor }),
      frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [],
      arcView: async (_, id) => id === data.fixtureIds.arc ? copy(window.__arcView) : null,
      arcViews: async () => { window.__arcReads++; return [copy(window.__arcView)]; },
      windowReadings: async (_, sessions) => sessions.map(session => ({ session, at: new Date().toISOString(),
        compactions: 0, inView: [], glimpses: [], opens: session === data.fixtureIds.offPlan ? [
          { kind: 'file', id: 'src/example.ts', call: 'capture-read-a', tool: 'Read', resident: true },
          { kind: 'file', id: 'src/example.test.ts', call: 'capture-read-b', tool: 'Read', resident: false },
        ] : [] })),
      waitHolds: async () => [],
      heldOnQuestion: async (_, id) => id === data.fixtureIds.increment && window.__arcView.questions[0].fields.lifecycle === 'open'
        ? [data.fixtureIds.question] : [],
    };
  }, seed);
  await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && window.__globe && window.__nav);
  for (const name of ['Close help', 'Close app menu']) {
    const close = page.getByRole('button', { name, exact: true });
    if (await close.isVisible()) await close.click();
  }
  const list = page.getByRole('complementary', { name: 'Running sessions', exact: true });
  await list.waitFor();
  const row = session => list.locator(`.session-row[data-session-id="${session}"]`);
  await row(ids.parent).waitFor();
  const visibleIds = () => list.locator('.session-row:visible').evaluateAll(nodes => nodes.map(node => node.dataset.sessionId).sort());
  const roots = [ids.parent, ids.offPlan, ids.pusher, ids.belowLine].sort();
  assert.deepEqual(await visibleIds(), roots, 'one row per active root session, including unclaimed readers');
  assert.equal(await row(ids.ended).count(), 0, 'ended sessions are hidden');
  assert.equal(await row(ids.idle).count(), 0, 'idle sessions start folded');
  const idle = list.locator('.session-idle-fold');
  assert.equal(await idle.innerText(), '1 idle');
  assert.equal(await idle.getAttribute('aria-expanded'), 'false');
  assert.equal(await list.locator('.sessions-handle').getAttribute('aria-expanded'), 'true', 'the strip starts expanded');
  assert.equal(await list.locator('.session-detail').count(), 0, 'individual rows start collapsed');
  assert.ok((await list.locator('.session-children-toggle').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-expanded')))).every(value => value === 'false'));
  assert.match(await row(ids.parent).innerText(), /Build the running sessions list/);
  assert.doesNotMatch(await list.innerText(), /hooks not running|needs you|off plan/i);
  assert.equal(await list.locator('.session-needs-you, .session-tick').count(), 0, 'no special need state or invented context guidance');
  assert.equal(await page.locator('.unclaimed').count(), 0);
  const bounds = await list.boundingBox();
  const forestBounds = await page.locator('.forest').boundingBox();
  assert.ok(Math.abs(bounds.x - forestBounds.x) < 1 && Math.abs(bounds.width - forestBounds.width) < 1, 'strip spans the forest pane');
  assert.ok(Math.abs(bounds.y + bounds.height - forestBounds.y - forestBounds.height) < 1, 'strip sits at the bottom of the forest pane');
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
  const stateColors = await list.locator('.session-row:visible .session-label').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, color: getComputedStyle(node).color })));
  assert.equal(new Set(stateColors.map(item => item.color)).size, 1, 'row labels use the same neutral colour, including a parent with an open question');

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
  await page.mouse.move(4, 4);
  await page.screenshot({ path: path.join(out, 'sessions-list.png') });

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
  await page.screenshot({ path: path.join(out, 'sessions-list-hover.png') });
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
  await page.getByRole('button', { name: 'Forest', exact: true }).focus();
  await frames();
  assert.deepEqual(await plateState(), baseline, 'focus leaving the row restores the forest');

  await idle.click();
  assert.equal(await idle.getAttribute('aria-expanded'), 'true');
  await row(ids.idle).waitFor();
  assert.equal(await row(ids.idle).getAttribute('data-idle'), 'true');
  assert.deepEqual(await visibleIds(), [...roots, ids.idle].sort());
  await page.mouse.move(4, 4);
  await page.screenshot({ path: path.join(out, 'sessions-list-idle.png') });
  await idle.click();
  assert.equal(await row(ids.idle).count(), 0);

  const children = row(ids.parent).locator('.session-children-toggle');
  assert.equal(await children.getAttribute('aria-expanded'), 'false');
  assert.equal(await row(ids.parent).locator('.session-children').innerText(), '+2');
  await children.click();
  assert.equal(await children.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(await visibleIds(), [...roots, ids.child, ids.digest].sort(), 'one row expander opens detail and explicit children');
  assert.match(await row(ids.child).innerText(), /Capture the running sessions view/);
  assert.match(await row(ids.digest).innerText(), /Read the list contracts/);

  const unclaimed = row(ids.offPlan).locator('.session-children-toggle');
  await unclaimed.click();
  assert.equal(await unclaimed.getAttribute('aria-expanded'), 'true');
  const detail = row(ids.offPlan).locator('..').locator('.session-detail');
  await detail.getByText('src/example.ts', { exact: true }).waitFor();
  assert.equal(await detail.locator('li[data-resident="no"]').innerText(), 'src/example.test.ts');
  assert.equal(await list.locator('.session-off-plan').count(), 0, 'row detail uses window files, not the retired off-plan widget');
  await page.mouse.move(4, 4);
  await page.getByRole('button', { name: 'Forest', exact: true }).focus();
  await frames();
  await page.screenshot({ path: path.join(out, 'sessions-list-expanded.png') });

  // Exercise real two-second polling, without remounting: settle the question and end the child.
  await page.evaluate(({ child }) => {
    const question = window.__arcView.questions[0];
    question.fields.lifecycle = 'settled'; question.fields.answer = 'The list reads clearly.'; question.updatedAt = new Date().toISOString();
    window.__libraryChanges.push({ seq: window.__libraryChanges.at(-1).seq + 1, recordId: question.id, type: 'question', action: 'edited', record: structuredClone(question) });
    window.__sessionLines.push({ project: 'storytree', source: 'hook', harness: 'codex', session: child,
      seq: window.__sessionLines.at(-1).seq + 1, at: new Date().toISOString(), kind: 'session-ended', reason: 'finished' });
  }, ids);
  await page.waitForFunction(() => window.__arcReads >= 2);
  assert.doesNotMatch(await list.innerText(), /needs you/i, 'question polling does not add need prose');
  await row(ids.child).waitFor({ state: 'hidden' });
  assert.equal(await children.getAttribute('aria-expanded'), 'true', 'polling preserves the expanded parent');
  assert.equal(await row(ids.parent).locator('.session-children').innerText(), '+1');
  assert.equal(await unclaimed.getAttribute('aria-expanded'), 'true', 'polling preserves the unclaimed row detail');
  await children.click();
  assert.equal(await children.getAttribute('aria-expanded'), 'false');
  await row(ids.digest).waitFor({ state: 'hidden' });
  // The strip folds independently of each row, then restores those row choices.
  const handle = list.locator('.sessions-handle');
  await handle.click();
  assert.equal(await handle.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(await visibleIds(), []);
  assert.equal(await list.locator('.session-legend').isVisible(), true);
  await handle.click();
  assert.equal(await unclaimed.getAttribute('aria-expanded'), 'true');
  await unclaimed.click();

  // A real island pick opens a story panel; the strip makes room for that panel.
  const pick = await page.evaluate(id => {
    const { scene, camera, gl } = window.__globe;
    const point = scene.getObjectByName(`planet:${id}`).getWorldPosition(camera.position.clone()).project(camera);
    const box = gl.domElement.getBoundingClientRect();
    return { x: box.left + (point.x + 1) * box.width / 2, y: box.top + (1 - point.y) * box.height / 2 };
  }, forest.id);
  await page.mouse.click(pick.x, pick.y);
  await page.waitForFunction(() => !document.querySelector('.story-panel').hidden);
  await frames();
  assert.doesNotMatch(await page.locator('.story-panel').innerText(), /undefined/i, 'the older snapshot has current capability status words');
  const panelBounds = await page.locator('.story-panel').boundingBox();
  const besidePanel = await list.boundingBox();
  assert.ok(besidePanel.width < bounds.width && besidePanel.x + besidePanel.width <= panelBounds.x, 'the strip avoids the open story panel');
  assert.ok(Math.abs(besidePanel.x - forestBounds.x) < 1, 'the strip keeps the forest pane left edge');
  await page.mouse.move(4, 4);
  await page.screenshot({ path: path.join(out, 'sessions-list-panel.png') });
  assert.deepEqual(errors, [], 'no browser runtime or console errors');
  const renderer = await page.evaluate(() => {
    const ctx = window.__globe.gl.getContext(), debug = ctx.getExtension('WEBGL_debug_renderer_info');
    return debug && ctx.getParameter(debug.UNMASKED_RENDERER_WEBGL);
  });
  const result = { browser: await browser.version(), renderer,
    fixture: 'prior read-only library snapshot; synthetic root, nested, idle, three unclaimed and ended sessions; one open owner question; two explicit window file readings',
    bounds, besidePanel, panelBounds, rootSessions: roots, context, stateColors,
    hover: hovered.map(({ id, emphasis }) => ({ id, emphasis })), rings,
    assertions: ['root rows deduplicate claims; unclaimed sessions remain listed regardless of edit counts',
      'individual rows start collapsed; strip starts expanded', 'idle sessions start grouped and expand on request; ended sessions hidden',
      'empty context slots, unavailable totals, absent guidance marks', 'no needs-you prose or special row-label colour',
      'one row control opens files and explicit children; gone files are marked',
      'hover and focus link all claimed islands and restore materials', 'question and session-end polling refreshes',
      'polling and strip folding preserve individual row expansion', 'bottom strip spans the forest pane and avoids an open story panel'],
    errors, warnings: [...new Set(warnings)] };
  writeFileSync(path.join(out, 'capture.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
});
