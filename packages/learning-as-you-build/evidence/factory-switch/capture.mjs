// The app bar's switch to the user's factory, and the factory's card on the first switch, on the real desktop page over
// the eight-story forest seed as the product, beside a factory holding a role, a note and a check. Run with
// node --import tsx; pass --retake to replace the committed pictures.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, captureSeed, runCapture } from '../../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
await buildCapture({ dist });
const { seed, survey } = captureSeed('forest');
const product = seed.projects[0], factory = 'factory';
const projects = [factory, product];
let current = product;
const place = name => name === factory ? { place: 'factory', product } : { place: 'product', factory };
const selection = () => ({ projects, current, factory: place(current) });
const record = (type, recordId, title) => ({ type, recordId, action: 'created', record: { fields: { title } } });
const factoryChanges = { changes: [record('agent', 'agent_builder', 'The session that builds'), record('principle', 'principle_small', 'Slow growth'), record('check', 'check_red', 'A test fails without its behaviour')], cursor: 3 };
const card = page => page.locator('.teaching-card');
await runCapture({
  folder: here, dist, seed, survey, teaching: 'shown',
  answers: {
    projectSelection: async () => selection(),
    chooseProject: async name => { current = name; return selection(); },
    listProjects: async () => projects,
    projectTree: async name => name === factory ? { stories: [], arcs: [] } : seed.tree,
    changesSince: async (name, cursor) => name === factory ? (cursor === 0 ? factoryChanges : { changes: [], cursor: 3 })
      : cursor === 0 ? seed.changes : { changes: [], cursor: seed.changes.cursor },
  },
  prepare: async ({ page }) => {
    await page.waitForFunction(() => document.body.dataset.state === 'ready' && document.querySelector('.teaching-card') !== null, undefined, { timeout: 120000 });
    for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    // The product's own first cards are this look's background: each is put away.
    while (await card(page).count() > 0) await card(page).getByRole('button', { name: 'Got it' }).click();
  },
  views: [
    { name: 'bar-on-product',
      measure: async ({ page }) => page.evaluate(() => ({ project: document.body.dataset.project, bar: document.querySelector('.app-factory')?.textContent })) },
    { name: 'factory-card',
      prepare: async ({ page }) => {
        await page.getByRole('button', { name: 'Your factory' }).click();
        await page.waitForFunction(() => document.body.dataset.project === 'factory' && document.querySelector('.teaching-card') !== null, undefined, { timeout: 120000 });
      },
      measure: async ({ page }) => page.evaluate(() => { const c = document.querySelector('.teaching-card'); return { project: document.body.dataset.project, bar: document.querySelector('.app-factory')?.textContent, kind: c?.dataset.kind, corner: c?.classList.contains('teaching-card-corner'), left: c?.style.left, top: c?.style.top }; }) },
    { name: 'factory-more', prepare: async ({ page }) => { await card(page).getByRole('button', { name: 'More' }).click(); } },
    { name: 'factory-parts',
      prepare: async ({ page }) => { await card(page).getByRole('button', { name: 'Got it' }).click(); },
      measure: async ({ page }) => page.evaluate(() => { const c = document.querySelector('.teaching-card'); return { kind: c?.dataset.kind, corner: c?.classList.contains('teaching-card-corner'), face: document.querySelector('[data-globe-switch][aria-pressed="true"]')?.textContent, left: c?.style.left, top: c?.style.top }; }) },
    { name: 'back-on-product',
      prepare: async ({ page }) => {
        while (await card(page).count() > 0) await card(page).getByRole('button', { name: 'Got it' }).click();
        await page.getByRole('button', { name: /Back to/ }).click();
        await page.waitForFunction(p => document.body.dataset.project === p && document.body.dataset.state === 'ready', product, { timeout: 120000 });
        await page.getByRole('button', { name: 'Your factory' }).click();
        await page.waitForFunction(() => document.body.dataset.project === 'factory' && document.body.dataset.state === 'ready', undefined, { timeout: 120000 });
      },
      // The second switch to the factory shows no card: it was taught once.
      measure: async ({ page }) => page.evaluate(() => ({ project: document.body.dataset.project, cards: document.querySelectorAll('.teaching-card').length })),
      picture: false },
  ],
});
