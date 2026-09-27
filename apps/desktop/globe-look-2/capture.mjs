// Borrowed from spike/planet-look; bundles and captures the actual desktop page, as lane D did.
// Run the entire process under flock /tmp/storytree-heavy.lock.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLANET_PLAYWRIGHT ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const out = path.join(root, 'docs/research/globe-look-2');
const seed = JSON.parse(readFileSync(path.join(here, 'dist/seed.json'), 'utf8'));
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const match = /^\/(0-today|1-middle|2-fit|3-sea|4-together)\/(index.html|renderer.js|renderer.js.map|styles.css)$/.exec(pathname);
  if (!match) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.map') ? 'application/json' : 'text/html');
  res.end(readFileSync(path.join(here, 'dist', match[1], match[2])));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  executablePath: process.env.PLANET_CHROMIUM ?? '/home/mickh/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell',
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

function synthetic() {
  const copy = structuredClone(seed);
  copy.projects = ['Synthetic · 36 stories'];
  copy.tree.arcs = [];
  copy.changes = { changes: [], cursor: 0 };
  copy.lines = { lines: [], cursor: 0 };
  copy.covers = {};
  copy.tree.stories = Array.from({ length: 36 }, (_, i) => {
    const story = structuredClone(seed.tree.stories[i % seed.tree.stories.length]);
    const ids = new Map();
    ids.set(story.id, `synthetic-story-${i + 1}`);
    for (const [j, cap] of story.capabilities.entries()) {
      ids.set(cap.id, `synthetic-${i + 1}-cap-${j + 1}`);
      for (const [k, contract] of cap.contracts.entries()) ids.set(contract.id, `synthetic-${i + 1}-cap-${j + 1}-contract-${k + 1}`);
    }
    const remap = value => {
      if (typeof value === 'string') return ids.get(value) ?? value;
      if (Array.isArray(value)) return value.map(remap);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v)]));
      return value;
    };
    const made = remap(story);
    made.title = `Story ${String(i + 1).padStart(2, '0')}`;
    for (const cap of made.capabilities) {
      cap.dependsOn = cap.dependsOn.filter(id => [...ids.values()].includes(id));
      if (i % 4 !== 0) {
        cap.health.reported = { state: 'passing' };
        for (const contract of cap.contracts) contract.health.reported = { state: 'passing' };
        copy.lines.lines.push({ kind: 'landed', capability: cap.id, at: '2026-09-27T00:00:00.000Z' });
      }
    }
    return made;
  });
  copy.lines.cursor = copy.lines.lines.length;
  return copy;
}

function failures() {
  const copy = structuredClone(seed);
  for (const i of [0, 1]) {
    const cap = copy.tree.stories[i].capabilities[0];
    cap.health.reported = { state: 'failing' };
    cap.contracts[0].health.reported = { state: 'failing' };
    copy.lines.lines.push({ kind: 'landed', capability: cap.id, at: '2026-09-27T00:00:00.000Z' });
  }
  copy.lines.cursor = copy.lines.lines.length;
  return copy;
}

async function settle(page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 12; i++) {
      window.__globe.invalidate();
      await new Promise(requestAnimationFrame);
    }
  });
}

