import assert from 'node:assert/strict';
import { mkdir, writeFile, symlink, unlink } from 'node:fs/promises';
import { surveyStory, packageOf } from '/repo/packages/map/src/code-survey/code-survey.ts';
import { codeSurveyReader } from '/repo/packages/map/src/code-survey/read-survey.ts';
import { focusProject } from '/repo/packages/map/src/read.ts';
import { forestScene } from '/repo/packages/forest/src/render/forest-scene.ts';

const health = { reported: { state: 'not-checked' }, verified: { state: 'not-checked' } };
const story = (id = 'story_review', title = 'Review') => ({ id, title, health, capabilities: [] });
const tree = { arcs: [], stories: [story()] };
const titles = (title: string) => surveyStory([{ path: 'src/small.test.ts', text: `test(${JSON.stringify(title)}, () => {});` }], []).tests![0]!.titles;
assert.deepEqual(titles('1.1–1.3 bounded span').map(t => t.number), ['1.1', '1.2', '1.3']);
for (const title of ['1.3–1.1 descending', '1.1–2.3 foreign', '1.1–1.9007199254740992 unsafe']) assert.deepEqual(titles(title), []);
console.log(JSON.stringify({candidate:'web-ui-001', boundedRange:3, rejectedControls:['descending','cross-capability','unsafe-integer'], largeRangeExecuted:false}));

const root = '/work/bounded-map';
await mkdir(`${root}/packages/review/src`, { recursive: true });
await writeFile(`${root}/packages/review/src/ordinary.ts`, 'export const ordinary = 1;');
await writeFile(`${root}/packages/review/src/small.test.ts`, 'test("1.1–1.3 bounded span", () => {});');
const library = { projectTree: async () => tree };
const answer = await focusProject(library as never, root, { select:'file:packages/review/src/small.test.ts', mode:'show', up:0, down:0 });
assert.deepEqual(answer.rows![0]!.testTitles!.map(t => t.number), ['1.1','1.2','1.3']);
console.log(JSON.stringify({candidate:'web-ui-001', actualFocusReturnedRange:answer.rows![0]!.testTitles}));

const external = '/work/outside-checkout.txt';
const marker = '1.4 SYNTHETIC_EXTERNAL_TITLE';
await writeFile(external, `test(${JSON.stringify(marker)}, () => {});`);
const link = `${root}/packages/review/src/external.test.ts`;
await symlink(external, link);
const externalAnswer = await focusProject(library as never, root, { select:'file:packages/review/src/external.test.ts', mode:'show', up:0, down:0 });
assert.equal(externalAnswer.rows![0]!.testTitles![0]!.title, marker);
await unlink(link);
await assert.rejects(focusProject(library as never, root, { select:'file:packages/review/src/external.test.ts', mode:'show' }), /Map selection not found/);
console.log(JSON.stringify({candidate:'web-ui-003', disclosed:externalAnswer.rows![0]!.testTitles, removalControl:'not found', authorizationBoundaryTested:false}));

const reader = codeSurveyReader({ checkout:'current' });
assert.ok((await reader.read(root, tree as never)).story_review);
for (const title of ['Constructor', 'The Constructor']) {
  assert.equal(typeof packageOf(title), 'function');
  const mixed = { arcs:[], stories:[story(), story('story_poison', title)] };
  await assert.rejects(reader.read(root, mixed as never), { code:'ERR_INVALID_ARG_TYPE' });
  await assert.rejects(focusProject({ projectTree:async () => mixed } as never, root, { select:'story:Review' }), { code:'ERR_INVALID_ARG_TYPE' });
}
assert.equal(packageOf('The command line'), 'cli');
console.log(JSON.stringify({candidate:'web-ui-004', ordinarySurvey:'passed', titles:['Constructor','The Constructor'], mixedProjectAndFocus:'ERR_INVALID_ARG_TYPE', aliasControl:'cli'}));

const states = { get:() => undefined };
const scene = (id:string, survey:object = {}) => forestScene({ arcs:[], stories:[story(id)] } as never, [], states as never, survey as never);
assert.equal(scene('ordinary').islands.length, 1);
for (const id of ['__proto__', 'constructor', 'toString']) {
  assert.throws(() => scene(id), TypeError);
  assert.equal(scene(id, Object.create(null)).islands.length, 1);
  assert.equal(scene(id, Object.fromEntries([[id, {files:[], imports:[]}]] )).islands.length, 1);
}
console.log(JSON.stringify({candidate:'web-ui-005', ordinaryId:'passed', inheritedKeys:['__proto__','constructor','toString'], absentSurvey:'TypeError', nullPrototypeAndOwnSurveyControls:'passed', restoreExecuted:false}));
