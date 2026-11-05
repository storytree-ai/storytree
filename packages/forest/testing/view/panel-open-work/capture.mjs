// A capability's panel lists its open work in order (rollout 2, step 4c; ADR-1253 D1): the real desktop page on storytree's own
// live library, read with the app's own reads (the capture kit's liveAnswers), so the open work is the library's as it stands.
// The island of the capability with the most open work is clicked, then its card, whose detail lists the open increments naming
// it: the active one first, then the rest in parked order. `node --import tsx capture.mjs` (append --retake to write into
// src/view/evidence/panel-open-work). Reads only: every write the page could ask keeps the stand-in's quiet answer.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from '@storytree/library';
import { route } from '@storytree/project-and-caller/routing';
import { buildCapture, buildFolder, captureOutput, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { liveAnswers } from '../../../../../apps/desktop/src/capture/live.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'panel-open-work');
const dist = buildFolder(here);
await buildCapture({ dist });

const routed = route(path.join(here, '../../../../..'));
if (routed.status !== 'routed') throw new Error(`no library to read: ${routed.message ?? routed.status}`);
const storytree = await connect(routed.library);
const tree = await (await storytree.openProject(routed.project)).projectTree();
// The capability with the most open work as the library stands, one with an active increment before one without.
const [story, capability] = tree.stories.flatMap(each => each.capabilities.map(one => [each, one]))
  .filter(([, one]) => (one.openWork?.length ?? 0) >= 2)
  .sort(([, a], [, b]) => Number(b.openWork.some(({ active }) => active)) - Number(a.openWork.some(({ active }) => active)) || b.openWork.length - a.openWork.length)[0] ?? [];
assert.ok(capability !== undefined, 'some capability has two or more open increments to list');
const expected = capability.openWork;

const listed = page => page.evaluate(() => [...document.querySelectorAll('.story-panel .panel-open-work li')].map(li => ({
  increment: li.dataset.incrementId, title: li.childNodes[0].textContent, active: li.classList.contains('active'),
})));
const live = await liveAnswers({ storytree, project: routed.project });
const results = { story: story.title, capability: capability.title, library: expected };
try {
  await runCapture({
    folder: pictures, dist, answers: live.answers,
    prepare: async ({ page, settle }) => {
      await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 180_000, polling: 200 });
      for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
      await settle(page);
    },
    views: [{
      name: 'capability-open-work',
      prepare: async ({ page, settle }) => {
        const island = await page.evaluate(id => window.storytreeGlobe.islands().find(i => i.story === id), story.id);
        await page.mouse.click(island.x, island.y);
        await page.waitForFunction(id => document.body.dataset.selected === id, story.id, { timeout: 60_000 });
        const card = page.locator(`.story-panel [data-capability-id="${capability.id}"]`).first();
        await card.waitFor({ timeout: 60_000 });
        await card.focus();
        await page.keyboard.press('Enter');
        const list = page.locator('.story-panel .panel-open-work');
        await list.waitFor({ timeout: 30_000 });
        await page.locator(`.story-panel .panel-detail[data-capability-id="${capability.id}"]`).scrollIntoViewIfNeeded();
        await settle(page, 12);
      },
      measure: async ({ page, out }) => {
        await page.locator('.story-panel').screenshot({ path: path.join(out, 'capability-open-work-panel.png') });
        return (results.panel = await listed(page));
      },
      expect: found => assert.deepEqual(found, expected.map(({ increment, title, active }) => ({ increment, title, active: active === true }))),
    }],
  });
} finally {
  await live.close();
  await storytree.close();
}
writeFileSync(path.join(captureOutput(pictures), 'measurements.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results));
