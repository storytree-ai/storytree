// The Arcs tab at rest (contract 3.41, ADR-1309 D4): the real desktop page on storytree's own live library, read with the app's
// own reads (the capture kit's liveAnswers), so its lanes are the library's waiting, queued and in-progress arcs as they stand. The
// live library need not hold a ranked arc or a ready one, so the seed ranks three of its live arcs (P1 the newest, P2 the two
// oldest, so priority's order is seen to cut across the state order) and adds one ranked arc with one increment ready to take. The rail's
// Arcs tab is put on show and nothing else is touched: the Active scope, no arc selected, no expansion open. A reader judges the
// pictures against 3.41's declared ask; the measurements say what the page drew, in the order it drew it, for the reader to check
// the pictures against. `node --import tsx capture.mjs` (append --retake to write into src/view/evidence/arcs-at-rest). Reads
// only: every write the page could ask keeps the stand-in's quiet answer.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from '@storytree/library';
import { route } from '../../../project-and-caller/src/routing/index.ts';
import { buildCapture, buildFolder, captureOutput, runCapture } from '../../../../apps/desktop/src/capture/index.ts';
import { liveAnswers } from '../../../../apps/desktop/src/capture/live.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../src/view/evidence', 'arcs-at-rest');
const dist = buildFolder(here);
await buildCapture({ dist });

const routed = route(path.join(here, '../../../..'));
if (routed.status !== 'routed') throw new Error(`no library to read: ${routed.message ?? routed.status}`);
const storytree = await connect(routed.library);
const live = await liveAnswers({ storytree, project: routed.project });
const READY = 'arc_seedready0001', at = new Date().toISOString();
const stamp = (id, type, fields) => ({ id, type, fields, version: 1, createdAt: at, updatedAt: at });
const ready = {
  arc: stamp(READY, 'arc', { title: 'A seeded ranked arc with one increment ready to take', intent: 'Seeded for the capture', endState: 'Its increment lands', priority: 2 }),
  state: 'active', questions: [],
  increments: [stamp('increment_seedready001', 'increment', { arc: READY, title: 'A seeded increment ready to take', objective: 'Seeded', status: 'proposal', parked: at })],
};
const seeded = {
  ...live.answers,
  boardArcs: async (project, closed) => {
    const arcs = await live.answers.boardArcs(project, closed);
    const shown = arcs.filter(({ state }) => state === 'active').sort((a, b) => a.arc.createdAt.localeCompare(b.arc.createdAt));
    const ranks = new Map([[shown.at(-1)?.arc.id, 1], [shown[0]?.arc.id, 2], [shown[1]?.arc.id, 2]]);
    return [...arcs.map(view => ranks.has(view.arc.id) ? { ...view, arc: { ...view.arc, fields: { ...view.arc.fields, priority: ranks.get(view.arc.id) } } } : view), ready];
  },
};

/** What the tab draws at rest, top to bottom: its scopes, then each lane's first line and its ovals' accessible label. */
const atRest = page => page.evaluate(() => {
  const text = el => el?.textContent.replace(/\s+/g, ' ').trim();
  return {
    tab: document.querySelector('[data-rail-tab][aria-selected="true"]')?.dataset.railTab,
    scopes: [...document.querySelectorAll('.arc-scopes [data-arc-scope]')].map(b => ({ scope: text(b), pressed: b.getAttribute('aria-pressed') === 'true' })),
    selected: [...document.querySelectorAll('[data-arc-select][aria-pressed="true"]')].map(b => b.dataset.arcSelect),
    expanded: document.querySelectorAll('.arc-caret[aria-expanded="true"], .arc-under, .arc-queued-under').length,
    openFolds: document.querySelectorAll('.arc-lanes details[open]').length,
    lanes: [...document.querySelectorAll('.arc-lanes .arc-row')].map(row => ({
      arc: row.dataset.arcId,
      chip: text(row.querySelector('.arc-lane-head .arc-chip:not(.arc-priority)')),
      priority: text(row.querySelector('.arc-lane-head .arc-priority')) ?? null,
      title: text(row.querySelector('.arc-lane-head .arc-title')),
      marks: [...row.querySelectorAll('.arc-lane-head .arc-mark')].map(m => ({ kind: [...m.classList].find(c => c.startsWith('arc-mark-'))?.slice(9), count: text(m.querySelector('.arc-mark-count')), hover: m.getAttribute('title') })),
      ovals: row.querySelectorAll('.arc-bars .arc-bar').length,
      ovalsLabel: row.querySelector('.arc-bars')?.getAttribute('aria-label'),
      queued: [...row.querySelectorAll('.arc-queue .arc-queue-chip')].map(c => text(c)),
    })),
  };
});
const results = {};
try {
  await runCapture({
    folder: pictures, dist, answers: seeded,
    prepare: async ({ page, settle }) => {
      await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 180_000, polling: 200 });
      for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
      await settle(page);
    },
    views: [{
      name: 'arcs-at-rest',
      prepare: async ({ page, settle }) => {
        await page.locator('[data-rail-tab="arcs"]').click();
        await page.locator('.arc-lanes .arc-row').first().waitFor({ timeout: 120_000 });
        await page.mouse.move(0, 0);
        await settle(page, 12);
      },
      measure: async ({ page, out }) => {
        await page.locator('.arc-scopes').locator('xpath=ancestor::*[.//*[contains(@class,"arc-lanes")]][1]').screenshot({ path: path.join(out, 'arcs-at-rest-rail.png') });
        return (results.atRest = await atRest(page));
      },
      // At rest as 3.41 has it: the Arcs tab on show, the Active scope pressed, no arc selected, no expansion or fold open.
      expect: found => assert.deepEqual({ tab: found.tab, pressed: found.scopes.filter(s => s.pressed).map(s => s.scope), selected: found.selected, expanded: found.expanded, openFolds: found.openFolds },
        { tab: 'arcs', pressed: ['Active'], selected: [], expanded: 0, openFolds: 0 }),
    }],
  });
} finally {
  await live.close();
  await storytree.close();
}
writeFileSync(path.join(captureOutput(pictures), 'measurements.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results));
