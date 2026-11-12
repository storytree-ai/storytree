// With an arc selected, the map's top row says how many parts and links its open work rings (3.108): storytree's own map (the
// code-rows snapshot and its survey) as the app opens it, with the open-work capture's active arc in the stand-in bridge. No
// arc selected shows no count; the arc's row clicked in the Arcs tab shows it, with no panel and with a story's panel open.
// `node --import tsx capture.mjs` (append --retake to write into src/view/evidence/open-work-count). It reads the count's words
// from the page, so "says what the rings count" is measured.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'open-work-count');
const { seed, survey } = captureSeed('code-rows');
const dist = buildFolder(here);
await buildCapture({ dist });

const at = '2026-11-12T00:00:00.000Z';
const record = (id, type, fields) => ({ id, type, fields, version: 1, createdAt: at, updatedAt: at });
const work = (id, arc, title, status, capabilities) => record(id, 'increment', { arc, title, objective: title, status, parked: at, capabilities });
// The open work names five capabilities of the seed (a closed increment's is not open work), and links no contract.
const tree = record('arc_tree', 'arc', { title: 'Capability tree: a map of capabilities', intent: 'See where work lands', endState: 'The look landed' });
const arcs = [{ arc: tree, state: 'active', questions: [], increments: [
  work('inc_ring', 'arc_tree', 'Open work: a hollow selection ring on arc select', 'active', ['capability_3c5ed8b3ca70', 'capability_6133809a4139', 'capability_8ffc78a4bad2', 'capability_d077e76e50d7']),
  work('inc_map', 'arc_tree', 'The map shows a transaction the library retries', 'proposal', ['capability_5a80222c88c4', 'capability_8ffc78a4bad2']),
  work('inc_3c', 'arc_tree', 'Rollout 2, step 3c: a picked link lights its way', 'closed', ['capability_33812c1d778b']),
] }];
const WORDS = "The arc's open work rings 5 parts and no link.";

const count = page => page.evaluate(() => document.querySelector('.forest-open-work')?.textContent ?? null);
const results = {};
await runCapture({
  folder: pictures, dist, seed, survey,
  answers: { boardArcs: async () => arcs, arcViews: async () => arcs },
  prepare: async ({ page, settle }) => {
    await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 180_000 });
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await settle(page);
  },
  views: [{
    name: 'no-arc-selected',
    measure: async ({ page }) => (results.none = await count(page)),
    expect: found => assert.equal(found, null),
  }, {
    name: 'arc-selected',
    prepare: async ({ page, settle }) => {
      await page.locator('[data-rail-tab="arcs"]').click().catch(() => {});
      await page.locator('[data-arc-select="arc_tree"]').click();
      await page.waitForFunction(() => document.querySelector('.forest-open-work') !== null, undefined, { timeout: 60_000 });
      await settle(page, 12);
    },
    measure: async ({ page }) => (results.selected = await count(page)),
    expect: found => assert.equal(found, WORDS),
  }, {
    name: 'arc-selected-top-row',
    prepare: async ({ page }) => {
      const box = await page.locator('.forest-top').boundingBox();
      await page.screenshot({ path: path.join(captureOutput(pictures), 'arc-selected-top-row.png'), clip: { x: 0, y: 0, width: box.x + box.width + 120, height: box.y + box.height + 60 } });
    },
    picture: false,
  }],
});
writeFileSync(path.join(captureOutput(pictures), 'measurements.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results));
