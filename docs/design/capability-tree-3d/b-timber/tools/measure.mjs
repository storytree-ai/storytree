// Snapshots The library as the map reads it today into data.json beside the mock: the real project tree's story
// (what the desktop app's projectTree answers), the real code survey of it (readCodeSurvey, what codeSurvey answers),
// every link out of or into its capabilities, and the open increments whose capabilities lists name one of them.
// Run from the checkout root: node --import tsx docs/design/capability-tree-3d/b-timber/tools/measure.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const from = (path) => import(pathToFileURL(resolve(path)).href);
const { route, requireApproval, openNamedProject } = await from('packages/project-and-caller/src/index.ts');
const { connect } = await from('packages/library/src/index.ts');
const { readCodeSurvey } = await from('packages/map/src/code-survey/read-survey.ts');

const STORY = 'story_754e87e7d531';
const OUT = 'docs/design/capability-tree-3d/b-timber/data.json';
const routed = route(process.cwd());
if (routed.status !== 'routed') throw new Error(routed.message);
const server = await connect(routed.library);
try {
  await requireApproval(server, routed.project, routed.folder);
  const library = await openNamedProject(server, routed.project, routed.identity);
  const tree = await library.projectTree();
  const story = tree.stories.find(({ id }) => id === STORY);
  if (story === undefined) throw new Error(`${STORY} is not in the project tree`);
  const survey = (await readCodeSurvey(routed.folder, { ...tree, stories: [story] }))[STORY];
  const owner = new Map(tree.stories.flatMap((s) => s.capabilities.map((c) => [c.id, { story: s, capability: c }])));
  const ids = new Set(story.capabilities.map(({ id }) => id));
  const linesOf = (id) => survey.files.filter((file) => file.capability === id).reduce((sum, file) => sum + file.lines, 0);
  const contractsOf = (c) => c.contracts.map((k) => ({ id: k.id, title: k.title }));
  const capabilities = story.capabilities.map((c) => ({
    id: c.id, title: c.title, description: c.description, word: c.health?.word ?? c.status ?? null,
    parked: (c.parkedOn ?? []).length > 0, lines: linesOf(c.id), files: survey.files.filter((f) => f.capability === c.id).length,
    contracts: contractsOf(c),
  }));
  // A pathway per dependsOn: inside the island when both ends are The library's, a road off the coast when one is not.
  const links = story.capabilities.flatMap((c) => (c.dependsOn ?? []).map((to) => ({ from: c.id, to })));
  const roadsOut = links.filter(({ to }) => !ids.has(to)).map(({ from, to }) => {
    const there = owner.get(to);
    return { from, to, story: there?.story.title ?? null, title: there?.capability.title ?? to, contracts: there ? contractsOf(there.capability) : [] };
  });
  const roadsIn = tree.stories.filter((s) => s.id !== STORY).flatMap((s) => s.capabilities.flatMap((c) => (c.dependsOn ?? [])
    .filter((to) => ids.has(to)).map((to) => ({ from: c.id, fromTitle: c.title, story: s.title, to }))));
  const work = (await library.arcViews()).flatMap(({ arc, increments }) => increments
    .filter(({ fields }) => fields.status !== 'closed' && (fields.capabilities ?? []).some((id) => ids.has(id)))
    .map(({ id, fields }) => ({ arc: arc.id, arcTitle: arc.fields.title, increment: id, title: fields.title, status: fields.status,
      capabilities: fields.capabilities.filter((c) => ids.has(c)) })));
  const data = {
    measuredAt: new Date().toISOString(),
    story: { id: STORY, title: story.title },
    unclaimedLines: linesOf(undefined),
    capabilities,
    links: links.filter(({ to }) => ids.has(to)),
    roadsOut, roadsIn, openWork: work,
    // What the page's stand-in bridge answers: the real tree with only this story, and its real survey.
    seed: { tree: { ...tree, stories: [story], arcs: [] }, survey: { [STORY]: survey } },
  };
  writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');
  console.log(capabilities.map((c) => `${c.title}\t${c.word}\t${c.parked ? 'parked' : ''}\t${c.lines}`).join('\n'));
  console.log(`links ${data.links.length}, roads out ${roadsOut.length}, roads in ${roadsIn.length}, open work ${work.length}`);
} finally { await server.close(); }
