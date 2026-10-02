// Seed and views for the shared desktop capture runner. Run with <before|after>
// (code-rows also accepts nudged); --retake explicitly replaces committed evidence.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCapture } from '../../../../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2];
assert.ok(['before', 'after', 'nudged'].includes(label), 'pass a before/after build label');
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

await runCapture({
  folder: here, dist: path.join(here, 'dist', label), seed, survey,
  prepare: async ({ page, errors, failed, warnings }) => {
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
  },
  views: [
    { name: `${label}-opening` },
    { name: `${label}-front`,
      prepare: async ({ page }) => {
        await page.evaluate(() => { window.__nav.onRotate(window.__globe.camera.quaternion.clone()); });
      },
      measurement: `measurements-${label}.json`,
      measure: async ({ page, browser, errors, warnings }) => {
        const islands = await page.evaluate(ids => {
          const { scene, camera } = window.__globe, V = camera.position.constructor;
          return ids.map(id => {
            // Back into the globe's own frame: undo the eye the globe was turned by.
            const p = scene.getObjectByName(`planet:${id}`).getWorldPosition(new V()).applyQuaternion(window.__nav.rotation.clone().invert()).normalize();
            return { id, latitude: Math.asin(p.y) * 180 / Math.PI, longitude: Math.atan2(p.x, p.z) * 180 / Math.PI };
          });
        }, seed.tree.stories.map(s => s.id));
        const { rank, on } = ranks(seed.tree);
        const titles = new Map(seed.tree.stories.map(s => [s.id, s.title]));
        const results = { label, browser: await browser.version(), errors, warnings: [...new Set(warnings)],
          islands: islands.map(i => ({ title: titles.get(i.id), rank: rank.get(i.id), dependsOn: on.get(i.id).map(d => titles.get(d)), latitude: +i.latitude.toFixed(1), longitude: +i.longitude.toFixed(1) }))
            .sort((a, b) => a.rank - b.rank || a.longitude - b.longitude) };
        // Every dependency edge, and whether the dependent's island sits north of its dependency's.
        results.edges = results.islands.flatMap(i => i.dependsOn.map(d => ({ from: i.title, on: d, north: i.latitude > results.islands.find(o => o.title === d).latitude })));
        results.edgesNorth = `${results.edges.filter(e => e.north).length} of ${results.edges.length}`;
        return results;
      },
      expect: results => {
        assert.deepEqual(results.errors, []);
        console.log(results.edgesNorth, JSON.stringify(results.islands.map(i => [i.title, i.rank, i.latitude, i.longitude])));
      },
    },
    { name: `${label}-wide`, prepare: async ({ page }) => {
      await page.evaluate(() => {
        const { camera, invalidate } = window.__globe;
        camera.zoom *= 0.7; camera.updateProjectionMatrix(); invalidate();
      });
    } },
  ],
});
