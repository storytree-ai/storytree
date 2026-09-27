// Read the real seeded desktop library through the same surface API as Electron.
import { mkdirSync, writeFileSync } from 'node:fs';
import { connect } from '@storytree/library';
import { start } from '@storytree/local-postgres';
import { pageReads } from '@storytree/app';
import { appHome } from '../src/home.ts';

const out = new URL('./dist/', import.meta.url);
mkdirSync(out, { recursive: true });
const server = await start({ dataDir: appHome().pgdata, owner: 'globe-look-2 capture' });
let library, reads;
try {
  library = await connect({ url: server.url });
  reads = pageReads({ storytree: library, serverUrl: server.url });
  const projects = await reads.listProjects();
  const tree = await reads.projectTree('storytree');
  const changes = await reads.changesSince('storytree', 0);
  const lines = await reads.linesSince('storytree', 0);
  const covers = {};
  for (const story of tree.stories) {
    for (const node of [story, ...story.capabilities]) covers[node.id] = await reads.frontCovers('storytree', node.id);
  }
  writeFileSync(new URL('seed.json', out), JSON.stringify({ projects, tree, changes, lines, covers }));
  console.log(JSON.stringify({ stories: tree.stories.map(s => [s.title, s.capabilities.length]), lines: lines.lines.length }));
} finally {
  await reads?.close();
  await library?.close();
  await server.stop();
}
