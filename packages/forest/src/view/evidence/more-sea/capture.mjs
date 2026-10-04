// Seeded, repeatable capture for the "more sea between islands, bigger land" increment: three forests on the
// actual desktop page (a five-story row, the same five as a chain, storytree's own 15 stories with their code
// survey from ../code-rows), each at its opening ("front") and after a programmatic quarter turn about the
// poles. Same seed, same 1440 x 960 viewport, nothing hand-panned. Run with <before|after>; --retake writes
// into this folder. Measures what can be counted before anyone looks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCapture } from '../../../../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2];
assert.ok(['before', 'after'].includes(label), 'pass a before/after build label');
const only = process.argv.slice(3).filter(arg => !arg.startsWith('--'));
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

/** Set the globe's own front (latitude 0, longitude 0) to face the viewer, then turn it `radians` about its poles, as the pointer's sideways drag does. The page's own opening eases to the islands' middle a few degrees differently on each load, so this is what makes a re-take read the same. */
const turnTo = radians => async ({ page, settle }) => {
  await page.evaluate(radians => {
    const { camera } = window.__globe, { onRotate } = window.__nav;
    const Q = camera.quaternion.constructor, V = camera.position.constructor;
    onRotate(camera.quaternion.clone().multiply(new Q().setFromAxisAngle(new V(0, 1, 0), radians)));
  }, radians);
  await settle(page);
};

/** In the page: each island's drawn land (ground triangles) in world space, the globe's radius and view, and the nameplates. */
const measureIn = page => page.evaluate(() => {
  const { scene, camera } = window.__globe;
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const V = camera.position.constructor;
  const shell = scene.getObjectByName('planet:shell');
  const centre = shell.getWorldPosition(new V());
  const radius = shell.geometry.parameters.radius * shell.getWorldScale(new V()).x;
  const eye = camera.position.clone().sub(centre).normalize();
  const islands = [];
  scene.traverse(object => {
    if (!object.name.startsWith('planet:story_')) return;
    let area = 0, visible = 0;
    const rim = [], a = new V(), b = new V(), c = new V();
    object.traverse(child => {
      if (child.name !== 'island-ground') return;
      child.traverse(mesh => {
        const at = mesh.geometry?.attributes?.position, index = mesh.geometry?.index;
        if (!at) return;
        const n = index ? index.count : at.count;
        const at3 = (v, i) => v.fromBufferAttribute(at, i).applyMatrix4(mesh.matrixWorld).sub(centre);
        for (let t = 0; t < n; t += 3) {
          const ids = [0, 1, 2].map(k => index ? index.getX(t + k) : t + k);
          at3(a, ids[0]); at3(b, ids[1]); at3(c, ids[2]);
          const normal = b.clone().sub(a).cross(c.clone().sub(a));
          const size = normal.length() / 2;
          area += size;
          // The triangle's share of the disc the globe covers on screen: its area times how squarely it faces the eye.
          const facing = a.clone().add(b).add(c).normalize().dot(eye);
          if (facing > 0) visible += size * facing;
        }
        // The coast: every drawn vertex, in the globe's frame, to measure coast-to-coast distance between islands.
        for (let i = 0; i < at.count; i += 7) rim.push(at3(new V(), i).toArray().map(x => +x.toFixed(2)));
      });
    });
    const direction = object.getWorldPosition(new V()).sub(centre).normalize();
    islands.push({ story: object.name.slice(7), area, visible, direction: direction.toArray(), facing: direction.dot(eye), rim });
  });
  const plates = [...document.querySelectorAll('.planet-nameplate[data-story-id]')].map(el => {
    const r = el.getBoundingClientRect(), style = getComputedStyle(el);
    return { title: el.textContent, box: [r.left, r.top, r.right, r.bottom].map(Math.round), shown: style.visibility !== 'hidden' && el.style.visibility !== 'hidden' && r.width > 0, facing: +(+el.dataset.facing || 0).toFixed(2), drop: +(el.dataset.drop ?? 0) };
  });
  return { radius, islands, plates, rotation: window.__nav.rotation.toArray().map(x => +x.toFixed(4)), zoom: +camera.zoom.toFixed(4) };
});

