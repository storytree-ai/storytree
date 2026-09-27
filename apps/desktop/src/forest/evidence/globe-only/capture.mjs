// One landing's Chromium acceptance/capture, adapted from spike/globe-land.
// The ignored dist/ holds the real page bundle, read-only seed snapshot and observation hooks.
// Run under flock /tmp/storytree-heavy.lock; see README.md for the capture recipe.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLANET_PLAYWRIGHT);
const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(path.join(here, 'dist/seed.json'), 'utf8'));
const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!['index.html', 'renderer.js', 'renderer.js.map', 'styles.css'].includes(name)) {
    res.writeHead(404).end(); return;
  }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.map') ? 'application/json' : 'text/html');
  res.end(readFileSync(path.join(here, 'dist', name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PLANET_CHROMIUM, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const errors = [], warnings = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (!['error', 'warning'].includes(message.type())) return;
    const text = message.text();
    if (message.type() === 'warning' || text.includes('Attempted to synchronously unmount a root')) warnings.push(text);
    else errors.push(text);
  });
  await page.addInitScript(data => {
    const copy = value => structuredClone(value);
    window.storytree = {
      listProjects: async () => copy(data.projects), projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
      linesSince: async (_, cursor) => cursor === 0 ? copy(data.lines) : { lines: [], cursor: data.lines.cursor },
      frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [],
    };
  }, seed);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(ids => {
    const state = window.__globe;
    if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
    return ids.every(id => {
      const plate = state.scene.getObjectByName(`planet:${id}`);
      let meshes = 0;
      plate?.traverse(mesh => { if (mesh.isMesh && mesh.geometry?.attributes.position?.count > 0) meshes++; });
      return meshes >= 2;
    });
  }, seed.tree.stories.map(s => s.id), { timeout: 180000 });
  await page.evaluate(async () => { for (let i = 0; i < 12; i++) { window.__globe.invalidate(); await new Promise(requestAnimationFrame); } });
  const result = await page.evaluate(() => {
    const { gl, scene, camera } = window.__globe;
    const ctx = gl.getContext(), debug = ctx.getExtension('WEBGL_debug_renderer_info');
    gl.info.reset(); gl.render(scene, camera);
    return {
      view: document.querySelector('.forest').dataset.view,
      choices: [...document.querySelectorAll('.forest button[data-view]')].map(b => b.textContent),
      drew: JSON.parse(document.body.dataset.drew),
      renderer: debug && ctx.getParameter(debug.UNMASKED_RENDERER_WEBGL),
      render: { ...gl.info.render }, shell: !!scene.getObjectByName('planet:shell'),
    };
  });
  result.browser = await browser.version();
  assert.equal(result.view, 'globe');
  assert.equal(result.shell, true);
  assert.equal(result.drew.surface, 'forest');
  assert.equal(result.drew.stories.length, seed.tree.stories.length);
  assert.equal(result.drew.trees.length, seed.tree.stories.reduce((n, s) => n + s.capabilities.length, 0));
  // ADR-0655 page acceptance, recorded red before removing the choices.
  assert.deepEqual(result.choices, [], 'the seeded page offers the globe alone');
  await page.screenshot({ path: path.join(here, 'seeded-globe-only.png'), timeout: 180000 });
  // Keep the existing user journey: a near-side story still opens its drill-down.
  const target = await page.evaluate(() => {
    const { scene, camera, gl } = window.__globe;
    const V = camera.position.constructor;
    const box = gl.domElement.getBoundingClientRect();
    const id = JSON.parse(document.body.dataset.drew).stories[0];
    const plate = scene.getObjectByName(`planet:${id}`);
    const at = plate.getWorldPosition(new V()).project(camera);
    return { id, x: box.left + (at.x + 1) * box.width / 2, y: box.top + (1 - at.y) * box.height / 2 };
  });
  await page.mouse.click(target.x, target.y);
  await page.waitForFunction(id => document.body.dataset.selected === id, target.id);
  await page.waitForSelector('.story-panel');
  result.selected = target.id;
  result.errors = errors;
  result.warnings = [...new Set(warnings)];
  assert.deepEqual(errors, []);
  writeFileSync(path.join(here, 'capture.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ browser: result.browser, renderer: result.renderer, stories: result.drew.stories.length,
    trees: result.drew.trees.length, choices: result.choices, selected: result.selected, errors }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
