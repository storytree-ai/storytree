// Writes SYNTHETIC agent activity into a throwaway restored STORYTREE_HOME, so The command line
// shows mixed work states: the snapshot carries the library, not the agent log, so every
// capability otherwise reads "planned". Each claim is released at once, so no live session shows.
//   STORYTREE_HOME=<throwaway> node --import tsx packages/forest/evidence/captree/seed-activity.mjs <snapshot.json>
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { openActivityLog } from '@storytree/agent-link';

import { appLibraryServer } from '../../../../scripts/library-server.mjs';

assert.ok(process.env.STORYTREE_HOME, 'a throwaway restored STORYTREE_HOME is required');
const snapshot = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const story = snapshot.records.find(({ type, fields }) => type === 'story' && fields.title === 'The command line');
const byTitle = new Map(snapshot.records.filter(({ type, fields }) => type === 'capability' && fields.story === story.id).map(({ id, fields }) => [fields.title, id]));
const landed = ['1 · Front door', '2 · Who wrote it', '8 · Doctor', '3 · Library'].map((title) => byTitle.get(title));
const building = ['4 · Arcs and increments', '11 · Workspace', '10 · Plan view'].map((title) => byTitle.get(title));
assert.ok([...landed, ...building].every(Boolean), `titles: ${[...byTitle.keys()].join(', ')}`);

const common = { source: 'tool', harness: 'claude-code', session: 'captree-synthetic-fixture' };
const server = await appLibraryServer('captree seed', { writes: true });
try {
  const log = await openActivityLog(server.url);
  try {
    for (const capability of [...landed, ...building]) {
      await log.append('storytree', { ...common, kind: 'claimed', capability, reason: 'synthetic, for the captree capture' });
      await log.append('storytree', { ...common, kind: 'released', capability });
    }
    for (const capability of landed) await log.append('storytree', { ...common, kind: 'landed', capability });
    console.log(`seeded: ${landed.length} landed, ${building.length} in progress, the rest planned`);
  } finally {
    await log.close();
  }
} finally {
  await server.stop();
}
