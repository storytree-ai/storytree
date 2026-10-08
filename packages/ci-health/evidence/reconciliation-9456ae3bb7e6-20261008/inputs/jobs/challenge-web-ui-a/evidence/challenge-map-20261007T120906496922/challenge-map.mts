import assert from 'node:assert/strict';
import { mkdir, writeFile, symlink, unlink } from 'node:fs/promises';
import { surveyStory, packageOf } from '/repo/packages/map/src/code-survey/code-survey.ts';
import { codeSurveyReader } from '/repo/packages/map/src/code-survey/read-survey.ts';
import { focusProject } from '/repo/packages/map/src/read.ts';
import { forestScene } from '/repo/packages/forest/src/render/forest-scene.ts';
import { workStates } from '/repo/packages/arc-surface/src/index.ts';

// Only short ranges are executed. Large valid ranges are assessed statically.
function identities(title: string) {
  return surveyStory([{ path: 'src/tiny.test.ts', text: `test(${JSON.stringify(title)}, () => {});` }], [])
    .tests![0]!.titles.map(t => t.number);
}
assert.deepEqual(identities('3.1–3.3 bounded range'), ['3.1', '3.2', '3.3']);
assert.deepEqual(identities('3.3–3.1 descending'), []);
assert.deepEqual(identities('3.1–4.3 cross capability'), []);
assert.deepEqual(identities('3.1–3.9007199254740992 unsafe endpoint'), []);
console.log('web-ui-001: real surveyStory expanded exactly 3 identities; descending, cross-capability and unsafe endpoints rejected. No large range executed.');

const root = '/work/synthetic-checkout';
await mkdir(`${root}/packages/shop/src`, { recursive: true });
await mkdir('/work/synthetic-external', { recursive: true });
await writeFile(`${root}/packages/shop/src/ordinary.ts`, 'export const ordinary = 1;\n');
await writeFile(`${root}/packages/shop/src/ordinary.test.ts`, 'test("3.1 ordinary control", () => {});\n');
const externalTitle = '3.2 SYNTHETIC_EXTERNAL_TITLE_ONLY';
await writeFile('/work/synthetic-external/external.txt', `throw new Error("SOURCE_MUST_NOT_EXECUTE");\ntest(${JSON.stringify(externalTitle)}, () => {});\n`);
const health = { reported: { state: 'not-checked' }, verified: { state: 'not-checked' } };
const story = { id: 'story_shop', title: 'Shop', description: '', health,
  capabilities: [{ id: 'cap_shop', title: '3 · Shop', description: '', health, status: 'untested', proposed: false, dependsOn: [], contracts: [] }] };
const tree: any = { arcs: [], stories: [story] };
const library = { projectTree: async () => tree };
const options: any = { select: 'file:packages/shop/src/link.test.ts', mode: 'show', up: 0, down: 0 };
await symlink('/work/synthetic-external/external.txt', `${root}/packages/shop/src/link.test.ts`);
const withLink = await focusProject(library, root, options);
assert.deepEqual(withLink.rows![0]!.testTitles!.map(t => t.title), [externalTitle]);
await unlink(`${root}/packages/shop/src/link.test.ts`);
await assert.rejects(focusProject(library, root, options), /Map selection not found/);
const normal = await focusProject(library, root, { ...options, select: 'file:packages/shop/src/ordinary.test.ts' });
assert.deepEqual(normal.rows![0]!.testTitles!.map(t => t.title), ['3.1 ordinary control']);
console.log('web-ui-003: real focusProject returned synthetic external test title through a source-file symlink; after removal selection was absent; ordinary-file control passed. Recipient authorization was not simulated.');

assert.equal(packageOf('Shop'), 'shop');
assert.equal(packageOf('The command line'), 'cli');
assert.equal(typeof packageOf('Constructor'), 'function');
assert.equal(typeof packageOf('The Constructor'), 'function');
for (const checkout of ['current', 'main'] as const) {
  const reader = codeSurveyReader({ checkout });
  assert.ok((await reader.read(root, tree)).story_shop);
  const poisoned: any = { ...tree, stories: [...tree.stories, { ...story, id: 'story_other', title: 'Constructor', capabilities: [] }] };
  await assert.rejects(reader.read(root, poisoned), (e: any) => e.code === 'ERR_INVALID_ARG_TYPE');
  assert.ok((await reader.read(root, tree)).story_shop);
}
console.log('web-ui-004: real packageOf returned inherited function; real reader rejected whole mixed project with ERR_INVALID_ARG_TYPE in current and local fallback modes; normal title and recovery controls passed.');

const states = workStates([]);
const plainTree = (id: string): any => ({ arcs: [], stories: [{ ...story, id, capabilities: [] }] });
assert.equal(forestScene(plainTree('story_ordinary'), [], states, {}).islands.length, 1);
for (const id of ['__proto__', 'constructor', 'toString']) {
  assert.throws(() => forestScene(plainTree(id), [], states, {}), TypeError);
  assert.equal(forestScene(plainTree(id), [], states, Object.create(null)).islands.length, 1);
  const ownEntry = Object.fromEntries([[id, { files: [], imports: [] }]]);
  assert.equal(forestScene(plainTree(id), [], states, ownEntry).islands.length, 1);
}
console.log('web-ui-005: real forestScene threw TypeError for __proto__, constructor, toString with empty ordinary-object survey; ordinary ID, null-prototype survey and own-entry controls rendered. Restore and desktop were not executed.');
