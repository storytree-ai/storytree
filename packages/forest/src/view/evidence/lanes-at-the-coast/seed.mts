// Read-only snapshot of the real library for the capture's stand-in bridge, as ../code-rows/seed.mts, without the
// front covers and the work records' history (increments, questions, arcs, friction, re-steers: the globe draws none of
// them), to keep the file small. Writes nothing to the library. Run: tsx seed.mts
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openNamedProject, requireApproval, route } from '@storytree/session-management';
import { connect } from '@storytree/library';

const here = path.dirname(fileURLToPath(import.meta.url));
const where = route(here);
if (where.status !== 'routed') throw new Error(where.message);
const storytree = await connect(where.library);
try {
  await requireApproval(storytree, 'storytree', where.folder);
  const library = await openNamedProject(storytree, 'storytree');
  const tree = await library.projectTree();
  const all = await library.changesSince(0);
  const kept = new Map<string, (typeof all.changes)[number]>();
  const work = new Set(['increment', 'question', 'arc', 'friction', 'resteer', 'decisionNumbering']);
  for (const change of all.changes) if (!work.has(change.type)) kept.set(`${change.recordId}:${change.action === 'created' ? 'c' : 'u'}`, change);
  const changes = { ...all, changes: [...kept.values()].sort((a, b) => a.seq - b.seq) };
  const capabilities = tree.stories.reduce((n: number, s: { capabilities: unknown[] }) => n + s.capabilities.length, 0);
  const seed = { projects: ['storytree'], tree, changes, lines: { lines: [], cursor: 0 }, covers: {},
    stats: { stories: tree.stories.length, capabilities, taken: new Date().toISOString(), changesFolded: 'work records dropped; each other record: its created change and its last later change; cursor kept' } };
  writeFileSync(path.join(here, 'seed.json.gz'), gzipSync(JSON.stringify(seed) + '\n', { level: 9 }));
  console.log(seed.stats, tree.stories.map((s: { title: string }) => s.title));
} finally {
  await (storytree as { close?: () => Promise<void> }).close?.();
}
