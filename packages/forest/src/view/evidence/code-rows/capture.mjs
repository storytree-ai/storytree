// Seeded, repeatable capture of one build of the actual desktop page: `node capture.mjs <before|after>`
// serves dist/<label>/ (made by build.mjs) to headless Chromium with a stand-in bridge answering from
// seed.json.gz and survey.json, the same for both builds; same 1440 x 960 viewport, same programmatic
// turns; nothing is hand-panned. Run under flock /tmp/storytree-heavy.lock. Writes <label>-opening.png
// (the globe as the app opens it), <label>-front.png (the globe unturned, its front facing the eye),
// <label>-wide.png (the same, zoomed out to the whole globe) and measurements-<label>.json (each island's
// latitude and longitude on the unturned globe, and its dependency rank in the seed's plan).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLANET_PLAYWRIGHT
  ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2];
assert.ok(['before', 'after'].includes(label), 'usage: node capture.mjs <before|after>');
const dist = path.join(here, 'dist', label);
const seed = JSON.parse(gunzipSync(readFileSync(path.join(here, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(here, 'survey.json'), 'utf8'));

/** Each story's dependency rank in the seed (longest path over capability dependsOn rolled up to stories), for the measurements. */
function ranks(tree) {
  const owner = new Map(tree.stories.flatMap(s => s.capabilities.map(c => [c.id, s.id])));
  const on = new Map(tree.stories.map(s => [s.id, [...new Set(s.capabilities.flatMap(c => c.dependsOn.map(d => owner.get(d)).filter(o => o && o !== s.id)))]]));
  const rank = new Map(), visiting = new Set();
  const visit = id => {
    if (rank.has(id)) return rank.get(id);
    if (visiting.has(id)) return -1;
    visiting.add(id);
    const r = Math.max(0, ...on.get(id).map(d => visit(d) + 1));
    visiting.delete(id); rank.set(id, r); return r;
  };
  tree.stories.forEach(s => visit(s.id));
  return { rank, on };
}

const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (name === 'favicon.ico') { res.writeHead(204).end(); return; }
  if (!['index.html', 'renderer.js', 'renderer.js.map', 'styles.css', 'arc-surface.css', 'app-setup.css', 'forest.css'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.map') ? 'application/json' : 'text/html');
  res.end(readFileSync(path.join(dist, name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

const settle = page => page.evaluate(async () => { for (let i = 0; i < 12; i++) { window.__globe.invalidate(); await new Promise(requestAnimationFrame); } });

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
  // The stand-in bridge: the reads the page makes, answered from the seed; any other call answers undefined.
  await page.addInitScript(({ data, survey }) => {
    const copy = value => structuredClone(value);
    const known = {
      projectSelection: async () => ({ projects: data.projects, current: 'storytree' }),
      chooseProject: async () => ({ projects: data.projects, current: 'storytree' }),
      listProjects: async () => copy(data.projects), projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
      linesSince: async (_, cursor) => cursor === 0 ? copy(data.lines) : { lines: [], cursor: data.lines.cursor },
      frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [],
      arcView: async () => null, arcViews: async () => [], codeSurvey: async () => copy(survey), holds: async () => ({ waits: {}, heldOn: {} }), waitHolds: async () => [], heldOnQuestion: async () => [],
      readSurfaces: async () => ({ ok: false }), readSignIn: async () => ({ on: false }), agentConnections: async () => [],
      windowReadings: async (_, sessions) => sessions.map(session => ({ session, at: new Date().toISOString(), compactions: 0, inView: [], glimpses: [], opens: [] })),
      windowReading: async (_, session) => ({ session, at: new Date().toISOString(), compactions: 0, inView: [], glimpses: [], opens: [] }),
      contextReadings: async () => [], idleAfterMs: async () => 3600000, leaveAfterMs: async () => 3600000, checkForUpdates: async () => ({ state: 'idle' }),
    };
    window.storytree = new Proxy(known, { get: (t, m) => m === 'then' ? undefined : (t[m] ?? (async () => undefined)) });
  }, { data: seed, survey });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(ids => {
    const state = window.__globe;
    if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
    return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
  }, seed.tree.stories.map(s => s.id), { timeout: 120000 }).catch(async error => {
    console.error(JSON.stringify({ state: await page.evaluate(() => document.body.dataset.state + ' | ' + (document.querySelector('.empty')?.innerText ?? '')), errors, urls: failed, warnings: warnings.slice(0, 5) }));
    throw error;
  });
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('file:')) n++; }); return n > 0; }, undefined, { timeout: 60000 });
  for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  await settle(page);
  await page.screenshot({ path: path.join(here, `${label}-opening.png`), timeout: 180000 });

  // Unturned: the globe's own front faces the eye (the page turns it by the eye, then by a spin and tilt of zero).
  await page.evaluate(() => { window.__nav.onRotate(window.__globe.camera.quaternion.clone()); });
  await settle(page);
  await page.screenshot({ path: path.join(here, `${label}-front.png`), timeout: 180000 });
  const islands = await page.evaluate(ids => {
    const { scene, camera } = window.__globe, V = camera.position.constructor;
    return ids.map(id => {
      // Back into the globe's own frame: undo the eye the globe was turned by.
      const p = scene.getObjectByName(`planet:${id}`).getWorldPosition(new V()).applyQuaternion(window.__nav.rotation.clone().invert()).normalize();
      return { id, latitude: Math.asin(p.y) * 180 / Math.PI, longitude: Math.atan2(p.x, p.z) * 180 / Math.PI };
    });
  }, seed.tree.stories.map(s => s.id));
  const base = await page.evaluate(() => window.__globe.camera.zoom);
  await page.evaluate(({ zoom }) => { const { camera, invalidate } = window.__globe; camera.zoom = zoom; camera.updateProjectionMatrix(); invalidate(); }, { zoom: base * 0.7 });
  await settle(page);
  await page.screenshot({ path: path.join(here, `${label}-wide.png`), timeout: 180000 });

  const { rank, on } = ranks(seed.tree);
  const titles = new Map(seed.tree.stories.map(s => [s.id, s.title]));
  const results = { label, browser: await browser.version(), errors, warnings: [...new Set(warnings)],
    islands: islands.map(i => ({ title: titles.get(i.id), rank: rank.get(i.id), dependsOn: on.get(i.id).map(d => titles.get(d)), latitude: +i.latitude.toFixed(1), longitude: +i.longitude.toFixed(1) }))
      .sort((a, b) => a.rank - b.rank || a.longitude - b.longitude) };
  // Every dependency edge, and whether the dependent's island sits north of its dependency's.
  results.edges = results.islands.flatMap(i => i.dependsOn.map(d => ({ from: i.title, on: d, north: i.latitude > results.islands.find(o => o.title === d).latitude })));
  results.edgesNorth = `${results.edges.filter(e => e.north).length} of ${results.edges.length}`;
  writeFileSync(path.join(here, `measurements-${label}.json`), JSON.stringify(results, null, 2) + '\n');
  assert.deepEqual(errors, []);
  console.log(results.edgesNorth, JSON.stringify(results.islands.map(i => [i.title, i.rank, i.latitude, i.longitude])));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
