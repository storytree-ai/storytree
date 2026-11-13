// A project's shared store drawn beside its islands, with its tables inside it, and its panel once clicked
// (increment_0228e9896ea9, ADR-1332 D1, D2 (1)). Drawn by the actual desktop page from the capture kit's `code-rows` seed (storytree's
// own library), its stores read by the map's own readStores from a folder shaped like the checkbox interview repository: Postgres
// with pgvector in compose, its tables from .sql migrations. Run from the checkout root, in the foreground:
//   node ~/.storytree/your-factory/plugins/micks-dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/testing/view/shared-stores/capture.mjs --retake
// Add `--folder <project folder>` to read a real project's stores instead (the checkbox repository itself, increment_44871a60b43c):
// its pictures and measurements are named for that folder, `store-panel-1440x960-checkbox.png`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStores } from '@storytree/map/code-survey';
import { buildCapture, buildFolder, captureSeed, fakeBridge, withCapture } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.join(here, '../../../src/view/evidence', 'shared-stores');
const dist = buildFolder(here);
const { seed, survey } = captureSeed('code-rows');

const CHECKBOX = {
  'docker-compose.yml': 'services:\n  db:\n    image: pgvector/pgvector:pg16\n    environment:\n      POSTGRES_USER: app\n      POSTGRES_DB: checkbox\n    ports:\n      - "5432:5432"\n    volumes:\n      - ./migrations:/docker-entrypoint-initdb.d\n  api:\n    build: .\n    environment:\n      - DATABASE_URL=postgresql+psycopg://app:secret@db:5432/checkbox\n    depends_on: [db]\n',
  '.env.example': 'DATABASE_URL=postgresql://app:secret@localhost:5432/checkbox\n',
  'migrations/001_init.sql': 'CREATE EXTENSION IF NOT EXISTS vector;\nCREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT NOT NULL, display_name varchar(80));\nCREATE TABLE forms (id bigint PRIMARY KEY, title text);\nCREATE TABLE answers (id bigserial PRIMARY KEY, user_id integer NOT NULL REFERENCES users (id), embedding vector(1536));\n',
  'migrations/002_forms.sql': 'ALTER TABLE answers ADD COLUMN form_id bigint;\nALTER TABLE answers ADD CONSTRAINT answers_form FOREIGN KEY (form_id) REFERENCES forms(id);\nCREATE TABLE sessions (id uuid PRIMARY KEY, user_id integer REFERENCES users (id), started timestamptz);\nCREATE TABLE checks (id serial PRIMARY KEY, answer_id bigint REFERENCES answers (id), passed boolean);\n',
};
const given = process.argv.indexOf('--folder') === -1 ? undefined : process.argv[process.argv.indexOf('--folder') + 1];
const name = given === undefined ? undefined : path.basename(path.resolve(given));
const named = file => name === undefined ? file : `${path.basename(file, path.extname(file))}-${name}${path.extname(file)}`;
let stores;
if (given !== undefined) stores = await readStores(path.resolve(given));
else {
  const folder = mkdtempSync(path.join(tmpdir(), 'shared-stores-capture-'));
  for (const [file, text] of Object.entries(CHECKBOX)) { mkdirSync(path.dirname(path.join(folder, file)), { recursive: true }); writeFileSync(path.join(folder, file), text); }
  stores = await readStores(folder);
  rmSync(folder, { recursive: true, force: true });
}
await buildCapture({ dist });

const { results, out } = await withCapture({ folder: evidence, dist, ...(name === undefined ? {} : { name }) }, async ({ browser, origin, out, settle }) => {
  const results = {};
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const copy = value => structuredClone(value);
  const bridge = fakeBridge({
    projectSelection: async () => ({ projects: seed.projects, current: 'storytree' }),
    chooseProject: async () => ({ projects: seed.projects, current: 'storytree' }),
    listProjects: async () => copy(seed.projects), projectTree: async () => copy(seed.tree),
    changesSince: async (_, cursor) => cursor === 0 ? copy(seed.changes) : { changes: [], cursor: seed.changes.cursor },
    linesSince: async (_, cursor) => cursor === 0 ? copy(seed.lines) : { lines: [], cursor: seed.lines.cursor },
    frontCovers: async (_, id) => copy(seed.covers[id] ?? []),
    ...(survey === undefined ? {} : { codeSurvey: async () => copy(survey) }),
    sharedStores: async () => copy(stores),
  });
  await bridge.install(page);
  await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await bridge.ready(page);
  await page.waitForFunction(address => {
    const state = window.__globe;
    return document.body.dataset.state === 'ready' && !!state && !!state.scene.getObjectByName(`store:${address}`);
  }, stores[0].address, { timeout: 180000 });
  for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  await settle(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, named('store-beside-islands-1440x960.png')), timeout: 180000 });
  // The store's slab, in the window's pixels, and the table names drawn on it.
  const slab = await page.evaluate(address => {
    const { scene, camera } = window.__globe, V = camera.position.constructor;
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const canvas = document.querySelector('canvas').getBoundingClientRect();
    const at = scene.getObjectByName(`store:${address}`).getWorldPosition(new V()).project(camera);
    return { x: canvas.left + (at.x + 1) * canvas.width / 2, y: canvas.top + (1 - at.y) * canvas.height / 2,
      tables: [...document.querySelectorAll('.planet-store-table')].map(n => n.textContent), name: document.querySelector('.planet-store-name')?.textContent };
  }, stores[0].address);
  await page.mouse.click(slab.x, slab.y);
  await settle(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, named('store-panel-1440x960.png')), timeout: 180000 });
  const panel = await page.evaluate(() => document.querySelector('.story-panel')?.innerText ?? null);
  results.store = { stores: stores.map(({ address, tables }) => ({ address, tables: tables.map(({ name }) => name) })), slab, panel, errors };
  await page.close();
  return { results, out };
});
writeFileSync(path.join(out, named('measurements.json')), JSON.stringify({ seed: 'code-rows', results }, null, 1) + '\n');
console.log(JSON.stringify(results, null, 1));
