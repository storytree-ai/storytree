// Bounded browser acceptance for session wisps (ADR-0736): the real desktop page, built by
// ../sessions-list/build.mjs, over a prior read-only forest snapshot with synthetic sessions.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureOutput, fakeBridge } from '../../../../apps/desktop/src/capture/index.ts'; // the shared stand-in bridge: run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const out = captureOutput(here); // pictures and measurements: a scratch folder unless run with --retake
const built = path.join(here, '../sessions-list/dist/production');
const seed = JSON.parse(readFileSync(path.join(here, '../../src/view/evidence/library-dots-clickable/seed.json'), 'utf8'));
const story = title => seed.tree.stories.find(item => item.title === title);
const forest = story('The forest'), app = story('The app'), librarian = story('The librarian'), cli = story('The command line');
const ids = { a: 'wisps-builder', b: 'wisps-reviewer', idle: 'wisps-quiet', child: 'wisps-lane', ended: 'wisps-ended' };
const now = Date.now();
const at = minutes => new Date(now - minutes * 60_000).toISOString();
const lines = [];
function line(session, minutes, fields) {
  lines.push({ project: 'storytree', source: 'hook', harness: 'claude-code', session, seq: lines.length + 1, at: at(minutes), ...fields });
}
const claim = (session, minutes, capability, reason) => line(session, minutes, { kind: 'claimed', source: 'tool', capability, reason });
line(ids.a, 6, { kind: 'session-started' });
claim(ids.a, 5, forest.capabilities[0].id, 'Bring wisps to the forest');
claim(ids.a, 5, app.capabilities[0].id, 'Bring wisps to the forest');
line(ids.a, 4, { kind: 'subagent-started', subagent: ids.child, type: 'worker', task: 'Tidy the command line' });
line(ids.child, 4, { kind: 'session-started' });
claim(ids.child, 3, cli.capabilities[0].id, 'Tidy the command line');
line(ids.b, 5, { kind: 'session-started', harness: 'codex' });
claim(ids.b, 2, forest.capabilities[1].id, 'Review the forest');
line(ids.idle, 61, { kind: 'session-started' });
claim(ids.idle, 60, librarian.capabilities[0].id, 'Check the library links');
line(ids.ended, 9, { kind: 'session-started' });
claim(ids.ended, 8, librarian.capabilities[1].id, 'Finished work');
line(ids.ended, 7, { kind: 'session-ended', reason: 'finished' });
seed.lines = { lines, cursor: lines.length };
seed.tree.arcs = [];

