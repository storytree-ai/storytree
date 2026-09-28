// Writes SYNTHETIC proposed flags and verified health into a THROWAWAY restored STORYTREE_HOME, so
// The command line's cards show all four words: the snapshot's capabilities all read proposed (none
// has been switched off yet) and nothing in it wrote storytree's verified column for them.
//   STORYTREE_HOME=<throwaway> node --import tsx packages/forest/evidence/cardwords/seed-words.mjs
import assert from 'node:assert/strict';

import { connect } from '@storytree/library';

import { appLibraryServer } from '../../../../scripts/library-server.mjs';

assert.ok(process.env.STORYTREE_HOME, 'a throwaway restored STORYTREE_HOME is required');
const by = { actor: 'session:cardwords-synthetic-fixture' };
const server = await appLibraryServer('cardwords seed', { writes: true });
const storytree = await connect({ url: server.url });
try {
  const library = await storytree.openProject('storytree');
  const tree = await library.projectTree();
  const story = tree.stories.find(({ title }) => title === 'The command line');
  const named = (title) => story.capabilities.find((capability) => capability.title === title);
  const healthy = named('1 · Front door');
  const unhealthy = named('2 · Who wrote it');
  const untested = named('3 · Library');
  assert.ok(healthy && unhealthy && untested, story.capabilities.map(({ title }) => title).join(', '));
  for (const capability of [healthy, unhealthy, untested]) await library.setProposed(capability.id, false, by);
  for (const contract of healthy.contracts) await library.recordVerified(contract.id, 'passing', { ...by, by: 'storytree' });
  for (const [index, contract] of unhealthy.contracts.entries()) await library.recordVerified(contract.id, index === 0 ? 'failing' : 'passing', { ...by, by: 'storytree' });
  // The snapshot already holds storytree-verified passes for some contracts: one with no verified result makes it untested.
  for (const [index, contract] of untested.contracts.entries()) await library.recordVerified(contract.id, index === 0 ? 'not-checked' : 'passing', { ...by, by: 'storytree' });
  console.log(`seeded: ${healthy.title} healthy, ${unhealthy.title} unhealthy, ${untested.title} untested; the rest stay proposed`);
} finally {
  await storytree.close();
  await server.stop();
}
