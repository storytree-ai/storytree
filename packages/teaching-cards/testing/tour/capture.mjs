// The first-time cards are offered as a tour and never block the map (increment_b29c14f6f748; contracts 3.5, 3.7, 3.8): the real
// desktop page on the eight-story forest snapshot, opened as a fresh install would, with no answer to the tour kept. Three views:
// the ask in its corner, the plan's card at the Arcs tab after "Show me", the story's card beside its island after "Got it",
// and the map clear after "End tour".
// `node --import tsx capture.mjs` (append --retake to write into src/view/evidence/tour). Measures each card's box against the
// box of the island it explains and of every other island drawn, so "never over an island" is measured, not only seen.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureSeed, runCapture } from '../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../src/view/evidence', 'tour');
const { seed } = captureSeed('forest');
const dist = buildFolder(here);
await buildCapture({ dist });

const until = (page, predicate, arg) => page.waitForFunction(predicate, arg, { timeout: 180_000, polling: 200 });
/** The card on show, its box, and the box of the island it explains when it is on one. */
const measure = page => page.evaluate(() => {
  const card = document.querySelector('.teaching-card');
  if (card === null) return { cards: 0 };
  const { left, top, right, bottom } = card.getBoundingClientRect();
  const story = document.body.dataset.teachingStory;
  const drawn = window.storytreeGlobe.islands().filter(one => one.visible && one.box !== undefined);
  const island = drawn.find(one => one.story === story);
  return { cards: document.querySelectorAll('.teaching-card').length, kind: card.dataset.kind, card: { left, top, right, bottom }, island: island?.box, islands: drawn.map(one => one.box) };
});
const apart = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;

await runCapture({
  folder: pictures, dist, seed, teaching: 'shown',
  prepare: async ({ page, settle }) => {
    await until(page, () => document.body.dataset.state === 'ready' && window.storytreeGlobe?.still());
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await until(page, () => document.querySelector('.teaching-card') !== null);
    await settle(page);
  },
  views: [
    { name: 'the-ask', measure: ({ page }) => measure(page), expect: found => assert.deepEqual([found.cards, found.kind], [1, 'tour'], 'only the ask shows') },
    {
      name: 'the-plan-card-after-show-me',
      prepare: async ({ page, settle }) => {
        await page.getByRole('button', { name: 'Show me', exact: true }).click();
        await until(page, () => document.querySelector('.teaching-card')?.dataset.kind === 'arc');
        await settle(page);
      },
      measure: ({ page }) => measure(page),
      expect: found => assert.deepEqual([found.cards, found.kind], [1, 'arc']),
    },
    {
      name: 'a-story-card-beside-its-island',
      prepare: async ({ page, settle }) => {
        // The story's card: the island it explains is the forest's first story.
        await page.evaluate(story => { document.body.dataset.teachingStory = story; }, seed.tree.stories[0].id);
        await page.getByRole('button', { name: 'Got it', exact: true }).click();
        await until(page, () => document.querySelector('.teaching-card')?.dataset.kind === 'story');
        await settle(page);
      },
      measure: ({ page }) => measure(page),
      expect: found => {
        assert.deepEqual([found.cards, found.kind], [1, 'story']);
        assert.ok(found.island !== undefined, 'its island is drawn');
        assert.ok(apart(found.card, found.island), 'the story card stays off its island');
        assert.ok(found.islands.every(box => apart(found.card, box)), 'and off every other island drawn');
      },
    },
    {
      name: 'the-map-clear-after-end-tour',
      prepare: async ({ page, settle }) => {
        await page.getByRole('button', { name: 'End tour', exact: true }).click();
        await settle(page);
      },
      measure: ({ page }) => measure(page),
      expect: found => assert.equal(found.cards, 0, 'no card left on the map'),
    },
  ],
});
