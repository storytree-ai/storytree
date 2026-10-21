// The app bar's project dropdown (app 2.1, 2.15): every project with the factory marked, and "New project…" opening
// Projects to add one, on the real desktop page over the eight-story forest seed. Run with node --import tsx; pass
// --retake to replace the committed pictures.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, captureSeed, runCapture } from '../../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
await buildCapture({ dist });
const { seed, survey } = captureSeed('forest');
const product = seed.projects[0], factory = 'factory';
const projects = [factory, product, 'garden-site'];
let current = product;
let picks = 0;
const selection = () => ({ projects, current, factory: current === factory ? { place: 'factory', product } : { place: 'product', factory } });
await runCapture({
  folder: here, dist, seed, survey,
  answers: {
    projectSelection: async () => selection(),
    chooseProject: async name => { current = name; return selection(); },
    listProjects: async () => projects,
    projectTree: async name => name === product ? seed.tree : { stories: [], arcs: [] },
    changesSince: async (name, cursor) => name === product ? (cursor === 0 ? seed.changes : { changes: [], cursor: seed.changes.cursor }) : { changes: [], cursor: 0 },
    // The folder picker is the operating system's; here it is cancelled, so the project on show stays.
    addProject: async () => { picks++; return null; },
  },
  prepare: async ({ page }) => {
    await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 120000 });
    for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  },
  views: [
    { name: 'bar',
      measure: async ({ page }) => page.evaluate(() => ({
        project: document.body.dataset.project,
        options: [...document.querySelectorAll('.app-bar #project option')].map(o => o.textContent),
        selected: document.querySelector('#project').value,
        inOverlay: document.querySelectorAll('#app-menu select#project').length,
      })) },
    { name: 'dropdown-open', prepare: async ({ page }) => { await page.locator('#project').click(); } },
    { name: 'new-project',
      prepare: async ({ page }) => {
        await page.keyboard.press('Escape');
        await page.selectOption('#project', { label: 'New project…' });
        await page.locator('#app-projects:not([hidden])').waitFor();
      },
      measure: async ({ page }) => ({ picks, ...(await page.evaluate(() => ({ menuOpen: document.querySelector('#app-menu').matches(':popover-open'), selected: document.querySelector('#project').value }))) }) },
  ],
});
