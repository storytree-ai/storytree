// Seeded, repeatable capture of the actual desktop page's risk bar (question_1740edf77e9e): storytree's eight-story
// snapshot (../knowledge-under-islands) with risk readings on two stories, as `storytree quality story-risks` wrote
// them for the live library on 2026-10-24. The app carries the extra checks the owner named (a real-app run on each
// change, and a fresh-install sweep before each formal release on its Updates capability); the library has none.
// Each story's island is clicked and its panel pictured. Run from the checkout root, in the foreground:
//   node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/risk-bar/capture.mjs [--retake]
// It writes its pictures and measurements.json.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(path.join(here, '../knowledge-under-islands/seed.json'), 'utf8'));
const read = '2026-10-24';
const READINGS = {
  // The app: as the Desktop app story read, depth 3 and radius 2, so 8 of 10.
  story_16ac26dfa5d6: {
    risk: { depth: { value: 3, read, reason: 'flags: additive schema, credentials, record writes, release path, screen' }, radius: { value: 2, downstream: 1, audience: 'invited', read, reason: '1 package downstream; serves invited users itself' } },
    guardrails: [{ check: 'A real-app run that fails on any main-process error', trigger: 'change' }],
    capabilities: { '4 · Updates': [{ check: 'A thorough fresh-install sweep', trigger: 'release' }] },
  },
  // The library: depth 3 and radius 4, so 10 of 10, with no extra checks.
  story_eb7d623fb9c8: {
    risk: { depth: { value: 3, read, reason: 'flags: destructive schema, record writes, the store' }, radius: { value: 4, downstream: 22, audience: 'invited', read, reason: '22 packages downstream; invited users, inherited from apps/desktop' } },
  },
};
for (const story of seed.tree.stories) {
  for (const capability of story.capabilities) {
    capability.status = capability.health.verified.state === 'passing' ? 'healthy' : 'untested';
    capability.proposed = false;
  }
  const reading = READINGS[story.id];
  if (reading === undefined) continue;
  story.risk = reading.risk;
  if (reading.guardrails) story.guardrails = reading.guardrails;
  for (const capability of story.capabilities) if (reading.capabilities?.[capability.title]) capability.guardrails = reading.capabilities[capability.title];
}
const tree = seed.tree;
const changes = { changes: tree.stories.map((story, at) => ({ seq: at + 1, recordId: story.id, type: 'story', action: 'created', record: { id: story.id, type: 'story', version: 1, fields: { title: story.title }, createdAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString() } })), cursor: tree.stories.length };

const dist = buildFolder(here);
await buildCapture({ dist });

await withCapture({ folder: here, dist }, async ({ browser, origin, out, settle }) => {
  const results = { browser: await browser.version() };
  for (const [name, story] of [['the-app', 'story_16ac26dfa5d6'], ['the-library', 'story_eb7d623fb9c8']]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const copy = value => structuredClone(value);
    const bridge = fakeBridge({
      projectSelection: async () => ({ projects: ['storytree'], current: 'storytree' }), chooseProject: async () => ({ projects: ['storytree'], current: 'storytree' }),
      listProjects: async () => ['storytree'], projectTree: async () => copy(tree),
      changesSince: async (_, cursor) => cursor === 0 ? copy(changes) : { changes: [], cursor: changes.cursor },
    });
    await bridge.install(page);
    await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
    await bridge.ready(page);
    await page.waitForFunction(story => document.body.dataset.state === 'ready' && !!window.__globe?.scene.getObjectByName(`planet:${story}`)?.getObjectByName('island-ground'), story, { timeout: 180000 });
    for (const label of ['Close help', 'Close app menu']) { const button = page.getByRole('button', { name: label, exact: true }); if (await button.isVisible().catch(() => false)) await button.click(); }
    await settle(page, 12);
    await settle(page, 12);
    const spot = await page.evaluate(story => {
      const { scene, camera, gl } = window.__globe;
      const at = scene.getObjectByName(`planet:${story}`).getObjectByName('island-ground').getWorldPosition(new camera.position.constructor()).project(camera);
      const box = gl.domElement.getBoundingClientRect();
      return { x: box.left + (at.x + 1) / 2 * box.width, y: box.top + (1 - at.y) / 2 * box.height };
    }, story);
    await page.mouse.click(spot.x, spot.y);
    await settle(page, 6);
    await page.waitForSelector('.panel-risk', { timeout: 30000 });
    await settle(page, 6);
    results[name] = await page.evaluate(() => [...document.querySelectorAll('.panel-risk > p, .panel-risk > div, .panel-risk li')].map(each => each.textContent.replace(/\s+/g, ' ').trim()));
    await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 180000 });
    await page.close();
  }
  writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
});
