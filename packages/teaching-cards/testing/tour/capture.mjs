// The first-time cards are offered as a tour and never block the map (increment_b29c14f6f748; contracts 3.5, 3.7, 3.8): the real
// desktop page on the eight-story forest snapshot, opened as a fresh install would, with no answer to the tour kept. Three views:
// the ask in its corner, the plan's card at the Arcs tab after "Show me", the story's card tied to its island after "Got it",
// again with More open, and the map clear after "End tour".
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
  // The bar's project switcher and the globe's Stories/Library switch, which no card covers (increment_176e36671e3c).
  const switches = [...document.querySelectorAll('.app-factory, .forest-views')].map(one => one.getBoundingClientRect()).filter(one => one.width > 0)
    .map(({ left, top, right, bottom }) => ({ left, top, right, bottom }));
  // The card's tie to its thing: a ring round it and a line to the card (3.10).
  const ties = card.querySelectorAll('.teaching-card-ring, .teaching-card-tie').length;
  const shown = card.querySelector('.teaching-card-actions')?.getBoundingClientRect();
  const actions = shown === undefined ? undefined : { left: shown.left, top: shown.top, right: shown.right, bottom: shown.bottom };
  return { cards: document.querySelectorAll('.teaching-card').length, kind: card.dataset.kind, card: { left, top, right, bottom }, island: island?.box, islands: drawn.map(one => one.box), switches, ties, actions };
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
      expect: found => {
        assert.deepEqual([found.cards, found.kind], [1, 'arc']);
        assert.equal(found.switches.length, 2, 'the project switcher and the Stories/Library switch are both on show');
        assert.ok(found.switches.every(one => apart(found.card, one)), 'the plan card covers neither switch');
      },
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
        assert.ok(found.switches.every(one => apart(found.card, one)), 'and off both switches');
        assert.equal(found.ties, 2, 'tied to its island by a ring and a line');
      },
    },
    {
      name: 'the-story-card-with-more-open',
      prepare: async ({ page, settle }) => {
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await settle(page);
      },
      measure: ({ page }) => measure(page),
      expect: found => {
        assert.deepEqual([found.cards, found.kind], [1, 'story']);
        assert.ok(apart(found.card, found.island), 'taller, the story card still stays off its island');
        assert.ok(found.islands.every(box => apart(found.card, box)), 'and off every other island drawn');
        assert.equal(found.ties, 2, 'and is still tied to it');
        assert.ok(found.actions.top >= found.card.top && found.actions.bottom <= found.card.bottom, 'its buttons on show, its depth scrolling above them');
      },
    },
    {
      name: 'the-story-card-scrolled-to-its-end',
      prepare: async ({ page, settle }) => {
        await page.locator('.teaching-card [data-depth]').evaluate(element => { element.scrollTop = element.scrollHeight; });
        await until(page, () => !document.querySelector('.teaching-card [data-depth]').hasAttribute('data-more-below'));
        await settle(page);
      },
      measure: ({ page }) => measure(page),
      expect: found => {
        assert.equal(found.ties, 2, 'still tied to its island');
        assert.ok(found.actions.top >= found.card.top && found.actions.bottom <= found.card.bottom, 'the depth read to its end, its buttons still on show');
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
