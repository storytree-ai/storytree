import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const from = (path) => import(pathToFileURL(resolve(path)).href);
const { route, requireApproval, openNamedProject } = await from('packages/project-and-caller/src/index.ts');
const { connect } = await from('packages/library/src/index.ts');
const { readCodeSurvey } = await from('packages/map/src/code-survey/read-survey.ts');

const OUT = 'docs/design/capability-tree-3d/q-all-islands/data.json';
const routed = route(process.cwd());
if (routed.status !== 'routed') throw new Error(routed.message);
const server = await connect(routed.library);
try {
  await requireApproval(server, routed.project, routed.folder);
  const library = await openNamedProject(server, routed.project, routed.identity);
  const tree = await library.projectTree();
  const survey = await readCodeSurvey(routed.folder, tree);
  const { changes } = await library.changesSince(0, { types: ['story'], actions: ['created'] });
  const created = changes.map(({ type, action, recordId }) => ({ type, action, recordId }));
  const titles = new Map(tree.stories.flatMap((s) => s.capabilities.map((c) => [c.id, { title: c.title, story: s.title, storyId: s.id, contracts: c.contracts.map((k) => ({ id: k.id, title: k.title })) }])));
  const views = await library.arcViews();
  const stories = {};
  for (const story of tree.stories) {
    const own = survey[story.id] ?? { files: [] };
    const linesOf = (id) => own.files.filter((file) => file.capability === id).reduce((sum, file) => sum + file.lines, 0);
    const capabilities = story.capabilities.map((c) => ({
      id: c.id, title: c.title, description: c.description,
      word: c.status, parked: c.parkedOn !== undefined && c.parkedOn.length > 0,
      lines: linesOf(c.id), files: own.files.filter((file) => file.capability === c.id).length,
      dependsOn: (c.dependsOn ?? []).filter((id) => titles.has(id)).map((id) => { const { contracts, ...named } = titles.get(id); return { id, ...named, ...(named.storyId === story.id ? {} : { contracts }) }; }),
      contracts: c.contracts.map((k) => ({ id: k.id, title: k.title })),
    }));
    const ids = new Set(capabilities.map(({ id }) => id));
    const openWork = views.flatMap(({ arc, increments }) => increments
      .filter(({ fields }) => fields.status !== 'closed' && (fields.capabilities ?? []).some((id) => ids.has(id)))
      .map(({ id, fields }) => ({ arc: arc.id, arcTitle: arc.fields.title, increment: id, title: fields.title, status: fields.status, parked: fields.parked, capabilities: fields.capabilities.filter((c) => ids.has(c)) })));
    stories[story.id] = { story: { id: story.id, title: story.title }, unclaimedLines: linesOf(undefined), capabilities, openWork };
  }
  const data = {
    measuredAt: new Date().toISOString(), stories,
    map: {
      tree: { ...tree, arcs: [], stories: tree.stories.map((s) => ({ ...s, capabilities: s.capabilities.map((c) => ({ ...c, contracts: c.contracts.map((k) => ({ id: k.id, title: k.title })) })) })) },
      changes: created,
      survey: Object.fromEntries(Object.entries(survey).map(([id, { files, imports, edges, dependsOn, mapped }]) => [id, {
        files: files.map(({ path, lines, capability }) => ({ path, lines, ...(capability === undefined ? {} : { capability }) })),
        imports, edges, dependsOn, ...(mapped === undefined ? {} : { mapped }) }])),
    },
  };
  writeFileSync(OUT, JSON.stringify(data) + '\n');
  for (const { story, capabilities, openWork } of Object.values(stories)) console.log(`${story.id}\t${story.title}\t${capabilities.length} capabilities\t${openWork.length} open`);
  console.log('stories:', tree.stories.length);
} finally { await server.close(); }
