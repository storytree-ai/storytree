// Pictures of Delete a project in the app menu (ADR-0831), on the actual desktop page with a fake
// bridge: no library is touched. Run `node build.mjs`, then `node --import tsx capture.mjs`, from this folder.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBridge } from '../../../../../../apps/desktop/src/capture/index.ts'; // the shared stand-in bridge: run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../../..');
const { chromium } = await import(path.join(root, 'node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs'));
const seed = JSON.parse(readFileSync(path.join(root, 'packages/forest/src/view/evidence/knowledge-under-islands/seed.json'), 'utf8'));
const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!['index.html', 'renderer.js', 'styles.css', 'arc-surface.css', 'app-setup.css', 'forest.css'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(readFileSync(path.join(here, 'dist', name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

const WARNING = (project) => `Deleting “${project}” deletes its plan, notes and whole history from your shared library on Cloud SQL (storytree-498613:australia-southeast1:storytree-pg): every computer using that library loses it, at once. There is no undo except a snapshot.`;
let browser;
try {
  browser = await chromium.launch({
    executablePath: '/home/mickh/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell',
    headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  async function open(width, refuse) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const bridge = fakeBridge({});
    await bridge.install(page);
    process.once('exit', () => console.log('Bridge methods left to the stand-in:', bridge.defaulted.join(', ') || 'none'));
    await page.addInitScript(({ data, warnings, refuse }) => {
      const copy = value => structuredClone(value);
      let projects = ['storytree', 'downloads', 'old-blog'];
      const current = 'storytree';
      window.storytreeAnswers = {
        projectSelection: async () => copy({ projects, current }),
        chooseProject: async () => copy({ projects, current }),
        listProjects: async () => copy(projects), projectTree: async () => copy(data.tree),
        changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
        linesSince: async (_, cursor) => cursor === 0 ? copy(data.lines) : { lines: [], cursor: data.lines.cursor },
        frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [], readSurfaces: async () => undefined,
        codeSurvey: async () => ({}),
        deletableProjects: async () => projects.filter(p => p !== current).map(project => ({ project, warning: warnings[project] })),
        deleteProject: async (name) => {
          if (refuse) throw new Error(`A live session is working in “${name}”: 4f2eae60 (fix the blog's header). Wait until its claims end, then delete it.`);
          projects = projects.filter(p => p !== name);
          return { status: 'deleted', project: name, snapshot: `/home/you/.storytree/0.3/backups/${name}/2026-10-01T05-12-40-118Z.json` };
        },
      };
    }, { data: seed, warnings: { downloads: WARNING('downloads'), 'old-blog': WARNING('old-blog') }, refuse });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.app-gear', { timeout: 120000 });
    await page.waitForTimeout(1500);
    await page.click('.app-gear');
    await page.waitForSelector('#app-menu:popover-open');
    return page;
  }
  const shot = (page, name) => page.locator('.app-menu-window').screenshot({ path: path.join(here, `${name}.png`) });

  const page = await open(1440, false);
  await shot(page, '1-projects-rest');
  await page.click('[data-delete-project]');
  await page.waitForFunction(() => document.querySelector('[data-delete-project-warning]')?.textContent !== '');
  await shot(page, '2-dialog-open');
  await page.fill('[data-delete-project-typed]', 'downloa');
  await shot(page, '3-name-half-typed');
  await page.fill('[data-delete-project-typed]', 'downloads');
  await page.uncheck('[data-delete-project-snapshot]');
  await shot(page, '4-name-typed-snapshot-skipped');
  await page.check('[data-delete-project-snapshot]');
  await page.click('[data-delete-project-yes]');
  await page.waitForFunction(() => document.querySelector('[data-delete-project-status]')?.textContent.includes('deleted'));
  await shot(page, '5-deleted');
  await page.close();

  const refused = await open(1440, true);
  await refused.click('[data-delete-project]');
  await refused.waitForFunction(() => document.querySelector('[data-delete-project-warning]')?.textContent !== '');
  await refused.selectOption('[data-delete-project-choice]', 'old-blog');
  await refused.fill('[data-delete-project-typed]', 'old-blog');
  await refused.click('[data-delete-project-yes]');
  await refused.waitForFunction(() => document.querySelector('[data-delete-project-status]')?.getAttribute('role') === 'alert');
  await shot(refused, '6-refused-live-claim');
  await refused.close();

  const narrow = await open(760, false);
  await narrow.click('[data-delete-project]');
  await narrow.waitForFunction(() => document.querySelector('[data-delete-project-warning]')?.textContent !== '');
  await narrow.fill('[data-delete-project-typed]', 'downloads');
  await shot(narrow, '7-dialog-narrow');
  await narrow.close();
  console.log('Captured.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
