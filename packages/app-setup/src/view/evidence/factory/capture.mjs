// Pictures of Your factory in Settings → Projects (app setup 3.12): the folder in use, a folder refused, then one
// switched to with no approval step, on the actual desktop page with a fake bridge: no library or folder is touched.
// Run `node build.mjs`, then `node --import tsx capture.mjs`, from this folder (add --retake to write the pictures here).
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFolder, captureOutput, fakeBridge } from '../../../../../../apps/desktop/src/capture/index.ts'; // the shared stand-in bridge: run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const out = captureOutput(here); // pictures: a scratch folder unless run with --retake
const root = path.resolve(here, '../../../../../..');
const { chromium } = await import(path.join(root, 'node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs'));
const seed = JSON.parse(readFileSync(path.join(root, 'packages/forest/src/view/evidence/knowledge-under-islands/seed.json'), 'utf8'));
const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!['index.html', 'renderer.js', 'styles.css', 'arc-surface.css', 'app-setup.css', 'forest.css'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(readFileSync(buildFolder(here, name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

let browser;
try {
  browser = await chromium.launch({
    executablePath: '/home/mickh/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell',
    headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const bridge = fakeBridge({});
  await bridge.install(page);
  await page.addInitScript(({ data }) => {
    const copy = value => structuredClone(value);
    const projects = ['storytree'];
    // The first pick is a folder of notes, refused; the second the user's own factory repo, set up.
    const picks = [
      async () => { throw new Error('/home/you/notes holds other files and no plugins folder, so it is not a factory; choose an empty folder for storytree to set up, or one it set up before.'); },
      async () => ({ status: 'set up', folder: '/home/you/code/storytree-factory' }),
    ];
    let factory = { folder: '/home/you/.storytree/your-factory', chosen: false };
    window.storytreeAnswers = {
      factoryFolder: async () => copy(factory),
      chooseFactory: async () => { const answer = await picks.shift()(); factory = { folder: answer.folder, chosen: true }; return answer; },
      projectSelection: async () => copy({ projects, current: 'storytree' }),
      chooseProject: async () => copy({ projects, current: 'storytree' }),
      listProjects: async () => copy(projects), projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
      linesSince: async (_, cursor) => cursor === 0 ? copy(data.lines) : { lines: [], cursor: data.lines.cursor },
      frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [], readSurfaces: async () => undefined,
      codeSurvey: async () => ({}), projectSentence: async () => ({}),
    };
  }, { data: seed });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-gear', { timeout: 120000 });
  await page.waitForTimeout(4000);
  if (await page.evaluate(() => document.querySelector('#app-menu')?.matches(':popover-open'))) await page.keyboard.press('Escape');
  await page.click('.app-gear');
  await page.waitForSelector('#app-menu:popover-open');
  await page.locator('#app-menu').getByRole('button', { name: 'Projects', exact: true }).click();
  const factory = page.locator('.setup-factory');
  await factory.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('[data-factory-folder]')?.textContent !== '');
  const shot = name => page.locator('.app-menu-window').screenshot({ path: path.join(out, `${name}.png`) });
  await shot('1-storytrees-own');
  await page.getByRole('button', { name: 'Import or switch factory…' }).click();
  await page.getByRole('alert').filter({ hasText: 'cannot be your factory' }).waitFor();
  await shot('2-folder-refused');
  await page.getByRole('button', { name: 'Import or switch factory…' }).click();
  await page.waitForFunction(() => document.querySelector('[data-factory-folder]')?.textContent === '/home/you/code/storytree-factory');
  await shot('3-factory-switched');
  console.log(`Pictures in ${out}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
