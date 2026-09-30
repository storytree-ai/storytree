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
// survey.json is readCodeSurvey(<this checkout>, seed.tree), precomputed by `tsx survey.mjs`.
const survey = JSON.parse(readFileSync(path.join(here, 'survey.json'), 'utf8'));
const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (name === 'favicon.ico') { res.writeHead(204).end(); return; }
  if (!['index.html', 'renderer.js', 'renderer.js.map', 'styles.css', 'arc-surface.css', 'app-setup.css', 'forest.css'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.map') ? 'application/json' : 'text/html');
  res.end(readFileSync(path.join(here, 'dist', name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

const settle = page => page.evaluate(async () => { for (let i = 0; i < 12; i++) { window.__globe.invalidate(); await new Promise(requestAnimationFrame); } });


/** Per island: its circles against the surveyed files, whether each circle's middle lies inside its own territory, radii in ground units, overlap and coverage. */
function measure(page) {
  return page.evaluate(() => {
    const { scene, camera } = window.__globe;
    scene.updateMatrixWorld(true);
    const V = camera.position.constructor;
    const islands = [];
    scene.traverse(object => {
      if (!object.name.startsWith('planet:story_')) return;
      const local = new V();
      const ground = [], territories = new Map(), circles = [];
      object.traverse(child => {
        if (child.name === 'island-ground') ground.push(child);
        if (child.name.startsWith('territory:')) territories.set(child.name.slice(10), child);
        if (child.name.startsWith('file:')) circles.push(child);
      });
      const xz = (mesh, i) => { const at = mesh.geometry.attributes.position; local.fromBufferAttribute(at, i).applyMatrix4(mesh.matrixWorld); object.worldToLocal(local); return [local.x, local.z]; };
      const trianglesOf = mesh => {
        const out = [], index = mesh.geometry.index, n = index ? index.count : mesh.geometry.attributes.position.count;
        for (let t = 0; t < n; t += 3) out.push([0, 1, 2].map(k => xz(mesh, index ? index.getX(t + k) : t + k)));
        return out;
      };
      const inside = ([px, pz], triangles) => triangles.some(([a, b, c]) => {
        const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
        if (d === 0) return false;
        const u = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (pz - c[1])) / d;
        const v = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (pz - c[1])) / d;
        return u >= -1e-6 && v >= -1e-6 && 1 - u - v >= -1e-6;
      });
      let groundArea = 0;
      for (const mesh of ground) for (const [a, b, c] of trianglesOf(mesh)) groundArea += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
      const territoryTriangles = new Map([...territories].map(([id, mesh]) => [id, trianglesOf(mesh)]));
      const worldScale = object.getWorldScale(new V()).x;
      const items = circles.map(c => {
        const p = c.getWorldPosition(new V()); object.worldToLocal(p);
        const own = territoryTriangles.get(c.userData.capability ?? 'unclaimed');
        return { file: c.userData.file, lines: c.userData.lines, capability: c.userData.capability ?? null, x: p.x, z: p.z,
          radius: c.getWorldScale(new V()).x / worldScale, ownTerritoryExists: own !== undefined, middleInsideOwn: own !== undefined && inside([p.x, p.z], own),
          middleOnGround: ground.some(g => inside([p.x, p.z], trianglesOf(g))) };
      });
      let overlaps = 0;
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++)
        if (Math.hypot(items[i].x - items[j].x, items[i].z - items[j].z) < items[i].radius + items[j].radius) overlaps++;
      const radii = items.map(i => i.radius);
      const area = items.reduce((s, i) => s + Math.PI * i.radius * i.radius, 0);
      islands.push({ story: object.name.slice(7), circles: items.length, groupPresent: !!object.getObjectByName('file-circles'),
        middlesInsideOwnTerritory: items.filter(i => i.middleInsideOwn).length, middlesOnGround: items.filter(i => i.middleOnGround).length,
        outsideOwnTerritory: items.filter(i => !i.middleInsideOwn).map(i => ({ file: i.file, capability: i.capability, ownTerritoryExists: i.ownTerritoryExists })),
        minRadius: Math.min(...radii), maxRadius: Math.max(...radii), overlappingPairs: overlaps, circleAreaOverGround: area / groundArea, groundArea, islandWorldScale: worldScale,
        largestOnIsland: items.filter(i => i.middleInsideOwn).sort((a, b) => b.lines - a.lines).slice(0, 5).map(i => ({ file: i.file, lines: i.lines, radius: i.radius })),
        largest: [...items].sort((a, b) => b.lines - a.lines).slice(0, 5).map(i => ({ file: i.file, lines: i.lines, radius: i.radius })) });
    });
    return { zoom: camera.zoom, islands };
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
  await page.addInitScript(({ data, survey }) => {
    const copy = value => structuredClone(value);
    let current = data.projects.includes('storytree') ? 'storytree' : data.projects[0];
    window.storytree = {
      projectSelection: async () => copy({ projects: data.projects, current }),
      chooseProject: async name => { current = name; return copy({ projects: data.projects, current }); },
      listProjects: async () => copy(data.projects), projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
      linesSince: async (_, cursor) => cursor === 0 ? copy(data.lines) : { lines: [], cursor: data.lines.cursor },
      frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [], readSurfaces: async () => undefined,
      codeSurvey: async () => copy(survey),
    };
  }, { data: seed, survey });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(ids => {
    const state = window.__globe;
    if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
    return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
  }, seed.tree.stories.map(s => s.id), { timeout: 60000 }).catch(async error => {
    console.error(JSON.stringify({ state: await page.evaluate(() => document.body.dataset.state + ' | ' + (document.querySelector('.empty')?.innerText ?? '')), errors, urls: failed, warnings: warnings.slice(0, 5) }));
    throw error;
  });
  // Territories and circles arrive with the survey, a beat after the ground: wait until they are drawn.
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('file:')) n++; }); return n > 0; }, undefined, { timeout: 30000 });
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  await settle(page);
  const results = {};
  results.front = await measure(page);
  results.surveyedFiles = Object.fromEntries(Object.entries(survey).map(([id, v]) => [id, v.files.length]));
  await page.screenshot({ path: path.join(here, 'front.png'), timeout: 180000 });

  const AGENT_LINK = 'story_05e45963ca9f';
  const faceIt = async story => {
    await page.evaluate(id => {
      const { scene, camera } = window.__globe, { rotation, onRotate } = window.__nav;
      const V = camera.position.constructor;
      const at = scene.getObjectByName(`planet:${id}`).getWorldPosition(new V()).normalize();
      const eye = camera.position.clone().normalize();
      const Q = camera.quaternion.constructor;
      onRotate(new Q().setFromUnitVectors(at, eye).multiply(rotation));
    }, story);
    await settle(page);
  };
  await faceIt(AGENT_LINK);
  await page.evaluate(() => { const { camera, invalidate } = window.__globe; camera.zoom *= 2.6; camera.updateProjectionMatrix(); invalidate(); });
  await settle(page);
  results.closeUp = await measure(page);
  await page.screenshot({ path: path.join(here, 'close-up.png'), timeout: 180000 });

  // Hover: the largest circles of The agent link, in order, until one is actually pointed at (nearer marks may cover a middle).
  const screenOf = (story, file) => page.evaluate(({ story, file }) => {
    const { scene, camera, gl } = window.__globe;
    scene.updateMatrixWorld(true);
    const V = camera.position.constructor;
    const p = scene.getObjectByName(`planet:${story}`).getObjectByName(`file:${file}`).getWorldPosition(new V()).project(camera);
    const box = gl.domElement.getBoundingClientRect();
    return { x: box.left + (p.x + 1) * box.width / 2, y: box.top + (1 - p.y) * box.height / 2 };
  }, { story, file });
  const agent = results.closeUp.islands.find(i => i.story === AGENT_LINK);
  results.hover = {};
  // Two hovers: the largest circle of the island whatever its position, and the largest one whose middle lies on its own territory.
  for (const [key, wanted, shot] of [['largest', agent.largest, 'hover'], ['largestOnTerritory', agent.largestOnIsland, 'hover-on-territory']]) {
    results.hover[key] = { tried: [] };
    for (const candidate of wanted) {
      const at = await screenOf(AGENT_LINK, candidate.file);
      await page.mouse.move(at.x - 60, at.y - 60); await page.mouse.move(at.x, at.y, { steps: 4 });
      await settle(page);
      const label = await page.evaluate(() => document.querySelector('[role=tooltip]')?.textContent ?? null);
      results.hover[key].tried.push({ file: candidate.file, lines: candidate.lines, radius: candidate.radius, at, label });
      if (label?.startsWith(candidate.file)) { results.hover[key].chosen = results.hover[key].tried.at(-1); break; }
    }
    assert.ok(results.hover[key].chosen, `pointing at one of the ${key} circles shows its label`);
    await page.screenshot({ path: path.join(here, `${shot}.png`), timeout: 180000 });
    const around = results.hover[key].chosen.at;
    await page.screenshot({ path: path.join(here, `${shot}-crop.png`), timeout: 180000,
      clip: { x: Math.max(0, Math.min(1440 - 640, around.x - 320)), y: Math.max(0, Math.min(960 - 400, around.y - 200)), width: 640, height: 400 } });
  }
  await page.mouse.move(2, 2); await settle(page);

  results.browser = await browser.version(); results.errors = errors; results.warnings = [...new Set(warnings)];
  results.seed = seed.stats;
  writeFileSync(path.join(here, 'measurements.json'), JSON.stringify(results, null, 2) + '\n');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: results.browser, islands: results.front.islands.map(i => [i.story, i.circles, results.surveyedFiles[i.story], i.middlesInsideOwnTerritory, +i.minRadius.toFixed(2), +i.maxRadius.toFixed(2)]), hover: [results.hover.largest.chosen, results.hover.largestOnTerritory.chosen], errors }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
