// The map's anchor line (3.67, ADR-1085 D1): the project's sentence at the top of the map, with what the plan has not said.
// Reuses the rows capture's build, seed and survey: `node ../rows/build.mjs <checkout> <label>`, then
// `node --import tsx capture.mjs <label>`. The seed's tree is given storytree's anchor (ADR-1085 D2) for the "said" shot,
// none for the "unsaid" shot; its stories name no audience, as storytree's do today. Writes measurements-<label>.json.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const rows = path.join(here, '../rows');
const label = process.argv.slice(2).find(arg => arg !== '--retake') ?? 'after';
const dist = path.join(rows, 'dist', label);
const seed = JSON.parse(gunzipSync(readFileSync(path.join(rows, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(rows, 'survey.json'), 'utf8'));
const ANCHOR = { what: 'a software factory', audience: 'people building software with coding agents, and the agents themselves' };

await withCapture({ folder: here, dist }, async ({ browser, out, origin, settle }) => {
  const results = { label };
  for (const [shot, anchor] of [['said', ANCHOR], ['unsaid', undefined]]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const bridge = fakeBridge({});
    await bridge.install(page);
    const tree = anchor === undefined ? seed.tree : { ...seed.tree, anchor };
    await page.addInitScript(({ data, tree, survey }) => {
      const copy = value => structuredClone(value);
      window.storytreeAnswers = {
        projectSelection: async () => ({ projects: data.projects, current: 'storytree' }),
        chooseProject: async () => ({ projects: data.projects, current: 'storytree' }),
        listProjects: async () => copy(data.projects), projectTree: async () => copy(tree),
        changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
        linesSince: async (_, cursor) => cursor === 0 ? copy(data.lines) : { lines: [], cursor: data.lines.cursor },
        frontCovers: async (_, id) => copy(data.covers[id] ?? []),
        codeSurvey: async () => copy(survey),
        windowReadings: async (_, sessions) => sessions.map(session => ({ session, at: new Date().toISOString(), compactions: 0, inView: [], glimpses: [], opens: [] })),
        windowReading: async (_, session) => ({ session, at: new Date().toISOString(), compactions: 0, inView: [], glimpses: [], opens: [] }),
        contextReadings: async () => [], idleAfterMs: async () => 3600000, leaveAfterMs: async () => 3600000,
      };
    }, { data: seed, tree, survey });
    await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
    await bridge.ready(page);
    await page.waitForFunction(() => document.body.dataset.state === 'ready' && !!window.__globe, undefined, { timeout: 120000 });
    for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
    await page.mouse.move(2, 2);
    await settle(page, 24);
    results[shot] = await page.evaluate(() => {
      const line = document.querySelector('.forest-anchor');
      const box = line?.getBoundingClientRect();
      return line === null ? null : {
        sentence: line.querySelector('.forest-anchor-sentence')?.textContent ?? null,
        unsaid: [...line.querySelectorAll('.forest-anchor-unsaid')].map(p => p.textContent),
        box: { top: Math.round(box.top), left: Math.round(box.left), width: Math.round(box.width), height: Math.round(box.height) },
      };
    });
    results[`${shot}Errors`] = errors;
    await page.screenshot({ path: path.join(out, `${label}-${shot}.png`), timeout: 180000 });
    await page.close();
  }
  writeFileSync(path.join(out, `measurements-${label}.json`), JSON.stringify(results, null, 2) + '\n');
  assert.equal(results.said?.sentence, `${ANCHOR.what}, for ${ANCHOR.audience}`);
  assert.match(results.unsaid?.unsaid[0] ?? '', /no anchor yet/);
  console.log(JSON.stringify(results, null, 1));
});
