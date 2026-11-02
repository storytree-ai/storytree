// Snapshots what the chart draws into data.json beside it: The library's capabilities (lines of code, tests excluded, from
// the code survey; health; contracts), their links (capability.dependsOn) and the open increments that name them.
// Run from the checkout root: node --import tsx docs/design/capability-tree-3d/c-cartographer/tools/measure.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const from = (path) => import(pathToFileURL(resolve(path)).href);
const { route, requireApproval, openNamedProject } = await from('packages/project-and-caller/src/index.ts');
const { connect } = await from('packages/library/src/index.ts');
const { readCodeSurvey } = await from('packages/map/src/code-survey/read-survey.ts');

const STORY = 'story_754e87e7d531';
const OUT = 'docs/design/capability-tree-3d/c-cartographer/data.json';
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
  const titles = new Map(tree.stories.flatMap((s) => s.capabilities.map((c) => [c.id, { title: c.title, story: s.title, storyId: s.id, contracts: c.contracts.map((k) => ({ id: k.id, title: k.title })) }])));
  // The map's own measure: a territory's lines are its surveyed source files' lines, tests excluded.
  const linesOf = (id) => own.files.filter((file) => file.capability === id).reduce((sum, file) => sum + file.lines, 0);
  const capabilities = story.capabilities.map((c) => ({
    id: c.id, title: c.title, description: c.description,
    word: c.status, parked: c.parkedOn !== undefined && c.parkedOn.length > 0,
    lines: linesOf(c.id), files: own.files.filter((file) => file.capability === c.id).length,
    dependsOn: (c.dependsOn ?? []).map((id) => { const { contracts, ...named } = titles.get(id); return { id, ...named, ...(named.storyId === STORY ? {} : { contracts }) }; }),
    contracts: c.contracts.map((k) => ({ id: k.id, title: k.title })),
  }));
  // Open increments whose capabilities lists name one of these capabilities, with their arcs: the wrenches.
  const ids = new Set(capabilities.map(({ id }) => id));
  const openWork = (await library.arcViews()).flatMap(({ arc, increments }) => increments
    .filter(({ fields }) => fields.status !== 'closed' && (fields.capabilities ?? []).some((id) => ids.has(id)))
    .map(({ id, fields }) => ({ arc: arc.id, arcTitle: arc.fields.title, increment: id, title: fields.title, status: fields.status, capabilities: fields.capabilities.filter((c) => ids.has(c)) })));
  // Links from other stories' capabilities into these: they arrive from outside the story.
  const arrivals = tree.stories.filter((s) => s.id !== STORY).flatMap((s) => s.capabilities.flatMap((c) => (c.dependsOn ?? [])
    .filter((id) => ids.has(id)).map((to) => ({ from: c.id, fromTitle: c.title, story: s.title, storyId: s.id, to }))));
  const data = {
    story: { id: STORY, title: story.title }, measuredAt: new Date().toISOString(),
    unclaimedLines: linesOf(undefined), capabilities, openWork, arrivals,
  };
  writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');
  // The page opens from disk, where a browser will not fetch a JSON file, so the same data is also written as a script.
  writeFileSync(OUT.replace(/data\.json$/, 'data.js'), `window.DATA = ${JSON.stringify(data)};\n`);
  console.log(capabilities.map((c) => `${c.title}\t${c.word}${c.parked ? ' parked' : ''}\t${c.lines}\t${c.dependsOn.map((d) => d.title).join(', ')}`).join('\n'));
  console.log('stories:', tree.stories.length, 'open work:', openWork.length, 'arrivals:', arrivals.length, 'unclaimed lines:', data.unclaimedLines);
} finally { await server.close(); }
