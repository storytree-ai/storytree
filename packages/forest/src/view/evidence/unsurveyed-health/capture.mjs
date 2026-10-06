// The actual desktop renderer, with a seeded user project's verified health and no code survey.
// Run: node --import tsx <this-file> before|after [checkout] --retake
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, runCapture } from '../../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2];
assert.ok(['before', 'after'].includes(label));
const root = path.resolve(process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : path.resolve(here, '../../../../../..'));
const dist = path.join(here, 'dist', label);
await buildCapture({ root, dist });
const at = '2026-10-06T00:00:00.000Z';
const health = state => ({ reported: { state: 'passing', at }, verified: { state, at, by: 'CI' } });
const capability = (id, title, status, state) => ({ id, title, description: title.slice(4), status, proposed: status === 'proposed', dependsOn: [],
  contracts: [{ id: `contract-${id}`, title: `${title.split(' ')[0]}.1 · Works`, health: health(state) }], health: health(state) });
const tree = { arcs: [], stories: [
  { id: 'story-server', title: 'Shop server', health: health('passing'), capabilities: [capability('server', '1 · Serve the shop', 'healthy', 'passing')] },
  { id: 'story-browsing', title: 'Browsing', health: health('failing'), capabilities: [
    capability('browse', '1 · Browse products', 'unhealthy', 'failing'),
    capability('search', '2 · Search products', 'untested', 'not-checked'),
    capability('filter', '3 · Filter products', 'proposed', 'not-checked'),
  ] },
] };
const changes = tree.stories.map((story, index) => ({ seq: index + 1, recordId: story.id, type: 'story', action: 'created',
  record: { id: story.id, type: 'story', version: 1, createdAt: at, updatedAt: at, fields: { title: story.title } } }));
const seed = { projects: ['shop'], tree, changes: { changes, cursor: changes.length }, lines: { lines: [], cursor: 0 }, covers: {} };
const measure = ({ page }) => page.evaluate(() => {
  const marks = [];
  window.__globe.scene.traverse(mesh => {
    if (mesh.name.startsWith('territory:')) marks.push({ capability: mesh.userData.capability, word: mesh.userData.word,
      colour: mesh.material.color.getHexString(), opacity: mesh.material.opacity, vertices: mesh.geometry.attributes.position.count });
  });
  return { project: document.querySelector('select')?.value, marks: marks.sort((a, b) => a.capability.localeCompare(b.capability)) };
});
const waitForLand = async ({ page }) => {
  await page.waitForFunction(() => window.__globe?.scene.getObjectByName('planet:story-browsing')?.getObjectByName('island-ground'));
  if (label === 'after') await page.waitForFunction(() => window.__globe.scene.getObjectByName('territory:browse'));
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
};
const expected = refreshed => [
  ['browse', refreshed ? 'healthy' : 'unhealthy', refreshed ? '97c459' : 'e24b4a'],
  ['filter', 'proposed', 'f2d16b'], ['search', 'untested', 'f2d16b'], ['server', 'healthy', '97c459'],
];
const check = refreshed => value => {
  assert.deepEqual(value.marks.map(m => [m.capability, m.word, m.colour]), label === 'before' ? [] : expected(refreshed));
  assert.ok(value.marks.every(m => m.vertices > 0 && m.opacity > 0));
};
await runCapture({ folder: here, dist, seed, survey: {},
  answers: { changesSince: async (_, cursor) => ({ changes: changes.filter(c => c.seq > cursor), cursor: changes.length }) },
  prepare: waitForLand,
  views: [
    { name: label, measure, expect: check(false) },
    ...(label === 'before' ? [] : [
      { name: 'after-live-health', prepare: async ({ page }) => {
        const cap = tree.stories[1].capabilities[0];
        cap.status = 'healthy'; cap.health = health('passing'); cap.contracts[0].health = cap.health;
        tree.stories[1].health = health('not-checked');
        changes.push({ seq: changes.length + 1, recordId: 'health-browse', type: 'health', action: 'updated',
          record: { id: 'health-browse', type: 'health', version: 1, createdAt: at, updatedAt: at,
            fields: { node: cap.contracts[0].id, column: 'verified', state: 'passing', by: 'CI' } } });
        await page.waitForFunction(() => window.__globe.scene.getObjectByName('territory:browse')?.userData.word === 'healthy');
      }, measure, expect: check(true) },
      { name: 'after-reload', prepare: async context => { await context.page.reload(); await context.bridge.ready(context.page); await waitForLand(context); }, measure, expect: check(true) },
    ]),
  ],
});
