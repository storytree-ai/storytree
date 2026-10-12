// The kind list under the Library switch (knowledge core 5): storytree's own globe (the code-rows snapshot) as the app
// opens it, with the Library switched on. `node --import tsx build.mjs <checkout> before|after`, then
// `node --import tsx capture.mjs before|after`. Before: every dot one colour. After: the list as it opens (friction and
// re-steers off), the Library alone, every kind on, and decisions alone. Each view counts the drawn dots by colour from
// the scene and reads the list's rows from the page.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureOutput, captureSeed, runCapture } from '../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2];
assert.ok(['before', 'after'].includes(label), 'pass a before/after build label');
const { seed, survey } = captureSeed('code-rows');

const prepare = async ({ page }) => {
  await page.waitForFunction(ids => {
    const state = window.__globe;
    if (document.body.dataset.state !== 'ready' || !state) return false;
    return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
  }, seed.tree.stories.map(s => s.id), { timeout: 120000 });
  await page.waitForFunction(() => { let dots = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('knowledge-point:')) dots++; }); return dots > 0; }, undefined, { timeout: 60000 });
  for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
};
const rest = async (page, settle) => { await page.mouse.move(2, 2); await page.waitForTimeout(1200); await settle(page, 24); };
const flip = (page, which) => page.locator(`[data-globe-switch="${which}"]`).click();
const kind = (page, name) => page.locator(`.core-kinds [data-kind="${name}"]`).click();

/** The drawn dots by colour, and the list's rows as the page shows them. */
const measure = page => page.evaluate(() => {
  const colours = {};
  let dots = 0;
  window.__globe.scene.traverse(object => {
    if (!object.name.startsWith('knowledge-point:')) return;
    dots++;
    colours[object.userData.colour] = (colours[object.userData.colour] ?? 0) + 1;
  });
  const rows = [...document.querySelectorAll('.core-kinds button')].map(row => ({
    kind: row.dataset.kind, shown: row.getAttribute('aria-pressed') === 'true',
    label: row.querySelector('.core-kind-label').textContent, count: Number(row.querySelector('.core-kind-count').textContent),
    colour: row.querySelector('.core-kind-swatch').style.background,
  }));
  return { dots, colours, rows };
});

const view = (name, act) => ({
  name: `${label}-${name}`,
  prepare: async ({ page, settle }) => { await act(page); await rest(page, settle); },
  measure: ({ page }) => measure(page),
});
const views = label === 'before' ? [
  view('library-on', page => flip(page, 'library')),
  view('library-alone', page => flip(page, 'stories')),
] : [
  view('library-on', page => flip(page, 'library')),
  view('library-alone', page => flip(page, 'stories')),
  view('every-kind', async page => { await kind(page, 'friction'); await kind(page, 'resteer'); }),
  view('decisions-alone', async page => {
    const on = await page.locator('.core-kinds button[aria-pressed="true"]').evaluateAll(rows => rows.map(row => row.dataset.kind));
    for (const name of on) if (name !== 'decision') await kind(page, name);
  }),
];
const measured = await runCapture({ folder: here, dist: path.join(here, 'dist', label), seed, survey, prepare, views });
const summary = Object.fromEntries(views.map(({ name }, i) => [name, measured[i]]));
if (label === 'after') {
  const [opening, , every, decisions] = measured;
  const count = (at, name) => at.rows.find(row => row.kind === name)?.count ?? 0;
  const shown = at => at.rows.filter(row => row.shown).reduce((sum, row) => sum + row.count, 0);
  assert.deepEqual(opening.rows.filter(row => !row.shown).map(row => row.kind).sort(), ['friction', 'resteer'], 'friction and re-steers open switched off');
  assert.equal(opening.dots, shown(opening), 'the dots drawn are the shown kinds\' counts');
  assert.equal(every.dots, every.rows.reduce((sum, row) => sum + row.count, 0), 'every kind on draws every counted dot');
  assert.equal(decisions.dots, count(decisions, 'decision'), 'decisions alone draws only decisions');
  assert.equal(Object.keys(decisions.colours).length, 1, 'one kind, one colour');
}
writeFileSync(path.join(captureOutput(here), `measurements-${label}.json`), JSON.stringify(summary, null, 1) + '\n');
console.log(label, JSON.stringify(Object.fromEntries(Object.entries(summary).map(([name, { dots, colours }]) => [name, { dots, colours: Object.keys(colours).length }]))));
