// Snapshots what the hedgerow mock draws into ../data.json, every number measured (ADR-0853 D2):
// the project's tree as the desktop page reads it (pageReads, the same reads Electron uses), the kinds of change
// the forest scene places islands by, each capability's work state from the activity log, this checkout's code
// survey (lines per file, so each territory is sized by its code), and the open increments whose capabilities
// lists name each of The library's capabilities (the wrenches).
// Run from the checkout's root with the library your settings name: node --import tsx docs/design/capability-tree-3d/c-hedgerow/tools/snapshot.mjs
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const load = name => import(pathToFileURL(require.resolve(name)));
const { connect } = await load('@storytree/library');
const { pageReads } = await load('@storytree/app');
const { route } = await load('@storytree/project-and-caller/routing');
const { workStates } = await load('@storytree/arc-surface');
const { readCodeSurvey } = await load('@storytree/forest/code-survey');
const { sanitiseSeed } = await load('@storytree/forest/evidence-seed');

const PROJECT = 'storytree', STORY = 'The library';
const where = route(root);
if (where.status !== undefined && where.library === undefined) throw new Error(`no library for ${root}: ${where.message}`);
const storytree = await connect(where.library);
const reads = pageReads({ storytree });
try {
  const tree = await reads.projectTree(PROJECT);
  const story = tree.stories.find(s => s.title === STORY);
  if (!story) throw new Error(`${STORY} is not in the tree`);
  // forestScene and storyNodes read the history only for the order stories were created in (storyNodes' `created`), so
  // only those changes are kept: the whole history is about 95 MB.
  const history = (await reads.changesSince(PROJECT, 0)).changes.filter(({ type, action }) => type === 'story' && action === 'created')
    .map(({ type, action, recordId }) => ({ type, action, recordId }));
  const { lines } = await reads.linesSince(PROJECT, 0);
  const kept = workStates(lines);
  const states = Object.fromEntries(tree.stories.flatMap(s => s.capabilities.map(c => [c.id, kept.part(c.id)])));
  const survey = await readCodeSurvey(root, tree);
  // Other stories keep what the map draws them by; their contracts' text is not needed here.
  const slim = { ...tree, stories: tree.stories.map(s => s.id === story.id ? s : { ...s, capabilities: s.capabilities.map(c => ({ ...c, contracts: c.contracts.map(({ id, title, health }) => ({ id, title, health })) })) }) };

  // Wrenches: every increment not closed, on an arc not closed, whose capabilities list names one of the story's capabilities.
  const mine = new Set(story.capabilities.map(c => c.id));
  const arcs = await reads.arcViews(PROJECT);
  const wants = {};
  let openIncrements = 0;
  for (const view of arcs) {
    if (view.state === 'closed') continue;
    for (const increment of view.increments ?? []) {
      const f = increment.fields;
      if (f.status === 'closed') continue;
      openIncrements++;
      for (const capability of f.capabilities ?? []) {
        if (!mine.has(capability)) continue;
        (wants[capability] ??= []).push({ arc: view.arc.id, arcTitle: view.arc.fields.title, increment: increment.id, title: f.title, status: f.status });
      }
    }
  }
  const at = new Date().toISOString();
  const data = {
    measured: { at, library: 'the library your settings name (storytree settings show), read with pageReads', project: PROJECT, story: story.id,
      stories: tree.stories.length, capabilities: story.capabilities.length, contracts: story.capabilities.reduce((n, c) => n + c.contracts.length, 0),
      openArcs: arcs.filter(a => a.state !== 'closed').length, openIncrements, wrenched: Object.keys(wants).length,
      surveyedFiles: Object.values(survey[story.id]?.files ?? []).length, surveyedLines: (survey[story.id]?.files ?? []).reduce((n, f) => n + f.lines, 0) },
    story: story.id, tree: slim, history, states, survey, wants,
  };
  // Through the evidence seeds' own scrub, so no machine, home folder, username or private link reaches the repository.
  writeFileSync(path.join(here, '../data.json'), JSON.stringify(sanitiseSeed(data)) + '\n');
  console.log(JSON.stringify(data.measured, null, 1));
  for (const c of story.capabilities) console.log(c.title.padEnd(32), c.status, c.parkedOn ? 'parked' : '', (wants[c.id] ?? []).length, 'wants');
} finally {
  await reads.close();
  await storytree.close();
}
