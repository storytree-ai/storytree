// Seed and views for the shared desktop capture runner. Run with <before|after>; --retake explicitly
// replaces committed evidence. Measures the opening view on screen: each row's band of island heights,
// which bands overlap, and every dependency in view whose dependent is drawn below what it depends on.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCapture } from '../../../../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2];
assert.ok(['before', 'after'].includes(label), 'pass a before/after build label');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(here, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(here, 'survey.json'), 'utf8'));

/**
 * Each story's row in the seed as the app ranks it (longest path over the survey's package dependencies where it
 * names them, ADR-0840 D2, else capability dependsOn rolled up to stories), and what each depends on.
 */
function ranks(tree) {
  const owner = new Map(tree.stories.flatMap(s => s.capabilities.map(c => [c.id, s.id])));
  const known = new Set(tree.stories.map(s => s.id));
  const on = new Map(tree.stories.map(s => [s.id, survey[s.id]?.dependsOn?.filter(d => known.has(d) && d !== s.id)
    ?? [...new Set(s.capabilities.flatMap(c => c.dependsOn.map(d => owner.get(d)).filter(o => o && o !== s.id)))]]));
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

/** Where each island's middle is drawn, in CSS pixels down from the canvas top, and whether it faces the eye. */
const onScreen = (page, ids) => page.evaluate(ids => {
  const { scene, camera, size } = window.__globe, V = camera.position.constructor;
  const toEye = camera.quaternion.clone().invert();
  const turn = window.__nav.rotation;
  return ids.map(id => {
    const world = scene.getObjectByName(`planet:${id}`).getWorldPosition(new V());
    const p = world.clone().project(camera);
    const own = world.clone().applyQuaternion(turn.clone().invert()).normalize();
    return { id, x: (p.x + 1) * size.width / 2, y: (1 - p.y) * size.height / 2,
      facing: world.clone().normalize().applyQuaternion(toEye).z, latitude: Math.asin(own.y) * 180 / Math.PI };
  });
}, ids);

function measure(islands, browser, errors, warnings, turn) {
  const { rank, on } = ranks(seed.tree);
  const titles = new Map(seed.tree.stories.map(s => [s.id, s.title]));
  const seen = islands.filter(i => i.facing > 0).map(i => ({ ...i, title: titles.get(i.id), rank: rank.get(i.id) }));
  const rows = [...new Set(seen.map(i => i.rank))].sort((a, b) => a - b).map(row => {
    const ys = seen.filter(i => i.rank === row).map(i => i.y);
    return { row, top: +Math.min(...ys).toFixed(1), bottom: +Math.max(...ys).toFixed(1) };
  });
  // Two rows overlap in height when the lower row's highest island is drawn above the upper row's lowest.
  const rowBandsOverlapping = rows.flatMap((a, i) => rows.slice(i + 1).filter(b => a.top < b.bottom).map(b => `${a.row}/${b.row}`));
  const byId = new Map(seen.map(i => [i.id, i]));
  const edges = seen.flatMap(i => on.get(i.id).filter(d => byId.has(d)).map(d => ({ from: i.title, on: titles.get(d), up: i.y < byId.get(d).y })));
  return { label, browser, errors, warnings: [...new Set(warnings)], turn, rows, rowBandsOverlapping,
    edgesInView: `${edges.filter(e => e.up).length} of ${edges.length} point up`, south: edges.filter(e => !e.up),
    islands: seen.sort((a, b) => a.rank - b.rank || a.x - b.x).map(i => ({ title: i.title, rank: i.rank, x: +i.x.toFixed(1), y: +i.y.toFixed(1), facing: +i.facing.toFixed(2), latitude: +i.latitude.toFixed(1) })) };
}

const ids = seed.tree.stories.map(s => s.id);
await runCapture({
  folder: here, dist: path.join(here, 'dist', label), seed, survey,
  prepare: async ({ page, errors, failed, warnings }) => {
    await page.waitForFunction(ids => {
      const state = window.__globe;
      if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
      return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
    }, ids, { timeout: 120000 }).catch(async error => {
      console.error(JSON.stringify({ state: await page.evaluate(() => document.body.dataset.state + ' | ' + (document.querySelector('.empty')?.innerText ?? '')), errors, urls: failed, warnings: warnings.slice(0, 5) }));
      throw error;
    });
    await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('file:')) n++; }); return n > 0; }, undefined, { timeout: 60000 });
    for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  },
  views: [
    { name: `${label}-opening`,
      measurement: `measurements-${label}.json`,
      measure: async ({ page, browser, errors, warnings }) => {
        const turn = await page.evaluate(() => {
          // The globe's own turn, the eye's taken off: tilt is how far north leans toward the eye.
          const { camera } = window.__globe, V = camera.position.constructor;
          const north = new V(0, 1, 0).applyQuaternion(window.__nav.rotation).applyQuaternion(camera.quaternion.clone().invert());
          return { tiltDegrees: +(Math.asin(Math.max(-1, Math.min(1, north.z))) * 180 / Math.PI).toFixed(1) };
        });
        return measure(await onScreen(page, ids), await browser.version(), errors, warnings, turn);
      },
      expect: results => {
        assert.deepEqual(results.errors, []);
        console.log(label, results.turn, results.rowBandsOverlapping, results.edgesInView, JSON.stringify(results.south));
      },
    },
  ],
});
