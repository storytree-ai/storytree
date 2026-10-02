// App 2.1/2.5 and 3.3/3.7 through the shared real Desktop renderer capture.
// STORYTREE_EMBEDDER=off node packages/app/evidence/mounted-allocation/prove.mjs
// The database bridge is a stand-in; project choice and surface settings use a throwaway home.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { Session } from 'node:inspector/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { tsImport } from 'tsx/esm/api';
import { acquireHeavyLock } from '../../../dev-loop/src/heavy-lock.mjs';
import { recordBrowserCoverage } from '../../../dev-loop/src/browser-coverage.mjs';
const { projectSelection, surfacesActions, smokeProblems } = await tsImport('../../src/index.ts', import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const pkgDir = path.join(root, 'packages/app');
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const { build, stop } = require('esbuild');
const { forestSurfaces } = await tsImport(require.resolve('@storytree/forest/surfaces'), import.meta.url);
const { arcSurfaces } = await tsImport(require.resolve('@storytree/arc-surface/surfaces'), import.meta.url);
const projectProof = 'app 2.1 mounted project choice and retry, 2.5 empty project list';
const surfaceProof = 'app 3.7 mounted surface switches persist, 3.3 complete project census';
let release = () => {};
const home = await mkdtemp(path.join(tmpdir(), 'storytree-mounted-capture-'));
// Keep the capture bundle at the same depth as src/capture, preserving its root-relative defaults.
const bundle = path.join(root, 'apps/desktop/dist/capture/capture.mjs');
const dist = path.join(root, 'apps/desktop/dist/capture/renderer');
const inspector = new Session();
const traces = [];
const observations = { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), platform: process.platform };
let passed = false;
const hash = value => createHash('sha256').update(value).digest('hex');
const health = { reported: { state: 'passing' }, verified: { state: 'passing' } };
const tree = project => ({ arcs: [], stories: [{
  id: `story_${project}`, title: `The ${project} project`, health,
  capabilities: [{ id: `capability_${project}`, title: '1 · One capability', description: 'One visible capability',
    dependsOn: [], proposed: false, status: 'healthy', health, contracts: [{ id: `contract_${project}`, title: '1.1 · One promise', health }] }],
}] });
let projects = ['alpha', 'beta'];
let rejectChoice = false;
const selection = projectSelection({ file: path.join(home, 'choice.json'), listProjects: async () => projects });
const surfaces = surfacesActions([...forestSurfaces, ...arcSurfaces], home);
const seed = { projects, tree: tree('alpha'), changes: { changes: [], cursor: 0 }, lines: { lines: [], cursor: 0 }, covers: {} };
const waitReady = page => page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 60000 });
const openMenu = async page => {
  if (!await page.locator('#app-menu').isVisible()) await page.getByRole('button', { name: 'App menu', exact: true }).click();
};
const census = async page => {
  const state = await page.evaluate(() => ({ ...document.body.dataset }));
  assert.deepEqual(smokeProblems(state.state, tree(state.project), state.drew), [], '3.3 the mounted frame reports every story and capability');
  assert.equal(await page.locator('canvas').count(), 1);
  return state;
};
async function measuredBrowser(page, proof) {
  const source = await readFile(path.join(dist, 'renderer.js'), 'utf8');
  const sourceMap = JSON.parse(await readFile(path.join(dist, 'renderer.js.map'), 'utf8'));
  const scripts = (await page.coverage.stopJSCoverage()).filter(script => script.url.endsWith('/renderer.js')).map(script => {
    assert.equal(script.source, source, 'runtime renderer matches its source map');
    return { bundlePath: path.join(dist, 'renderer.js'), source, sourceMap, functions: script.functions };
  });
  assert.ok(scripts.length > 0, 'the renderer executed under coverage, including reloads');
  traces.push({ proof, scripts });
}
async function measuredNode(proof) {
  const result = await inspector.post('Profiler.takePreciseCoverage');
  const measured = result.result.filter(script => script.url === pathToFileURL(bundle).href);
  assert.equal(measured.length, 1, 'capture harness executed in Node');
  const source = await readFile(bundle, 'utf8');
  assert.equal((await inspector.post('Debugger.getScriptSource', { scriptId: measured[0].scriptId })).scriptSource, source);
  traces.find(trace => trace.proof === proof).scripts.push({ bundlePath: bundle, source,
    sourceMap: JSON.parse(await readFile(`${bundle}.map`, 'utf8')), functions: measured[0].functions });
}
try {
  release = await acquireHeavyLock({ root, what: 'App mounted capture allocation' });
  await mkdir(path.dirname(bundle), { recursive: true });
  await build({ entryPoints: [path.join(root, 'apps/desktop/src/capture/index.ts')], outfile: bundle,
    bundle: true, packages: 'external', sourcemap: 'external', platform: 'node', format: 'esm', target: 'node24' });
  stop();
  inspector.connect();
  await inspector.post('Debugger.enable');
  await inspector.post('Profiler.enable');
  await inspector.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  const { buildCapture, runCapture } = await import(pathToFileURL(bundle));
  await buildCapture({ root, dist });
  await runCapture({ folder: here, dist, seed, answers: {
    projectSelection: () => selection.read(),
    chooseProject: async name => { if (rejectChoice) throw new Error('choice temporarily unavailable'); return selection.choose(name); },
    projectTree: async project => tree(project),
    ...surfaces,
  }, prepare: async ({ page }) => {
    // The shared runner reaches ready first; reload under coverage to include actual entry execution.
    await page.evaluate(() => localStorage.setItem('storytree:setup:guide-seen:v1', 'yes'));
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await page.reload();
    await waitReady(page);
    observations.browser = page.context().browser().version();
  }, views: [
    { name: 'projects', picture: false, measure: async ({ page }) => {
      assert.equal((await census(page)).project, 'alpha');
      await openMenu(page);
      assert.deepEqual(await page.locator('#project option').allTextContents(), projects);
      assert.equal(await page.locator('#project').inputValue(), 'alpha');
      rejectChoice = true;
      await page.locator('#project').selectOption('beta');
      await page.locator('[data-app-project-error]:not([hidden])').waitFor();
      assert.match(await page.locator('[data-app-project-error]').innerText(), /choice temporarily unavailable/);
      await waitReady(page);
      assert.equal((await census(page)).project, 'alpha', '2.1 failed choice preserves the current forest');
      assert.equal(await page.locator('#app-menu').isVisible(), true, 'retry stays available');
      rejectChoice = false;
      await page.locator('#project').selectOption('beta');
      await page.waitForFunction(() => document.body.dataset.project === 'beta' && document.body.dataset.state === 'ready');
      assert.equal(await page.locator('#app-menu').isVisible(), false, 'successful choice closes the overlay');
      const switched = await census(page);
      assert.equal((await selection.read()).current, 'beta');
      projects = [];
      await page.waitForFunction(() => document.body.dataset.state === 'empty', undefined, { timeout: 10000 });
      assert.match(await page.locator('#content').innerText(), /add a folder/i);
      assert.equal(await page.locator('canvas').count(), 0, '2.5 empty list releases the mounted surface');
      projects = ['alpha', 'beta'];
      await waitReady(page);
      assert.equal((await census(page)).project, 'beta', 'recovery follows the saved choice');
      await measuredBrowser(page, projectProof);
      // Taking precise coverage resets counts: each capability receives only its own phase.
      await measuredNode(projectProof);
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      await page.reload();
      await waitReady(page);
      return observations.projects = { switched, failedChoiceRetried: true, emptyAndRecovered: true };
    } },
    { name: 'surfaces', measure: async ({ page }) => {
      assert.equal(await page.locator('.arc-surface-mount').count(), 1);
      await openMenu(page);
      await page.locator('[data-app-section="surfaces"]').click();
      await page.locator('[data-switch="arcs"]').waitFor();
      const switches = await page.locator('[data-switch]').evaluateAll(nodes => nodes.map(node => node.dataset.switch));
      assert.ok(switches.includes('arcs') && switches.includes('library') && switches.includes('sessions'));
      for (const id of ['arcs', 'library']) {
        await page.locator(`[data-switch="${id}"]`).uncheck();
        await page.waitForFunction(() => document.querySelector('[data-surfaces-status]')?.textContent === 'Saved');
        await waitReady(page);
      }
      await page.locator('[data-app-close]').click();
      assert.equal(await page.locator('.arc-surface-mount').count(), 0, '3.7 switched-off Arcs is unmounted');
      assert.equal(await page.locator('.forest-views').count(), 0, '3.7 switched-off Library is unmounted');
      await census(page);
      const saved = JSON.parse(await readFile(path.join(home, 'settings.json'), 'utf8'));
      assert.equal(saved.surfaces.arcs.on, false);
      assert.equal(saved.surfaces.library.on, false);
      await page.reload();
      await waitReady(page);
      assert.equal(await page.locator('.arc-surface-mount').count(), 0, 'switch remains off after reload');
      assert.equal(await page.locator('.forest-views').count(), 0);
      await openMenu(page);
      await page.locator('[data-app-section="surfaces"]').click();
      await page.locator('[data-switch="arcs"]').check();
      await page.waitForFunction(() => document.querySelector('[data-surfaces-status]')?.textContent === 'Saved');
      await waitReady(page);
      assert.equal(await page.locator('.arc-surface-mount').count(), 1, 'switching back on remounts Arcs');
      await page.locator('[data-app-close]').click();
      await census(page);
      await measuredBrowser(page, surfaceProof);
      return observations.surfaces = { switches, saved, remounted: true };
    } },
  ] });
  await measuredNode(surfaceProof);
  observations.measured = {};
  for (const trace of traces) observations.measured[trace.proof] = recordBrowserCoverage({ pkgDir, passed: true, ...trace });
  for (const name of ['build', 'fake-bridge', 'launch', 'output', 'runner']) {
    assert.ok(observations.measured[projectProof][`../../apps/desktop/src/capture/${name}.ts`]?.[2] > 0, `${name}: actual Node functions ran`);
  }
  for (const proof of [projectProof, surfaceProof]) assert.ok(observations.measured[proof]['../../apps/desktop/src/renderer/renderer.ts']);
  for (const owned of Object.values(observations.measured)) assert.ok(Object.keys(owned).every(file => file.startsWith('src/') || file.startsWith('../../apps/desktop/src/')), 'App allocates only its frame and story');
  observations.bundleHashes = traces.map(trace => ({ proof: trace.proof, bundles: trace.scripts.map(script => ({ source: hash(script.source), map: hash(JSON.stringify(script.sourceMap)) })) }));
  observations.passed = true;
  // Keep the actual ranges and exact bundle/map hashes without repeating multi-megabyte assets.
  await writeFile(path.join(here, 'trace.json.gz'), gzipSync(JSON.stringify(traces.map(trace => ({ proof: trace.proof,
    scripts: trace.scripts.map(script => ({ bundle: path.relative(root, script.bundlePath), sourceSha256: hash(script.source),
      sourceMapSha256: hash(JSON.stringify(script.sourceMap)), functions: script.functions })),
  })))));
  await writeFile(path.join(here, 'observations.json'), JSON.stringify(observations, null, 2) + '\n');
  passed = true;
  console.log(JSON.stringify(observations, null, 2));
} finally {
  if (!passed) for (const proof of [projectProof, surfaceProof]) {
    try { recordBrowserCoverage({ pkgDir, proof, passed: false, scripts: [] }); } catch { /* failed proof contributes nothing */ }
  }
  inspector.disconnect();
  stop();
  await rm(home, { recursive: true, force: true });
  await rm(path.dirname(bundle), { recursive: true, force: true });
  release();
}