/** The land and sea counts a reader can check against the picture. */
function summarise(raw) {
  const { radius, islands, plates } = raw;
  const land = islands.reduce((sum, i) => sum + i.area, 0);
  const visible = islands.reduce((sum, i) => sum + i.visible, 0);
  // The nearest coast to each island's coast, as the straight line between their drawn vertices (a little under the arc along the globe).
  const gaps = islands.map((a, i) => {
    let nearest = Infinity;
    islands.forEach((b, j) => {
      if (i === j) return;
      for (const p of a.rim) for (const q of b.rim) nearest = Math.min(nearest, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
    });
    return nearest;
  }).filter(Number.isFinite);
  gaps.sort((m, n) => m - n);
  const shown = plates.filter(p => p.shown);
  const overlaps = shown.flatMap((a, i) => shown.slice(i + 1).filter(b => a.box[0] < b.box[2] && b.box[0] < a.box[2] && a.box[1] < b.box[3] && b.box[1] < a.box[3]).map(b => [a.title, b.title]));
  return {
    radius: +radius.toFixed(2), islands: islands.length, rotation: raw.rotation, zoom: raw.zoom,
    landUnits2: Math.round(land), landShareOfGlobe: +(land / (4 * Math.PI * radius * radius)).toFixed(4),
    landShareOfFace: +(visible / (Math.PI * radius * radius)).toFixed(4),
    nearestCoastGap: { least: +(gaps[0] ?? 0).toFixed(1), median: +(gaps[Math.floor(gaps.length / 2)] ?? 0).toFixed(1), mean: +(gaps.reduce((s, g) => s + g, 0) / Math.max(1, gaps.length)).toFixed(1) },
    islandAreas: Object.fromEntries(islands.map(i => [i.story, Math.round(i.area)])),
    namesShown: `${shown.length} of ${plates.length}`, nameOverlaps: overlaps,
  };
}

const results = { label, forests: {} };
for (const [name, { seed, survey }] of Object.entries(forests)) {
  if (only.length && !only.includes(name)) continue;
  results.forests[name] = {};
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
      if (name === 'storytree') await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('file:')) n++; }); return n > 0; }, undefined, { timeout: 60000 });
      for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
      await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
    },
    views: ['front', 'quarter'].map(view => ({
      name: `${label}-${name}-${view}`, picture: true,
      prepare: turnTo(view === 'quarter' ? Math.PI / 2 : 0),
      measure: async ({ page, browser, errors, settle }) => {
        await settle(page, 90); // let the opening ease and the nameplates catch up, so a re-take reads the same
        results.browser = await browser.version();
        // Read until two reads 250 ms apart agree on every name's box, so a re-take gives the same count.
        let raw = await measureIn(page);
        for (let tries = 0; tries < 20; tries++) {
          await page.waitForTimeout(250); await settle(page, 6);
          const next = await measureIn(page), same = JSON.stringify(next.plates) === JSON.stringify(raw.plates);
          raw = next;
          if (same) break;
        }
        const summary = summarise(raw);
        results.forests[name][view] = { errors, ...summary };
        console.log(label, name, view, JSON.stringify({ rot: summary.rotation, zoom: summary.zoom, radius: summary.radius, share: summary.landShareOfGlobe, face: summary.landShareOfFace, gap: summary.nearestCoastGap, names: summary.namesShown, overlaps: summary.nameOverlaps.length }));
        return undefined;
      },
    })),
  });
}
import { writeFileSync } from 'node:fs';
import { captureOutput } from '../../../../../../apps/desktop/src/capture/index.ts';
writeFileSync(path.join(captureOutput(here), `measurements-${label}${only.length ? '-' + only.join('-') : ''}.json`), JSON.stringify(results, null, 2) + '\n');
