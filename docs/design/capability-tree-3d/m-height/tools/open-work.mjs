// Reads the open increments whose capabilities lists name one of The library's capabilities, with their arcs and when
// each was parked, into open-work.json beside the page: the queue round 13 lines up on each capability. The island's own
// snapshot stays round 11's (../h-quiet-roads/data.json), so the territories still compare with rounds 11 and 12.
// Run from the checkout root: node --import tsx docs/design/capability-tree-3d/m-height/tools/open-work.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const from = (path) => import(pathToFileURL(resolve(path)).href);
const { route, requireApproval, openNamedProject } = await from('packages/project-and-caller/src/index.ts');
const { connect } = await from('packages/library/src/index.ts');

const STORY = 'story_754e87e7d531';
const routed = route(process.cwd());
if (routed.status !== 'routed') throw new Error(routed.message);
const server = await connect(routed.library);
try {
  await requireApproval(server, routed.project, routed.folder);
  const library = await openNamedProject(server, routed.project, routed.identity);
  const tree = await library.projectTree();
  const ids = new Set(tree.stories.find(({ id }) => id === STORY).capabilities.map(({ id }) => id));
  const openWork = (await library.arcViews()).flatMap(({ arc, increments }) => increments
    .filter(({ fields }) => fields.status !== 'closed' && (fields.capabilities ?? []).some((id) => ids.has(id)))
    .map(({ id, fields }) => ({ arc: arc.id, arcTitle: arc.fields.title, increment: id, title: fields.title, status: fields.status, parked: fields.parked ?? null, capabilities: fields.capabilities.filter((c) => ids.has(c)) })));
  writeFileSync('docs/design/capability-tree-3d/m-height/open-work.json', JSON.stringify({ readAt: new Date().toISOString(), openWork }, null, 1) + '\n');
  console.log(openWork.map((w) => `${w.increment} ${w.status} ${w.capabilities.length} ${w.title}`).join('\n'));
} finally { await server.close(); }
