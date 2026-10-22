// Pictures of the first-launch step that asks for the factory folder (app setup 3.10), on the actual desktop page with
// a fake bridge: no library or folder is touched. Run `node build.mjs`, then `node --import tsx capture.mjs`, from this
// folder (add --retake to write the pictures here).
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFolder, captureOutput, fakeBridge } from '../../../../../../apps/desktop/src/capture/index.ts'; // the shared stand-in bridge: run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const out = captureOutput(here);
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
    // The first pick is a folder of notes, refused; the second an empty folder, set up.
    const picks = [
      async () => { throw new Error('/home/mick/notes holds other files and no plugins folder, so it is not a factory; choose an empty folder for storytree to set up, or one it set up before.'); },
      async () => ({ status: 'set up', folder: '/home/mick/factory' }),
    ];
    let factory = null;
    window.storytreeAnswers = {
      factoryFolder: async () => factory,
      chooseFactory: async () => { const answer = await picks.shift()(); factory = answer.folder; return answer; },
      projectSelection: async () => copy({ projects, current: 'storytree' }),
      chooseProject: async () => copy({ projects, current: 'storytree' }),
      listProjects: async () => copy(projects), projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
      linesSince: async (_, cursor) => cursor === 0 ? copy(data.lines) : { lines: [], cursor: data.lines.cursor },
      frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [], readSurfaces: async () => undefined,
      codeSurvey: async () => ({}),
    };
  }, { data: seed });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  const step = page.getByRole('dialog', { name: 'Choose your factory folder' });
  await step.waitFor({ timeout: 120000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(out, '1-first-launch.png') });
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await page.getByRole('alert').filter({ hasText: 'cannot be your factory' }).waitFor();
  await page.screenshot({ path: path.join(out, '2-folder-refused.png') });
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await step.waitFor({ state: 'detached' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(out, '3-factory-chosen.png') });
  console.log(`Pictures in ${out}`);
} finally {
  await browser?.close();
  server.close();
}
