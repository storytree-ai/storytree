// Snapshots The library's capability tree, as the map measures it, into data.json beside the mock.
// Run from the checkout root: node --import tsx docs/design/capability-tree-medieval/b-palisade/tools/measure.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const from = (path) => import(pathToFileURL(resolve(path)).href);
const { route, requireApproval, openNamedProject } = await from('packages/project-and-caller/src/index.ts');
const { connect } = await from('packages/library/src/index.ts');
const { readCodeSurvey } = await from('packages/map/src/code-survey/read-survey.ts');

const STORY = 'story_754e87e7d531';
const routed = route(process.cwd());
if (routed.status !== 'routed') throw new Error(routed.message);
const server = await connect(routed.library);
try {
  await requireApproval(server, routed.project, routed.folder);
  const library = await openNamedProject(server, routed.project, routed.identity);
  const tree = await library.projectTree();
  const survey = (await readCodeSurvey(routed.folder, tree))[STORY];
  const story = tree.stories.find(({ id }) => id === STORY);
  const titles = new Map(tree.stories.flatMap((s) => s.capabilities.map((c) => [c.id, { title: c.title, story: s.title, contracts: c.contracts.map((k) => ({ id: k.id, title: k.title })) }])));
  // The map's own measure: a territory's lines are its surveyed source files' lines, tests excluded.
  const linesOf = (id) => survey.files.filter((file) => file.capability === id).reduce((sum, file) => sum + file.lines, 0);
  const capabilities = story.capabilities.map((c) => ({
    id: c.id, title: c.title, description: c.description,
    word: c.health?.word ?? c.status, parked: c.parkedOn !== undefined && c.parkedOn.length > 0,
    lines: linesOf(c.id), files: survey.files.filter((file) => file.capability === c.id).length,
    // Another story's capability keeps its contracts here, since its road's tag shows them; this story's are below.
    dependsOn: (c.dependsOn ?? []).map((id) => { const { contracts, ...named } = titles.get(id); return { id, ...named, ...(named.story === story.title ? {} : { contracts }) }; }),
    contracts: c.contracts.map((k) => ({ id: k.id, title: k.title })),
  }));
  // Open increments that name one of these capabilities, with their arcs (the wrench's list).
  const ids = new Set(capabilities.map(({ id }) => id));
  const work = (await library.arcViews()).flatMap(({ arc, increments }) => increments
    .filter(({ fields }) => fields.status !== 'closed' && (fields.capabilities ?? []).some((id) => ids.has(id)))
    .map(({ id, fields }) => ({ arc: arc.id, arcTitle: arc.fields.title, increment: id, title: fields.title, status: fields.status, capabilities: fields.capabilities.filter((c) => ids.has(c)) })));
  const data = { story: { id: STORY, title: story.title }, measuredAt: new Date().toISOString(),
    unclaimedLines: linesOf(undefined), capabilities, openWork: work };
  writeFileSync('docs/design/capability-tree-medieval/b-palisade/data.json', JSON.stringify(data, null, 2) + '\n');
  console.log(capabilities.map((c) => `${c.title}\t${c.word}\t${c.lines}\t${c.dependsOn.map((d) => d.title).join(', ')}`).join('\n'));
  console.log('open work:', work.length);
} finally { await server.close(); }
