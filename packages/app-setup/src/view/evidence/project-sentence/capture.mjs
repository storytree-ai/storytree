// Pictures of the project's sentence moving from the map into Settings → Projects (app setup 3.9), on the actual
// desktop page with a fake bridge: no library is touched. Run `node build.mjs`, then `node --import tsx capture.mjs`,
// from this folder. The before pictures are the map's old top line, kept from the forest's anchor-line capture.
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

const ANCHOR = { what: 'a software factory', audience: 'people building software with coding agents, and the agents themselves' };
let browser;
try {
  browser = await chromium.launch({
    executablePath: '/home/mickh/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell',
    headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const bridge = fakeBridge({});
  await bridge.install(page);
  await page.addInitScript(({ data, anchor }) => {
    const copy = value => structuredClone(value);
    const projects = ['storytree', 'old-blog'];
    let sentence = {};
    window.storytreeAnswers = {
      projectSelection: async () => copy({ projects, current: 'storytree' }),
      chooseProject: async () => copy({ projects, current: 'storytree' }),
      listProjects: async () => copy(projects), projectTree: async () => copy({ ...data.tree, anchor }),
      changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
      linesSince: async (_, cursor) => cursor === 0 ? copy(data.lines) : { lines: [], cursor: data.lines.cursor },
      frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [], readSurfaces: async () => undefined,
      codeSurvey: async () => ({}),
      projectSentence: async () => copy(sentence),
      setProjectSentence: async (_, what, audience) => {
        sentence = Object.fromEntries(Object.entries({ what: what.trim(), audience: audience.trim() }).filter(([, half]) => half !== ''));
        return copy(sentence);
      },
    };
  }, { data: seed, anchor: ANCHOR });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-gear', { timeout: 120000 });
  await page.waitForTimeout(4000);
  // The forest, with the project's anchor written in the library, and no sentence drawn over it.
  if (await page.evaluate(() => document.querySelector('#app-menu')?.matches(':popover-open'))) await page.keyboard.press('Escape');
  for (const name of ['Close help']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  await page.mouse.move(2, 2);
  await page.waitForTimeout(1500);
  if (await page.locator('.forest-anchor').count() !== 0) throw new Error('the map still draws the project sentence');
  await page.screenshot({ path: path.join(out, 'after-forest-no-sentence.png') });

  await page.click('.app-gear');
  await page.waitForSelector('#app-menu:popover-open');
  await page.locator('#app-menu').getByRole('button', { name: 'Projects', exact: true }).click();
  await page.waitForSelector('[data-project-sentence-what]');
  const shot = name => page.locator('.app-menu-window').screenshot({ path: path.join(out, `${name}.png`) });
  await shot('after-1-settings-unsaid');
  await page.fill('[data-project-sentence-what]', ANCHOR.what);
  await shot('after-2-settings-half-typed');
  await page.fill('[data-project-sentence-audience]', ANCHOR.audience);
  await page.click('[data-project-sentence-save]');
  await page.waitForFunction(() => document.querySelector('[data-project-sentence-status]')?.textContent === 'Saved.');
  await shot('after-3-settings-saved');
  console.log('Captured.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
