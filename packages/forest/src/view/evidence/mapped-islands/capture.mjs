// Seeded, repeatable capture of the actual desktop page with mapped islands (ADR-0993 D3): storytree's eight-story snapshot
// (../knowledge-under-islands, surveyed by ../session-tints) with three mapped stories beside it, of about 2,000, 20,000
// and 200,000 lines, each importing the next; and a project whose only stories are mapped, with no survey at all.
// `node capture.mjs [cap]` uses the page `node build.mjs [cap]` bundled. Run both under
// `node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" --`. Writes its pictures and measurements-<cap|shipped>.json.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const cap = process.argv.slice(2).find(arg => !arg.startsWith('--'));
const tag = cap === undefined ? 'shipped' : `cap-${cap}`;
const seed = JSON.parse(readFileSync(path.join(here, '../knowledge-under-islands/seed.json'), 'utf8'));
const builtSurvey = JSON.parse(readFileSync(path.join(here, '../session-tints/survey.json'), 'utf8'));
const health = { reported: { state: 'not-checked' }, verified: { state: 'not-checked' } };
for (const story of seed.tree.stories) for (const capability of story.capabilities) {
  capability.status = capability.health.verified.state === 'passing' ? 'healthy' : 'untested';
  capability.proposed = false;
}
const MAPPED = [['story_mapped_shop', 'storefront', 2_000, ['story_mapped_api']], ['story_mapped_api', 'api', 20_000, ['story_mapped_core']], ['story_mapped_core', 'core', 200_000, []]];
const mappedStory = ([id, pkg]) => ({ id, title: pkg, capabilities: [], health, mapped: { from: '/code/shop', package: `packages/${pkg}`, folders: [`packages/${pkg}`] } });
const mappedSurvey = Object.fromEntries(MAPPED.map(([id, pkg, lines, dependsOn]) => [id, {
  files: Array.from({ length: 20 }, (_, i) => ({ path: `packages/${pkg}/src/f${i}.ts`, lines: lines / 20 })), imports: [], tests: [], dependsOn, mapped: { folder: '/code/shop' },
}]));
const scenes = {
  beside: { tree: { ...seed.tree, stories: [...seed.tree.stories, ...MAPPED.map(mappedStory)] }, survey: { ...builtSurvey, ...mappedSurvey } },
  'only-mapped': { tree: { arcs: [], unverified: true, stories: MAPPED.map(mappedStory) }, survey: {} },
};

await withCapture({ folder: here, dist: path.join(here, 'dist', tag) }, async ({ browser, origin, out, settle }) => {
  const results = { cap: cap === undefined ? 'shipped' : Number(cap), browser: await browser.version() };
  for (const [name, { tree, survey }] of Object.entries(scenes)) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const bridge = fakeBridge({});
    await bridge.install(page);
    const changes = { changes: tree.stories.map((story, at) => ({ seq: at + 1, recordId: story.id, type: 'story', action: 'created', record: { id: story.id, type: 'story', version: 1, fields: { title: story.title }, createdAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString() } })), cursor: tree.stories.length };
    await page.addInitScript(({ tree, survey, changes }) => {
      const copy = value => structuredClone(value);
      localStorage.setItem('storytree:setup:guide-seen:v1', 'yes');
      window.storytreeAnswers = {
        projectSelection: async () => ({ projects: ['shop'], current: 'shop' }), chooseProject: async () => ({ projects: ['shop'], current: 'shop' }),
        listProjects: async () => ['shop'], projectTree: async () => copy(tree),
        changesSince: async (_, cursor) => cursor === 0 ? copy(changes) : { changes: [], cursor: changes.cursor },
        linesSince: async () => ({ lines: [], cursor: 0 }), frontCovers: async () => [], relatedNotes: async () => [], readSurfaces: async () => undefined,
        codeSurvey: async () => copy(survey),
      };
    }, { tree, survey, changes });
    await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
    const ids = tree.stories.map(story => story.id);
    await page.waitForFunction(ids => {
      const state = window.__globe;
      if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
      return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('territory:mapped') || !id.startsWith('story_mapped'));
    }, ids, { timeout: 60000, polling: 100 });
    await settle(page, 12);
    results[name] = await page.evaluate(() => {
      const { scene } = window.__globe;
      const islands = [];
      scene.traverse(object => {
        if (!object.name.startsWith('planet:')) return;
        const mapped = object.getObjectByName('territory:mapped');
        const ground = object.getObjectByName('island-ground');
        ground?.geometry.computeBoundingSphere();
        islands.push({ story: object.name.slice(7), mapped: !!mapped, fill: mapped ? '#' + mapped.material.color.getHexString() : null, reach: ground ? Math.round(ground.geometry.boundingSphere.radius * 10) / 10 : null,
          files: (() => { let n = 0; object.traverse(child => { if (child.name.startsWith('file:')) n++; }); return n; })(), hatch: !!object.getObjectByName('territory-hatch:unclaimed') });
      });
      return islands;
    });
    await page.screenshot({ path: path.join(out, `${name}-${tag}.png`), timeout: 180000 });
    if (name === 'beside') {
      // Click the 20,000-line island: its story panel says it is mapped.
      await page.evaluate(() => {
        const { scene, camera } = window.__globe, { rotation, onRotate } = window.__nav;
        const V = camera.position.constructor, Q = camera.quaternion.constructor;
        const at = scene.getObjectByName('planet:story_mapped_api').getWorldPosition(new V()).normalize();
        onRotate(new Q().setFromUnitVectors(at, camera.position.clone().normalize()).multiply(rotation));
        camera.zoom *= 2.2; camera.updateProjectionMatrix(); window.__globe.invalidate();
      });
      await settle(page, 12);
      const spot = await page.evaluate(() => {
        const { scene, camera, gl } = window.__globe;
        const V = camera.position.constructor;
        const at = scene.getObjectByName('planet:story_mapped_api').getWorldPosition(new V()).project(camera);
        const box = gl.domElement.getBoundingClientRect();
        return { x: box.left + (at.x + 1) / 2 * box.width, y: box.top + (1 - at.y) / 2 * box.height };
      });
      await page.mouse.click(spot.x, spot.y);
      await settle(page, 6);
      results.panel = await page.evaluate(() => document.querySelector('.panel-mapped')?.textContent ?? null);
      await page.screenshot({ path: path.join(out, `close-up-${tag}.png`), timeout: 180000 });
    }
    await page.close();
  }
  writeFileSync(path.join(out, `measurements-${tag}.json`), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({ cap: results.cap, panel: results.panel, beside: results.beside.filter(i => i.mapped), onlyMapped: results['only-mapped'] }));
});
