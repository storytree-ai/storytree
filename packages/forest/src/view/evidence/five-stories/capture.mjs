// Seeded, repeatable capture of one build of the actual desktop page: `node capture.mjs <before|after>`
// serves dist/<label>/ (made by build.mjs) to headless Chromium with a stand-in bridge, the same for both
// builds, at 1440 x 960 and device scale 1, and photographs three forests as the app opens them, nothing
// hand-turned: `row` (five stories depending on nothing, as the first Conduit build made them), `chain`
// (the same five, each depending on the one before) and `storytree` (storytree's own seed from ../code-rows).
// Writes <label>-<forest>.png and measurements-<label>.json: each story nameplate's box on screen, whether it
// shows, and the pairs of shown plates that overlap. Run under flock /tmp/storytree-heavy.lock.
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

const titles = ['Have an account', 'Comment on articles', 'Browse the home page feed', 'Read and write articles', 'Follow people and favourite articles'];
const health = { reported: { state: 'not-checked' }, verified: { state: 'not-checked' } };
/** A five-story project as a first build makes it: one capability each, no code yet; in a chain, each story's depends on the one before's. */
function fiveStories(chain) {
  const ids = titles.map((_, i) => `story_conduit${i}`);
  const stories = ids.map((id, i) => ({ id, title: titles[i], description: '', health, capabilities: [{
    id: `capability_conduit${i}`, title: '1 · First capability', description: '', dependsOn: chain && i > 0 ? [`capability_conduit${i - 1}`] : [],
    proposed: true, status: 'proposed', contracts: [], health }] }));
  const changes = stories.map((s, i) => ({ seq: i + 1, recordId: s.id, type: 'story', action: 'created',
    record: { id: s.id, type: 'story', fields: { title: s.title, description: '' }, version: 1, createdAt: `2026-10-01T10:0${i}:00.000Z`, updatedAt: `2026-10-01T10:0${i}:00.000Z` } }));
  return { seed: { projects: ['storytree'], tree: { stories, arcs: [] }, changes: { changes, cursor: changes.length }, lines: { lines: [], cursor: 0 }, covers: {} }, survey: {} };
}
const own = { seed: JSON.parse(gunzipSync(readFileSync(path.join(here, '../code-rows/seed.json.gz'))).toString('utf8')),
  survey: JSON.parse(readFileSync(path.join(here, '../code-rows/survey.json'), 'utf8')) };
const forests = { row: fiveStories(false), chain: fiveStories(true), storytree: own };

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
  const results = { label, browser: await browser.version(), forests: {} };
  for (const [name, { seed, survey }] of Object.entries(forests)) {
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
    if (name === 'storytree') await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('file:')) n++; }); return n > 0; }, undefined, { timeout: 60000 });
    for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
    await settle(page);
    await page.screenshot({ path: path.join(here, `${label}-${name}.png`), timeout: 180000 });
    const plates = await page.evaluate(() => [...document.querySelectorAll('.planet-nameplate[data-story-id]')].map(el => {
      const r = el.getBoundingClientRect(), style = getComputedStyle(el);
      return { title: el.textContent, box: [r.left, r.top, r.right, r.bottom].map(Math.round), shown: style.visibility !== 'hidden' && el.style.visibility !== 'hidden' && r.width > 0, facing: +(+el.dataset.facing || 0).toFixed(2), drop: +(el.dataset.drop ?? 0) };
    }));
    const shown = plates.filter(p => p.shown);
    const overlaps = shown.flatMap((a, i) => shown.slice(i + 1).filter(b => a.box[0] < b.box[2] && b.box[0] < a.box[2] && a.box[1] < b.box[3] && b.box[1] < a.box[3]).map(b => [a.title, b.title]));
    results.forests[name] = { errors, plates, shown: `${shown.length} of ${plates.length}`, overlaps };
    console.log(label, name, 'shown', `${shown.length} of ${plates.length}`, 'overlapping pairs', overlaps.length);
    await page.close();
  }
  writeFileSync(path.join(here, `measurements-${label}.json`), JSON.stringify(results, null, 2) + '\n');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
