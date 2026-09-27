// Read an isolated seed through the same surface API used by Electron.
// STORYTREE_HOME is mandatory: never open the owner's app library for this capture.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../../..');
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const { connect } = await import(pathToFileURL(require.resolve('@storytree/library')));
const { start } = await import(pathToFileURL(require.resolve('@storytree/local-postgres')));
const { pageReads } = await import(pathToFileURL(require.resolve('@storytree/app')));
const { appHome } = await import(pathToFileURL(path.join(root, 'apps/desktop/src/home.ts')));
if (!process.env.STORYTREE_HOME) throw new Error('Set STORYTREE_HOME to the isolated capture seed.');

const server = await start({ dataDir: appHome().pgdata, owner: 'forest/library toggle evidence export' });
let library, reads;
try {
  library = await connect({ url: server.url });
  reads = pageReads({ storytree: library, serverUrl: server.url });
  const projects = await reads.listProjects();
  const tree = await reads.projectTree('storytree');
  const history = await reads.changesSince('storytree', 0);
  // Knowledge placement needs the full change history, as the real page reads it.
  const changes = history;
  const covers = {};
  for (const story of tree.stories) for (const node of [story, ...story.capabilities]) {
    covers[node.id] = await reads.frontCovers('storytree', node.id);
  }
  const lines = await reads.linesSince('storytree', 0);
  const parent = new Map(tree.stories.flatMap(story => story.capabilities.map(cap => [cap.id, story.id])));
  let within = 0, cross = 0;
  for (const story of tree.stories) for (const cap of story.capabilities) for (const dependency of cap.dependsOn) {
    if (!parent.has(dependency)) throw new Error(`Dependency missing from snapshot: ${dependency}`);
    if (parent.get(dependency) === story.id) within++; else cross++;
  }
  const stats = { stories: tree.stories.length, capabilities: parent.size, within, cross, links: within + cross };
  writeFileSync(path.join(here, 'seed.json'), JSON.stringify({ projects, tree, changes, lines, covers, stats }) + '\n');
  console.log(JSON.stringify(stats));
} finally {
  await reads?.close();
  await library?.close();
  await server.stop();
}
