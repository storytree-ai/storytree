// Seeded, repeatable capture of the actual desktop page for ADR-0804 D3 and D7: the same eight-story seed
// and real code survey as ../file-circles, the same 1440 x 960 viewport, no hand-panning. Four scenarios:
//   before   no survey, so every island is sized by its capabilities, as it was before this increment
//   after    the real survey: each island's land follows its lines of code
//   nudged   The agent link's code doubled: its island outgrows its neighbours' room and nudges them
//   grown    every story's code x5: nudging cannot make room, so the globe (and its core) grows
// Run under `tsx capture.mjs` from packages/forest, and under flock /tmp/storytree-heavy.lock, after `node build.mjs`.
// Measures what can be counted before anyone looks and writes measurements.json.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { placeOnPackedGlobe, PLANET_RADIUS } from '@storytree/forest';

const { chromium } = await import(process.env.PLANET_PLAYWRIGHT
  ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(path.join(here, '../knowledge-under-islands/seed.json'), 'utf8'));
const survey = JSON.parse(readFileSync(path.join(here, '../file-circles/survey.json'), 'utf8'));
const AGENT_LINK = 'story_05e45963ca9f';
const scaled = (by) => Object.fromEntries(Object.entries(survey).map(([id, story]) => [id, { ...story,
  files: story.files.map(file => ({ ...file, lines: Math.round(file.lines * (typeof by === 'function' ? by(id) : by)) })) }]));
const scenarios = {
  before: {},
  after: survey,
  nudged: scaled(id => id === AGENT_LINK ? 2 : 1),
  grown: scaled(5),
};
const places = new Map(seed.tree.stories.map((story, i) => [story.id, i + 1]));
const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (name === 'favicon.ico') { res.writeHead(204).end(); return; }
  if (!['index.html', 'renderer.js', 'renderer.js.map', 'styles.css', 'arc-surface.css', 'app-setup.css', 'forest.css'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.map') ? 'application/json' : 'text/html');
  res.end(readFileSync(path.join(here, 'dist', name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const settle = page => page.evaluate(async () => { for (let i = 0; i < 12; i++) { window.__globe.invalidate(); await new Promise(requestAnimationFrame); } });

/** Per island: its drawn land, how far its coast reaches, and where its plate stands (a direction, in the globe's own frame); and the globe's radius. */
const measure = page => page.evaluate(() => {
  const { scene } = window.__globe;
  scene.updateMatrixWorld(true);
  const shell = scene.getObjectByName('planet:shell');
  const islands = [];
  scene.traverse(object => {
    if (!object.name.startsWith('planet:story_')) return;
    const local = new object.position.constructor();
    let area = 0, reach = 0;
    object.traverse(child => {
      if (child.name !== 'island-ground') return;
      child.traverse(mesh => {
        if (!mesh.geometry?.attributes?.position) return;
        const at = mesh.geometry.attributes.position, index = mesh.geometry.index;
        const point = i => { local.fromBufferAttribute(at, i).applyMatrix4(mesh.matrixWorld); object.worldToLocal(local); return [local.x, local.z]; };
        const n = index ? index.count : at.count;
        for (let t = 0; t < n; t += 3) {
          const [a, b, c] = [0, 1, 2].map(k => point(index ? index.getX(t + k) : t + k));
          area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
          reach = Math.max(reach, Math.hypot(a[0], a[1]), Math.hypot(b[0], b[1]), Math.hypot(c[0], c[1]));
        }
      });
    });
    const p = object.position.clone();
    islands.push({ story: object.name.slice(7), area, reach, distance: p.length(), direction: p.normalize().toArray() });
  });
  // The knowledge core's points sit inside the globe, so their farthest distance from its middle is the core's size.
  let core = 0, points = 0;
  scene.traverse(object => { if (object.name.startsWith('knowledge-point:')) { points++; core = Math.max(core, object.position.length()); } });
  return { radius: shell.geometry.parameters.radius, coreReach: core, corePoints: points, zoom: window.__globe.camera.zoom, islands };
});

let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.PLANET_CHROMIUM ?? '/home/mickh/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell',
    headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const results = { seed: seed.stats, scenarios: {} };
  for (const [name, code] of Object.entries(scenarios)) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(({ data, survey }) => {
      const copy = value => structuredClone(value);
      let current = data.projects.includes('storytree') ? 'storytree' : data.projects[0];
      window.storytree = {
        projectSelection: async () => copy({ projects: data.projects, current }),
        chooseProject: async project => { current = project; return copy({ projects: data.projects, current }); },
        listProjects: async () => copy(data.projects), projectTree: async () => copy(data.tree),
        changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
        linesSince: async (_, cursor) => cursor === 0 ? copy(data.lines) : { lines: [], cursor: data.lines.cursor },
        frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [], readSurfaces: async () => undefined,
        codeSurvey: async () => copy(survey),
      };
    }, { data: seed, survey: code });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(ids => {
      const state = window.__globe;
      if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
      return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
    }, seed.tree.stories.map(s => s.id), { timeout: 60000 });
    if (Object.keys(code).length > 0) await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('file:')) n++; }); return n > 0; }, undefined, { timeout: 30000 });
    await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
    await settle(page);
    const measured = await measure(page);
    const lines = Object.fromEntries(Object.entries(code).map(([id, story]) => [id, story.files.reduce((sum, file) => sum + file.lines, 0)]));
    // Nudge distance: how far each plate's direction is from its permanent place, in radians and in ground units on this globe.
    for (const island of measured.islands) {
      const anchor = placeOnPackedGlobe(places.get(island.story));
      const a = [anchor.x, anchor.y, anchor.z].map(v => v / PLANET_RADIUS);
      island.lines = lines[island.story] ?? null;
      island.nudgeRadians = Math.acos(Math.max(-1, Math.min(1, a[0] * island.direction[0] + a[1] * island.direction[1] + a[2] * island.direction[2])));
      island.nudgeGround = island.nudgeRadians * measured.radius;
    }
    // Nearest two islands' reaches, sea to spare between them (reach discs, as the layout reads them).
    let tightest = Infinity;
    for (const a of measured.islands) for (const b of measured.islands) if (a.story < b.story) {
      const angle = Math.acos(Math.max(-1, Math.min(1, a.direction[0] * b.direction[0] + a.direction[1] * b.direction[1] + a.direction[2] * b.direction[2])));
      tightest = Math.min(tightest, angle * measured.radius - a.reach - b.reach);
    }
    measured.seaBetweenReaches = tightest;
    measured.errors = errors;
    results.scenarios[name] = measured;
    await page.screenshot({ path: path.join(here, `${name}.png`), timeout: 180000 });
    assert.deepEqual(errors, []);
    await page.close();
  }
  results.browser = await browser.version();
  writeFileSync(path.join(here, 'measurements.json'), JSON.stringify(results, null, 2) + '\n');
  const line = ([name, s]) => [name, `radius ${s.radius.toFixed(1)}`, `sea ${s.seaBetweenReaches.toFixed(1)}`, s.islands.map(i => `${i.story.slice(-4)}:${i.area.toFixed(0)}/${(i.nudgeGround).toFixed(1)}`).join(' ')].join(' | ');
  console.log(Object.entries(results.scenarios).map(line).join('\n'));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
