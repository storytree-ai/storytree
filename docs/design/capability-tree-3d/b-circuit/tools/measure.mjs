// Snapshots what the circuit-board mock draws into data.json beside it: The library's capabilities (lines of code from
// the code survey, tests excluded; health word; parked), every link (capability.dependsOn) with the called
// capability's contracts, and the open increments whose capabilities lists name one of them (the wrenches).
// Run from the checkout root: node --import tsx docs/design/capability-tree-3d/b-circuit/tools/measure.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const from = (path) => import(pathToFileURL(resolve(path)).href);
const { route, requireApproval, openNamedProject } = await from('packages/project-and-caller/src/index.ts');
const { connect } = await from('packages/library/src/index.ts');
const { readCodeSurvey } = await from('packages/map/src/code-survey/read-survey.ts');

const STORY = 'story_754e87e7d531';
const OUT = 'docs/design/capability-tree-3d/b-circuit/data.json';
const routed = route(process.cwd());
if (routed.status !== 'routed') throw new Error(routed.message);
const server = await connect(routed.library);
try {
  await requireApproval(server, routed.project, routed.folder);
  const library = await openNamedProject(server, routed.project, routed.identity);
  const tree = await library.projectTree();
  const survey = await readCodeSurvey(routed.folder, tree);
  const story = tree.stories.find(({ id }) => id === STORY);
  const own = survey[STORY];
  const named = new Map(tree.stories.flatMap((s) => s.capabilities.map((c) => [c.id, {
    title: c.title, story: s.title, storyId: s.id, word: c.status, contracts: c.contracts.map((k) => ({ id: k.id, title: k.title })) }])));
  const linesOf = (id) => own.files.filter((file) => file.capability === id).reduce((sum, file) => sum + file.lines, 0);
  const capabilities = story.capabilities.map((c) => ({
    id: c.id, title: c.title, description: c.description,
    word: c.status, parked: c.parkedOn !== undefined && c.parkedOn.length > 0,
    lines: linesOf(c.id), files: own.files.filter((file) => file.capability === c.id).length,
    dependsOn: (c.dependsOn ?? []).map((id) => ({ id, ...named.get(id) })),
    contracts: c.contracts.map((k) => ({ id: k.id, title: k.title })),
  }));
  // Links from other stories' capabilities into this one: they arrive at the board's edge connector.
  const ids = new Set(capabilities.map(({ id }) => id));
  const incoming = tree.stories.filter((s) => s.id !== STORY).flatMap((s) => s.capabilities.flatMap((c) =>
    (c.dependsOn ?? []).filter((id) => ids.has(id)).map((to) => ({ from: c.id, fromTitle: c.title, story: s.title, storyId: s.id, to }))));
  const openWork = (await library.arcViews()).flatMap(({ arc, increments }) => increments
    .filter(({ fields }) => fields.status !== 'closed' && (fields.capabilities ?? []).some((id) => ids.has(id)))
    .map(({ id, fields }) => ({ arc: arc.id, arcTitle: arc.fields.title, increment: id, title: fields.title, status: fields.status, capabilities: fields.capabilities.filter((c) => ids.has(c)) })));
  const data = { story: { id: STORY, title: story.title }, measuredAt: new Date().toISOString(), unclaimedLines: linesOf(undefined), capabilities, incoming, openWork };
  writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');
  console.log(capabilities.map((c) => `${c.title}\t${c.word}${c.parked ? ' parked' : ''}\t${c.lines}\t${c.contracts.length}k\t-> ${c.dependsOn.map((d) => d.title + (d.storyId === STORY ? '' : ' [' + d.story + ']')).join(', ')}`).join('\n'));
  console.log('incoming:', incoming.length, 'from', new Set(incoming.map((i) => i.storyId)).size, 'stories; open work:', JSON.stringify(openWork, null, 0), 'unclaimed:', data.unclaimedLines);
} finally { await server.close(); }
