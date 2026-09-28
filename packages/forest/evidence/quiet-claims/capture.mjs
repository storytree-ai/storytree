// Bounded Chromium acceptance for forest 5.1–5.3, using the actual desktop renderer.
// Reuses the preceding landing's read-only forest seed; all activity below is synthetic.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(path.join(here, '../../src/view/evidence/library-dots-clickable/seed.json'), 'utf8'));
const story = seed.tree.stories[0];
const capabilities = story.capabilities.slice(0, 4).map(cap => cap.id);
const now = Date.now();
const at = minutes => new Date(now - minutes * 60_000).toISOString();
const common = { project: 'storytree', source: 'tool', harness: 'claude-code', session: 'quiet-claims-supervisor-fixture' };
const lines = capabilities.slice(0, 3).map((capability, index) => ({ ...common, seq: index + 1,
  kind: 'claimed', capability, reason: 'held for the quiet-claims synthetic lane', at: at(60) }));
// A fourth holder has hook evidence, and is old enough to be idle.
lines.push({ ...common, seq: 4, session: 'quiet-claims-idle-fixture', source: 'hook', kind: 'session-started', at: at(60) });
lines.push({ ...common, seq: 5, session: 'quiet-claims-idle-fixture', kind: 'claimed', capability: capabilities[3], reason: 'synthetic idle claim', at: at(59) });
seed.lines = { lines, cursor: lines.length };

const { chromium } = await import(process.env.PLANET_PLAYWRIGHT
  ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (name === 'favicon.ico') { res.writeHead(204).end(); return; }
  if (!['index.html', 'renderer.js', 'renderer.js.map', 'styles.css', 'arc-surface.css', 'app-setup.css'].includes(name)) {
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
  const errors = [], warnings = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'warning') warnings.push(message.text());
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(data => {
    const copy = value => structuredClone(value);
    window.__claimLines = copy(data.lines.lines);
    window.storytree = {
      projectSelection: async () => ({ projects: data.projects, current: 'storytree' }),
      projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
      linesSince: async (_, cursor) => ({ lines: copy(window.__claimLines.filter(line => line.seq > cursor)), cursor: window.__claimLines.length }),
      frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [],
    };
  }, seed);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && window.__globe && window.__nav);
  // Dismiss the app's first-run guide through its ordinary control before photographing the map.
  const closeHelp = page.getByRole('button', { name: 'Close help', exact: true });
  if (await closeHelp.isVisible()) await closeHelp.click();
  await page.waitForFunction(() => document.querySelectorAll('.forest-claim, .forest-claim-dot').length === 4);
  // Turn the claimed island toward the camera, through the existing navigation rotation.
  await page.evaluate(id => {
    const { scene, camera } = window.__globe;
    scene.updateMatrixWorld(true);
    const V = camera.position.constructor, Q = camera.quaternion.constructor;
    const plate = scene.getObjectByName(`planet:${id}`);
    const normal = new V(0, 1, 0).applyQuaternion(plate.getWorldQuaternion(new Q()));
    const eye = new V(0, 0, 1).applyQuaternion(camera.quaternion);
    window.__nav.onRotate(new Q().setFromUnitVectors(normal, eye).multiply(window.__nav.rotation));
  }, story.id);
  await page.evaluate(async () => {
    for (let i = 0; i < 12; i++) { window.__globe.invalidate(); await new Promise(requestAnimationFrame); }
  });
  const dots = await page.locator('.forest-claim, .forest-claim-dot').evaluateAll(elements => elements.map(element => {
    const css = getComputedStyle(element), bounds = element.getBoundingClientRect();
    let visible = bounds.width > 0 && bounds.height > 0;
    for (let node = element; node instanceof HTMLElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      visible &&= style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
    }
    return { capability: element.dataset.capabilityId, text: element.textContent, title: element.title,
      width: bounds.width, height: bounds.height, borderRadius: css.borderRadius, background: css.backgroundColor,
      opacity: Number(css.opacity), pointerEvents: css.pointerEvents, before: getComputedStyle(element, '::before').content, visible };
  }));
  // Save the page before asserting, so the same instrument captures its red state too.
  await page.screenshot({ path: path.join(here, process.env.CAPTURE_IMAGE ?? 'quiet-claims.png') });
  assert.deepEqual(dots.map(dot => dot.capability).sort(), [...capabilities].sort(), 'one marker per claimed tree');
  for (const dot of dots) {
    assert.equal(dot.text, '', 'a quiet claim has no visible text');
    assert.ok(dot.width >= 4 && dot.width <= 10 && dot.height === dot.width, `a small round dot: ${JSON.stringify(dot)}`);
    assert.equal(dot.borderRadius, '50%');
    assert.ok(['none', 'normal', '""'].includes(dot.before), 'no extra warning glyph');
    assert.doesNotMatch(dot.title, /hooks|synthetic|lane/, 'no hidden reason or hook warning');
    assert.equal(dot.pointerEvents, 'none', 'the claim does not intercept island input');
    assert.equal(dot.visible, true, 'the dot is visible at its tree');
    assert.equal(dot.opacity, dot.capability === capabilities[3] ? 0.45 : 1, 'hookless holders stay bright past the quiet time');
  }
  assert.equal(new Set(dots.map(dot => dot.background)).size, 1, 'hookless and idle holders use the same neutral dot');
  // Real polling must remove a released dot without remounting the page.
  await page.evaluate(capability => {
    const first = window.__claimLines[0];
    window.__claimLines.push({ ...first, seq: window.__claimLines.length + 1, at: new Date().toISOString(), kind: 'released', capability });
  }, capabilities[0]);
  await page.waitForFunction(() => document.querySelectorAll('.forest-claim, .forest-claim-dot').length === 3);
  assert.deepEqual(errors, []);
  const renderer = await page.evaluate(() => {
    const ctx = window.__globe.gl.getContext(), debug = ctx.getExtension('WEBGL_debug_renderer_info');
    return debug && ctx.getParameter(debug.UNMASKED_RENDERER_WEBGL);
  });
  const result = { browser: await browser.version(), renderer, fixture: 'read-only prior library snapshot; three synthetic hookless claims and one synthetic hooked idle claim',
    story: story.id, dots, releaseObserved: true, errors, warnings: [...new Set(warnings)] };
  writeFileSync(path.join(here, 'capture.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