const { chromium } = await import(process.env.PLANET_PLAYWRIGHT
  ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!['index.html', 'renderer.js', 'styles.css', 'arc-surface.css', 'app-setup.css', 'forest.css'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(readFileSync(path.join(built, name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PLANET_CHROMIUM
    ?? '/home/mickh/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell', headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const bridge = fakeBridge({});
  await bridge.install(page);
  process.once('exit', () => console.log('Bridge methods left to the stand-in:', bridge.defaulted.join(', ') || 'none'));
  await page.addInitScript(data => {
    const copy = value => structuredClone(value);
    window.storytreeAnswers = {
      projectSelection: async () => ({ projects: data.projects, current: 'storytree' }),
      projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => ({ changes: copy(data.changes.changes.filter(change => change.seq > cursor)), cursor: data.changes.changes.at(-1)?.seq ?? cursor }),
      linesSince: async (_, cursor) => ({ lines: copy(data.lines.lines.filter(item => item.seq > cursor)), cursor: data.lines.lines.at(-1)?.seq ?? cursor }),
      frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [],
      arcView: async () => null, waitHolds: async () => [], heldOnQuestion: async () => [],
    };
  }, seed);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && window.__globe && window.__nav);
  const closeHelp = page.getByRole('button', { name: 'Close help', exact: true });
  if (await closeHelp.isVisible()) await closeHelp.click();
  const list = page.getByRole('complementary', { name: 'Running sessions', exact: true });
  const row = session => list.locator(`.session-row[data-session-id="${session}"]`);
  await row(ids.a).waitFor();
  const frames = async () => page.evaluate(async () => {
    for (let i = 0; i < 8; i++) { window.__globe.invalidate(); await new Promise(requestAnimationFrame); }
  });
  const wisps = () => page.evaluate(() => {
    const found = [], box = window.__globe.gl.domElement.getBoundingClientRect();
    window.__globe.scene.traverse(object => {
      if (object.userData.sessionWisp === undefined || !object.isGroup) return;
      const body = object.children[0], plate = object.parent;
      const core = body.getObjectByName('WispCore'), shell = body.getObjectByName('WispShell');
      if (!core || !shell) return;
      const screen = object.getWorldPosition(body.position.clone()).project(window.__globe.camera);
      found.push({ session: object.userData.sessionWisp, story: plate.name.slice('planet:'.length) || plate.parent?.name.slice('planet:'.length),
        colour: shell.material.color.getHexString(), opacity: core.material.opacity, shellOpacity: shell.material.opacity, scale: body.scale.x,
        geometry: { core: core.geometry.uuid, shell: shell.geometry.uuid },
        x: box.left + (screen.x + 1) * box.width / 2, y: box.top + (1 - screen.y) * box.height / 2, front: screen.z < 1 });
    });
    return found.sort((a, b) => (a.session + a.story).localeCompare(b.session + b.story));
  });
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name === 'WispShell') n++; }); return n > 0; });

  // Turn the forest island toward the camera with the production navigation's own setter.
  const face = id => page.evaluate(id => {
    const { scene, camera } = window.__globe;
    scene.updateMatrixWorld(true);
    const V = camera.position.constructor, Q = camera.quaternion.constructor;
    const plate = scene.getObjectByName(`planet:${id}`);
    const normal = new V(0, 1, 0).applyQuaternion(plate.getWorldQuaternion(new Q()));
    const eye = new V(0, 0, 1).applyQuaternion(camera.quaternion);
    window.__nav.onRotate(new Q().setFromUnitVectors(normal, eye).multiply(window.__nav.rotation));
  }, id);
  await face(forest.id);
  await frames();
  const drawn = await wisps();
  assert.equal(new Set(drawn.map(wisp => wisp.geometry.core)).size, 1, 'sessions share one core geometry');
  assert.equal(new Set(drawn.map(wisp => wisp.geometry.shell)).size, 1, 'sessions share one shell geometry');
  const summary = drawn.map(({ session, story }) => `${session}@${seed.tree.stories.find(item => item.id === story)?.title}`);
  assert.deepEqual(summary.sort(), [`${ids.a}@The app`, `${ids.a}@The command line`, `${ids.a}@The forest`, `${ids.b}@The forest`, `${ids.idle}@The librarian`].sort(),
    'one wisp per listed session and island; the folded lane orbits only through its parent; the ended session has none');
  const swatch = session => row(session).locator('.session-colour').evaluate(node => getComputedStyle(node).backgroundColor);
  for (const wisp of drawn) {
    const rgb = (await swatch(wisp.session)).match(/\d+/g).slice(0, 3).map(Number);
    const hex = rgb.map(channel => channel.toString(16).padStart(2, '0')).join('');
    const near = [0, 2, 4].every(i => Math.abs(parseInt(hex.slice(i, i + 2), 16) - parseInt(wisp.colour.slice(i, i + 2), 16)) <= 3);
    assert.ok(near, `${wisp.session}'s wisp ${wisp.colour} matches its row ${hex}`);
  }
  assert.ok(drawn.find(wisp => wisp.session === ids.idle).opacity < 1, 'a quiet holder with hooks fades');
  assert.ok(drawn.find(wisp => wisp.session === ids.idle).shellOpacity < drawn.find(wisp => wisp.session === ids.a).shellOpacity,
    'the shell fades with the core');
  await frames();
  assert.deepEqual((await wisps()).map(({ x, y }) => [x, y]), drawn.map(({ x, y }) => [x, y]), 'reduced motion holds every phase still');
  assert.equal(await page.locator('.forest-claim-dot').count(), 0, 'the claim dots are gone');
  await page.screenshot({ path: path.join(out, 'wisps-globe.png') });

  // Hover a row: its wisps swell and its islands light.
  await row(ids.a).hover();
  await frames();
  assert.ok((await wisps()).filter(wisp => wisp.session === ids.a).every(wisp => wisp.scale > 1.5), 'hovering a row swells its wisps');
  assert.ok((await wisps()).filter(wisp => wisp.session !== ids.a).every(wisp => wisp.scale < 1.5));
  await page.screenshot({ path: path.join(out, 'wisps-globe-row-hover.png') });
  await page.mouse.move(1400, 930);
  await frames();

  // Hover a wisp: its row highlights.
  const target = (await wisps()).find(wisp => wisp.session === ids.b && wisp.front);
  await page.mouse.move(target.x, target.y);
  await frames();
  await page.waitForFunction(id => document.querySelector(`.session-row[data-session-id="${id}"]`)?.dataset.highlighted === 'true', ids.b);
  assert.equal(await row(ids.a).getAttribute('data-highlighted'), null);
  await page.screenshot({ path: path.join(out, 'wisps-globe-wisp-hover.png') });
  await page.mouse.move(1400, 930);
  await frames();
  await page.waitForFunction(id => document.querySelector(`.session-row[data-session-id="${id}"]`)?.dataset.highlighted === undefined, ids.b);

  // Close to the ground: zoom the camera in on the forest plate, where the plate reads as flat land.
  await page.evaluate(() => { window.__globe.camera.zoom *= 3.2; window.__globe.camera.updateProjectionMatrix(); });
  await row(ids.a).hover();
  await frames();
  await page.screenshot({ path: path.join(out, 'wisps-ground-row-hover.png') });
  await page.mouse.move(1400, 930);

  // With motion allowed, the wisps orbit.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const before = (await wisps()).map(({ x, y }) => [x, y]);
  await frames();
  await page.waitForTimeout(600);
  await frames();
  const after = (await wisps()).map(({ x, y }) => [x, y]);
  assert.ok(before.some(([x, y], i) => Math.hypot(x - after[i][0], y - after[i][1]) > 1), 'wisps orbit when motion is allowed');

  // Inspect the same production model from an oblique angle, with the camera centred on it.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await frames();
  await page.evaluate(session => {
    const { scene, camera, controls } = window.__globe;
    let wisp;
    scene.traverse(object => { if (object.isGroup && object.userData.sessionWisp === session) wisp ??= object; });
    const V = camera.position.constructor, Q = camera.quaternion.constructor;
    const centre = wisp.getWorldPosition(new V());
    const offset = new V(5, 6, 10).normalize().applyQuaternion(wisp.getWorldQuaternion(new Q()));
    const distance = camera.position.distanceTo(controls.target);
    camera.position.copy(centre).addScaledVector(offset, distance);
    controls.target.copy(centre);
    camera.zoom *= 6;
    camera.lookAt(centre);
    camera.updateProjectionMatrix();
    controls.update();
  }, ids.b);
  await frames();
  await page.screenshot({ path: path.join(out, 'wisps-model-closeup.png') });
  assert.deepEqual(errors, [], 'no browser runtime or console errors');
  const renderer = await page.evaluate(() => {
    const ctx = window.__globe.gl.getContext(), debug = ctx.getExtension('WEBGL_debug_renderer_info');
    return debug && ctx.getParameter(debug.UNMASKED_RENDERER_WEBGL);
  });
  const result = { browser: await browser.version(), renderer, wisps: drawn.map(({ x, y, geometry, ...wisp }) => wisp), errors,
    assertions: ['one wisp per listed session and island', 'folded lane and ended session draw none', 'wisp colour equals row colour',
      'all wisps share one core and shell geometry', 'quiet holder fades on both model layers', 'claim dots gone', 'row hover swells its wisps', 'wisp hover highlights its row and leaving clears it',
      'reduced motion holds wisps still; otherwise they orbit'] };
  writeFileSync(path.join(out, 'capture.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
