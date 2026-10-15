// The teaching cards on the real desktop page, over the eight-story forest seed: the first card, the
// story's card beside its island, its More, and the journal in Help. Run with node --import tsx; pass
// --retake to replace the committed pictures.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, captureSeed, runCapture } from '../../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
await buildCapture({ dist });
const card = page => page.locator('.teaching-card');
const next = async page => { await card(page).getByRole('button', { name: 'Got it' }).click(); };
await runCapture({
  folder: here, dist, ...captureSeed('forest'), teaching: 'shown',
  prepare: async ({ page }) => {
    await page.waitForFunction(() => document.body.dataset.state === 'ready' && document.querySelector('.teaching-card') !== null, undefined, { timeout: 120000 });
    for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    // Let the globe hand over its controls, so the story's card can find its island.
    await page.waitForFunction(() => (window.storytreeGlobe?.islands() ?? []).length > 0, undefined, { timeout: 60000 });
  },
  views: [
    { name: 'first-card', measure: async ({ page }) => page.evaluate(() => document.querySelector('.teaching-card')?.dataset.kind) },
    { name: 'story-card',
      prepare: async ({ page }) => { while (await card(page).getAttribute('data-kind') !== 'story') await next(page); },
      measure: async ({ page }) => page.evaluate(() => { const c = document.querySelector('.teaching-card'); return { kind: c.dataset.kind, corner: c.classList.contains('teaching-card-corner'), left: c.style.left, top: c.style.top }; }) },
    { name: 'story-more', prepare: async ({ page }) => { await card(page).getByRole('button', { name: 'More' }).click(); } },
    { name: 'journal',
      prepare: async ({ page }) => {
        await page.getByRole('button', { name: /App menu/ }).first().click();
        await page.locator('[data-app-section="help"]').click();
        await page.locator('[data-journal-entry="story"]').click();
        await page.locator('[data-journal-card]').scrollIntoViewIfNeeded();
      },
      measure: async ({ page }) => page.evaluate(() => [...document.querySelectorAll('[data-journal-entry]')].map(e => e.dataset.journalEntry)) },
    // The seed has no decision for its card to fire on, so the journal is told one was seen, and reopened to show its depth.
    { name: 'decision-more',
      prepare: async ({ page }) => {
        await page.evaluate(() => {
          const key = 'storytree.teaching.seen.v1';
          localStorage.setItem(key, JSON.stringify([...JSON.parse(localStorage.getItem(key) ?? '[]'), { kind: 'decision', at: new Date().toISOString() }]));
        });
        // Help is still open from the journal's view: choosing it again opens the journal afresh.
        await page.locator('[data-app-section="help"]').click();
        await page.locator('[data-journal-entry="decision"]').click();
        await page.locator('[data-journal-card] .tour-diagram').scrollIntoViewIfNeeded();
      },
      measure: async ({ page }) => page.evaluate(() => { const svg = document.querySelector('[data-journal-card] svg'); const box = svg?.getBoundingClientRect(); return { kind: document.querySelector('[data-journal-card]')?.dataset.kind, drawing: box ? { width: Math.round(box.width), height: Math.round(box.height) } : null }; }) },
  ],
});
