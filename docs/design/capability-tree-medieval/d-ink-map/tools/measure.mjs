// Snapshots The library's capability tree, measured as the map measures it, into data.json beside the ink map.
// Run from the checkout root: node --import tsx docs/design/capability-tree-medieval/d-ink-map/tools/measure.mjs
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
  // A capability's number is the one its title leads with ("21 · Links"), and a contract's the one its title leads with ("21.1 · …").
  const numbered = (c) => { const [, number = '', title = c.title] = /^(\d+) · (.*)$/s.exec(c.title) ?? []; return { number, title, contracts: c.contracts.map((k) => { const [, n = '', t = k.title] = /^(\d+\.\d+) · (.*)$/s.exec(k.title) ?? []; return { number: n, title: t.trim() }; }) }; };
  const known = new Map(tree.stories.flatMap((s) => s.capabilities.map((c) => [c.id, { ...numbered(c), story: s.id, storyTitle: s.title }])));
  // The map's own measure (TerritoryShare.lines): a territory's surveyed source files' lines, tests excluded.
  const filesOf = (id) => survey.files.filter((file) => file.capability === id);
  const capabilities = story.capabilities.map((c) => ({
    id: c.id, ...numbered(c), description: c.description ?? '',
    word: c.health?.word ?? c.status ?? 'untested', parked: (c.parkedOn ?? []).length > 0,
    lines: filesOf(c.id).reduce((sum, file) => sum + file.lines, 0), files: filesOf(c.id).length,
    dependsOn: c.dependsOn ?? [],
  }));
  const ids = new Set(capabilities.map(({ id }) => id));
  // Every capability named by a link, this story's and other stories', with its contracts for the road's tag.
  const linked = Object.fromEntries([...new Set(capabilities.flatMap((c) => c.dependsOn))].map((id) => [id, known.get(id) ?? { number: '', title: id, contracts: [] }]));
  // Open increments that name one of these capabilities, with their arcs: what a wrench lists.
  const openWork = (await library.arcViews()).flatMap(({ arc, increments }) => increments
    .filter(({ fields }) => fields.status !== 'closed' && (fields.capabilities ?? []).some((id) => ids.has(id)))
    .map(({ id, fields }) => ({ arc: arc.id, arcTitle: arc.fields.title, increment: id, title: fields.title, status: fields.status, capabilities: fields.capabilities.filter((c) => ids.has(c)) })));
  const data = { story: { id: STORY, title: story.title }, measuredAt: new Date().toISOString(),
    unclaimedLines: filesOf(undefined).reduce((sum, file) => sum + file.lines, 0), capabilities, linked, openWork };
  writeFileSync('docs/design/capability-tree-medieval/d-ink-map/data.json', JSON.stringify(data, null, 2) + '\n');
  console.log(capabilities.map((c) => `${c.number} · ${c.title}\t${c.word}${c.parked ? ' parked' : ''}\t${c.lines}\t${c.dependsOn.map((d) => linked[d].title).join(', ')}`).join('\n'));
  console.log('open work:', openWork.map((w) => `${w.increment} ${w.status} ${w.capabilities.join(',')}`).join('\n'));
} finally { await server.close(); }