async function measure(page) {
  return page.evaluate(() => {
    const { scene, camera, gl, size } = window.__globe;
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const V = camera.position.constructor;
    const Q = camera.quaternion.constructor;
    const eye = new V(0, 0, 1).applyQuaternion(camera.quaternion);
    const plates = [];
    scene.traverse(object => {
      if (!object.name.startsWith('planet:') || object.name === 'planet:sea') return;
      const normal = new V(0, 1, 0).applyQuaternion(object.getWorldQuaternion(new Q()));
      const at = object.getWorldPosition(new V()).project(camera).toArray();
      let vertices = 0, meshes = 0;
      object.traverse(mesh => { if (mesh.isMesh && mesh.geometry?.attributes.position) { meshes++; vertices += mesh.geometry.attributes.position.count; } });
      plates.push({ story: object.name.slice(7), facing: normal.dot(eye), at, meshes, vertices });
    });
    const labels = [...document.querySelectorAll('.forest-label')].map(el => ({
      text: el.textContent, visible: el.checkVisibility(), bounds: el.getBoundingClientRect().toJSON(),
    }));
    const markers = [...document.querySelectorAll('.planet-edge-marker')].map(el => {
      const r = el.getBoundingClientRect();
      return { story: el.dataset.failingStory, visible: el.checkVisibility(), bounds: r.toJSON(),
        withinViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
    });
    const context = gl.getContext();
    const debug = context.getExtension('WEBGL_debug_renderer_info');
    return { renderer: debug && context.getParameter(debug.UNMASKED_RENDERER_WEBGL), zoom: camera.zoom, canvas: size,
      plates, labels, markers, drew: JSON.parse(document.body.dataset.drew), sphereRadiusPixels: 390 * camera.zoom,
      view: document.querySelector('.forest').dataset.view };
  });
}

const cases = [
  ['0-today', '0-today', seed], ['1-middle', '1-middle', seed], ['2-fit', '2-fit', seed],
  ['3-sea', '3-sea', seed], ['4-together', '4-together', seed],
  ['4-together-36-stories', '4-together', synthetic()], ['diagnostic-failures', '4-together', failures()],
];
const requested = process.argv.slice(2);
try {
  for (const [name, variant, input] of cases.filter(([name]) => !requested.length || requested.includes(name))) {
    console.log(`Rendering ${name}`);
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const errors = [], warnings = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => {
      if (message.type() !== 'error' && message.type() !== 'warning') return;
      const text = message.text();
      if (text.includes('Attempted to synchronously unmount a root')) warnings.push(text);
      else if (message.type() === 'error') errors.push(text);
      else warnings.push(text);
    });
    await page.addInitScript(data => {
      const copy = value => structuredClone(value);
      window.storytree = {
        listProjects: async () => copy(data.projects), projectTree: async () => copy(data.tree),
        changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
        linesSince: async (_, cursor) => cursor === 0 ? copy(data.lines) : { lines: [], cursor: data.lines.cursor },
        frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [],
      };
    }, input);
    await page.goto(`http://127.0.0.1:${server.address().port}/${variant}/index.html`, { timeout: 120000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(count => {
      const state = window.__globe;
      if (document.body.dataset.state !== 'ready' || !state) return false;
      let plates = 0, ready = 0;
      state.scene.traverse(object => {
        if (!object.name.startsWith('planet:') || object.name === 'planet:sea') return;
        plates++;
        let meshes = 0;
        object.traverse(mesh => { if (mesh.isMesh && mesh.geometry?.attributes.position?.count > 0) meshes++; });
        if (meshes >= 2) ready++;
      });
      return plates === count && ready === count;
    }, input.tree.stories.length, { timeout: 180000 });
    await settle(page);
    if (errors.length) throw new Error(`${name}: ${errors.join('\n')}`);
    const result = await measure(page);
    result.browser = await browser.version(); result.errors = errors; result.warnings = [...new Set(warnings)];
    if (result.plates.length !== input.tree.stories.length) throw new Error('Missing plates');
    if (result.drew.stories.length !== input.tree.stories.length) throw new Error('Smoke readout missing stories');
    if (name.startsWith('diagnostic')) {
      if (result.plates[0].facing < 0.9999) throw new Error('First failure did not win the opening turn');
      const marker = page.locator(`[data-failing-story="${input.tree.stories[1].id}"]`);
      if (!result.markers.some(m => m.story === input.tree.stories[1].id && m.visible && m.withinViewport)) throw new Error('Hidden failure marker clipped or absent');
      await marker.click(); await settle(page);
      const after = await measure(page);
      if (after.plates[1].facing < 0.9999) throw new Error('Failure marker did not turn its island to the front');
      result.afterMarker = after;
    } else {
      await page.screenshot({ path: path.join(out, `${name}.png`) });
    }
    writeFileSync(path.join(out, `${name}.json`), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ name, zoom: result.zoom, front: result.plates.filter(p => p.facing > 0).length, stories: result.plates.length, trees: result.drew.trees.length, errors, warnings: result.warnings }));
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
