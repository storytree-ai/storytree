// Seeded, repeatable capture of the actual desktop page: same seed (the knowledge-under-islands
// snapshot, so the pictures compare with its production-*.png), same 1440 x 960 viewport, same
// programmatic turns; nothing is hand-panned. Run under flock /tmp/storytree-heavy.lock after
// `node build.mjs`. Measures what can be counted before anyone looks, and writes measurements.json.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLANET_PLAYWRIGHT
  ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(path.join(here, '../knowledge-under-islands/seed.json'), 'utf8'));
const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (name === 'favicon.ico') { res.writeHead(204).end(); return; }
  if (!['index.html', 'renderer.js', 'renderer.js.map', 'styles.css', 'arc-surface.css', 'app-setup.css', 'forest.css'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.map') ? 'application/json' : 'text/html');
  res.end(readFileSync(path.join(here, 'dist', name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

const settle = page => page.evaluate(async () => { for (let i = 0; i < 12; i++) { window.__globe.invalidate(); await new Promise(requestAnimationFrame); } });

function measure(page) {
  return page.evaluate(() => {
    const { scene, camera, gl, size } = window.__globe;
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const V = camera.position.constructor;
    const plates = [];
    let pines = 0, otherObjects = 0;
    scene.traverse(object => {
      if (!object.name.startsWith('planet:story_')) return;
      const kinds = {}, ground = [];
      let triangles = 0, worstSphereGap = 0;
      const seenNames = new Set();
      object.traverse(child => {
        if (child === object) return;
        const kind = child.name.split(':')[0] || child.type;
        if (child.isMesh) {
          kinds[kind] = (kinds[kind] ?? 0) + 1;
          if (child.name === 'island-ground') {
            triangles += child.geometry.index.count / 3;
            ground.push({ opacity: child.material.opacity, transparent: child.material.transparent, depthWrite: child.material.depthWrite, colour: child.material.color.getHexString(), vertexColors: child.material.vertexColors });
          }
          if (child.name === 'island-ground' || child.name.startsWith('island-coast')) {
            const at = child.geometry.attributes.position, centre = new V(0, -(object.position.length()), 0);
            for (let i = 0; i < at.count; i++) worstSphereGap = Math.max(worstSphereGap, Math.abs(new V().fromBufferAttribute(at, i).distanceTo(centre) - object.position.length()));
          }
          if (!child.name.startsWith('island-')) otherObjects++;
        }
        if (/pine|prop|kit|tree|plant/i.test(child.name)) pines++;
      });
      plates.push({ story: object.name.slice(7), facing: new V(0, 1, 0).applyQuaternion(object.getWorldQuaternion(camera.quaternion.clone())).dot(new V(0, 0, 1).applyQuaternion(camera.quaternion)),
        drawn: kinds, triangles, ground, worstSphereGap });
    });
    const canvas = gl.domElement.getBoundingClientRect();
    gl.info.reset(); gl.render(scene, camera);
    const ctx = gl.getContext(), debug = ctx.getExtension('WEBGL_debug_renderer_info');
    return { renderer: debug && ctx.getParameter(debug.UNMASKED_RENDERER_WEBGL), zoom: camera.zoom, canvas: { w: canvas.width, h: canvas.height, size },
      plates, pinesOrProps: pines, nonIslandMeshesOnPlates: otherObjects, render: { ...gl.info.render },
      shell: !!scene.getObjectByName('planet:shell'), drew: JSON.parse(document.body.dataset.drew) };
  });
}

let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.PLANET_CHROMIUM ?? '/home/mickh/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell',
    headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const errors = [], warnings = [], failed = [];
  page.on('response', r => { if (r.status() >= 400) failed.push(r.url()); });
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (!['error', 'warning'].includes(message.type())) return;
    (message.type() === 'warning' ? warnings : errors).push(message.text());
  });
  await page.addInitScript(data => {
    const copy = value => structuredClone(value);
    let current = data.projects.includes('storytree') ? 'storytree' : data.projects[0];
    window.storytree = {
      projectSelection: async () => copy({ projects: data.projects, current }),
      chooseProject: async name => { current = name; return copy({ projects: data.projects, current }); },
      listProjects: async () => copy(data.projects), projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
      linesSince: async (_, cursor) => cursor === 0 ? copy(data.lines) : { lines: [], cursor: data.lines.cursor },
      frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [], readSurfaces: async () => undefined,
    };
  }, seed);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(ids => {
    const state = window.__globe;
    if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
    return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
  }, seed.tree.stories.map(s => s.id), { timeout: 60000 }).catch(async error => {
    console.error(JSON.stringify({ state: await page.evaluate(() => document.body.dataset.state + ' | ' + (document.querySelector('.empty')?.innerText ?? '')), errors, urls: failed, warnings: warnings.slice(0, 5) }));
    throw error;
  });
  // The seeded stand-in bridge leaves the app menu popover open on load; close it so the globe is unobscured.
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  await settle(page);
  const results = {};
  const turn = async radians => {
    await page.evaluate(radians => {
      const { camera } = window.__globe, { rotation, onRotate } = window.__nav;
      const Q = camera.quaternion.constructor, V = camera.position.constructor;
      const t = new Q().setFromAxisAngle(new V(0, 1, 0), radians);
      onRotate(camera.quaternion.clone().multiply(t).multiply(camera.quaternion.clone().invert()).multiply(rotation));
    }, radians);
    await settle(page);
  };
  results.front = await measure(page);
  await page.screenshot({ path: path.join(here, 'front.png'), timeout: 180000 });
  // Close-up: the same page, camera zoom x3 (Framing sets the resting zoom; nothing is panned).
  await page.evaluate(() => { const { camera, invalidate } = window.__globe; camera.zoom *= 2.6; camera.updateProjectionMatrix(); invalidate(); });
  await settle(page);
  results.closeUp = await measure(page);
  await page.screenshot({ path: path.join(here, 'close-up.png'), timeout: 180000 });
  await page.evaluate(() => { const { camera, invalidate } = window.__globe; camera.zoom /= 2.6; camera.updateProjectionMatrix(); invalidate(); });
  await turn(Math.PI / 2);
  results.quarterTurn = await measure(page);
  await page.screenshot({ path: path.join(here, 'quarter-turn.png'), timeout: 180000 });
  await turn(-Math.PI / 2);
  // Clicking the surface still picks the story (panel opens).
  const target = await page.evaluate(() => {
    const { scene, camera, gl } = window.__globe;
    const id = JSON.parse(document.body.dataset.drew).stories[0];
    const at = scene.getObjectByName(`planet:${id}`).getWorldPosition(camera.position.clone()).project(camera);
    const box = gl.domElement.getBoundingClientRect();
    return { id, x: box.left + (at.x + 1) * box.width / 2, y: box.top + (1 - at.y) * box.height / 2 };
  });
  await page.mouse.click(target.x, target.y);
  await page.waitForFunction(id => document.body.dataset.selected === id, target.id, { timeout: 10000 });
  results.pickedStory = target.id;
  for (const [view, r] of Object.entries(results)) {
    if (view === 'pickedStory') continue;
    assert.equal(r.pinesOrProps, 0, `${view}: no pine or prop objects`);
    assert.equal(r.nonIslandMeshesOnPlates, 0, `${view}: plates hold only the surface and its coast`);
    assert.equal(r.plates.length, seed.stats.stories);
    for (const p of r.plates) {
      assert.equal(p.drawn['island-ground'], 1, `${p.story} has one ground surface`);
      assert.ok(p.worstSphereGap < 1e-3, `${p.story} lies on the globe (gap ${p.worstSphereGap})`);
      assert.deepEqual(p.ground.map(g => [g.transparent, g.depthWrite, g.vertexColors]), [[true, false, false]]);
    }
  }
  assert.deepEqual(errors, []);
  results.browser = await browser.version(); results.errors = errors; results.warnings = [...new Set(warnings)];
  results.seed = seed.stats;
  writeFileSync(path.join(here, 'measurements.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({ browser: results.browser, renderer: results.front.renderer, stories: results.front.plates.length,
    pines: results.front.pinesOrProps, triangles: results.front.plates.map(p => p.triangles), draws: results.front.render.calls, errors }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
