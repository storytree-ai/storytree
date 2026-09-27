// An extra seam: two front doors first open the same as-yet nonexistent project.
import { connect } from '@storytree/library';
import { url, project, cli, emit } from './common.mjs';

const began = Date.now();
const name = 'chaos-cold-' + Date.now();
const folder = project(name);
emit('first-opens', { project: name, outcomes: await Promise.all([
  cli(['library', 'new', 'story', '--title', 'First caller'], folder).done,
  cli(['library', 'new', 'story', '--title', 'Second caller'], folder).done,
]) });
const tree = await connect({ url });
try {
  const library = await tree.openProject(name);
  emit('stored-after-race', { stories: (await library.list('story')).map(s => s.fields.title) });
  emit('explicit-retry', await cli(['library', 'list', 'story'], folder).done);
} finally { await tree.close(); }
emit('drill-finished', { ms: Date.now() - began });
