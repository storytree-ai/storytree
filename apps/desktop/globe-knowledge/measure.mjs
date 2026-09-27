// A census of the actual seed using capability 1 and its existing drawing coordinates.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const out = path.join(root, 'docs/research/globe-knowledge');
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const { knowledge, underShelves, coreScene, ReadRecord } = await import(pathToFileURL(require.resolve('@storytree/knowledge-core')));
const { storyNodes, placeOnPackedGlobe, PLANET_RADIUS } = await import(pathToFileURL(require.resolve('@storytree/forest')));
const seed = JSON.parse(readFileSync(path.join(out, 'seed.json'), 'utf8'));
const changes = seed.changes.changes;
const known = knowledge(changes), core = underShelves(changes, known);
const spots = new Map(storyNodes(seed.tree, changes).map(story => [story.id, placeOnPackedGlobe(story.place)]));
const scene = coreScene({ changes, knowledge: known, core, spots, radius: PLANET_RADIUS,
  reads: new ReadRecord('storytree'), session: undefined, sizeBy: 'links-in' });
const depthCounts = {};
for (const placement of core.placed.values()) depthCounts[placement.depth] = (depthCounts[placement.depth] ?? 0) + 1;
const shelves = new Map(core.shelves.map(shelf => [shelf.node, shelf]));
const notes = scene.notes.filter(note => !note.ghost).map(note => {
  const placement = core.placed.get(note.id);
  return { id: note.id, title: note.title, depth: note.depth ?? null, home: placement?.home ?? null,
    story: placement === undefined ? null : shelves.get(placement.home).story,
    entrances: placement?.entrances ?? [], at: note.at,
    radius: Math.hypot(note.at.x, note.at.y, note.at.z) };
});
assert.equal(notes.length, core.placed.size + core.outside.length);
assert.equal(new Set(notes.map(note => note.id)).size, notes.length);
assert.ok(notes.every(note => note.depth === null ? note.radius > PLANET_RADIUS : note.radius < PLANET_RADIUS));
const result = {
  seed: seed.stats, radius: PLANET_RADIUS, artifacts: known.notes.size, active: known.active.size,
  placed: core.placed.size, depthCounts, outside: core.outside.length, drawn: notes.length,
  shelves: core.shelves.length, emptyShelves: core.shelves.filter(shelf => shelf.empty).length,
  artifactLinks: [...known.active].reduce((n, id) => n + (known.linksIn.get(id) ?? 0), 0),
  ghosts: known.ghosts.size, proposed: known.proposed.size, loops: core.loops.length,
  threads: { k1: 0, k2: core.placed.size },
  stories: seed.tree.stories.map(story => ({ id: story.id, title: story.title,
    artifacts: notes.filter(note => note.story === story.id).length,
    shelves: core.shelves.filter(shelf => shelf.story === story.id).length })), notes,
  outsideMeaning: 'No recorded route from a shelf; no depth. Never unimportant.',
};
writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, notes: undefined, stories: undefined }));
