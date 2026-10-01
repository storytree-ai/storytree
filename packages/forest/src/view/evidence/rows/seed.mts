// Read-only snapshot of the real library for the capture's stand-in bridge: opens project "storytree"
// where routing says it is (as the command line does) and dumps the same shape as
// ../knowledge-under-islands/seed.json, gzipped. Writes nothing to the library. Run: tsx seed.mts
// The change history is folded to keep the file small: each record keeps its `created` change and its
// last later change (story creation order, which places the islands, is unchanged); the cursor is kept.
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openNamedProject, route } from '@storytree/agent-link';
import { connect } from '@storytree/library';

const here = path.dirname(fileURLToPath(import.meta.url));
const where = route(here);
if (where.status !== 'routed') throw new Error(where.message);
const storytree = await connect(where.library);
try {
  const library = await openNamedProject(storytree, 'storytree');
  const tree = await library.projectTree();
  const all = await library.changesSince(0);
  const kept = new Map<string, (typeof all.changes)[number]>();
  for (const change of all.changes) kept.set(`${change.recordId}:${change.action === 'created' ? 'c' : 'u'}`, change);
  const changes = { ...all, changes: [...kept.values()].sort((a, b) => a.seq - b.seq) };
  const covers: Record<string, unknown> = {};
  for (const story of tree.stories) {
    for (const id of [story.id, ...story.capabilities.map((c: { id: string }) => c.id)]) {
      const shelf = await library.frontCovers(id);
      if (shelf.length > 0) covers[id] = shelf;
    }
  }
  const capabilities = tree.stories.reduce((n: number, s: { capabilities: unknown[] }) => n + s.capabilities.length, 0);
  const seed = { projects: ['storytree'], tree, changes, lines: { lines: [], cursor: 0 }, covers,
    stats: { stories: tree.stories.length, capabilities, taken: new Date().toISOString(), changesFolded: 'each record: its created change and its last later change; cursor kept' } };
  writeFileSync(path.join(here, 'seed.json.gz'), gzipSync(JSON.stringify(seed) + '\n', { level: 9 }));
  console.log(seed.stats, tree.stories.map((s: { title: string }) => s.title));
} finally {
  await (storytree as { close?: () => Promise<void> }).close?.();
}
