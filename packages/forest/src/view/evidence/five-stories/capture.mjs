// Three seeds and their opening views on the actual page, using the shared runner.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCapture } from '../../../../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2];
assert.ok(['before', 'after'].includes(label), 'pass a before/after build label');
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

const results = { label, forests: {} };
for (const [name, { seed, survey }] of Object.entries(forests)) {
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
      for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
      await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
    },
    views: [{
      name: `${label}-${name}`, measurement: `measurements-${label}.json`,
      measure: async ({ page, browser, errors }) => {
        results.browser = await browser.version();
        const plates = await page.evaluate(() => [...document.querySelectorAll('.planet-nameplate[data-story-id]')].map(el => {
          const r = el.getBoundingClientRect(), style = getComputedStyle(el);
          return { title: el.textContent, box: [r.left, r.top, r.right, r.bottom].map(Math.round), shown: style.visibility !== 'hidden' && el.style.visibility !== 'hidden' && r.width > 0, facing: +(+el.dataset.facing || 0).toFixed(2), drop: +(el.dataset.drop ?? 0) };
        }));
        const shown = plates.filter(p => p.shown);
        const overlaps = shown.flatMap((a, i) => shown.slice(i + 1).filter(b => a.box[0] < b.box[2] && b.box[0] < a.box[2] && a.box[1] < b.box[3] && b.box[1] < a.box[3]).map(b => [a.title, b.title]));
        results.forests[name] = { errors, plates, shown: `${shown.length} of ${plates.length}`, overlaps };
        console.log(label, name, 'shown', `${shown.length} of ${plates.length}`, 'overlapping pairs', overlaps.length);
        return results;
      },
    }],
  });
}
