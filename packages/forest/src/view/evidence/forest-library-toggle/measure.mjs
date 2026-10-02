// Census of the real seed through capability 1's public placement and drawing coordinates.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { captureOutput } from '../../../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = captureOutput(here);
const root = path.resolve(here, '../../../../../..');
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const { knowledge, underShelves, globePoints, noteTitle } = await import(pathToFileURL(require.resolve('@storytree/knowledge-core')));
const { forestScene, storyNodes } = await import(pathToFileURL(require.resolve('@storytree/forest')));
const { workStates } = await import(pathToFileURL(require.resolve('@storytree/arc-surface')));
const { planetLayout } = await import('../../planet-navigation.ts');
const seed = JSON.parse(readFileSync(path.join(here, 'seed.json'), 'utf8'));
const changes = seed.changes.changes;
const known = knowledge(changes), core = underShelves(changes, known);
const layout = planetLayout(forestScene(seed.tree, changes, workStates(seed.lines.lines)), new Map(storyNodes(seed.tree, changes).map(story => [story.id, story.place])));
const { spots, radius: PLANET_RADIUS } = layout;
const points = globePoints(core, spots, PLANET_RADIUS, known.notes);
const depthCounts = {};
for (const placement of core.placed.values()) depthCounts[placement.depth] = (depthCounts[placement.depth] ?? 0) + 1;
const shelves = new Map(core.shelves.map(shelf => [shelf.node, shelf]));
const notes = points.map(point => {
  const placement = core.placed.get(point.id);
  return { id: point.id, title: noteTitle(known.notes.get(point.id)), depth: point.depth ?? null,
    home: point.home ?? null, story: placement === undefined ? null : shelves.get(placement.home).story,
    entrances: placement?.entrances ?? [], at: point.at,
    radius: Math.hypot(point.at.x, point.at.y, point.at.z) };
});
assert.ok(notes.length > 0 && notes.length <= core.placed.size + core.outside.length);
assert.equal(new Set(notes.map(note => note.id)).size, notes.length);
assert.ok(notes.every(note => note.radius < PLANET_RADIUS), 'every artifact is inside the shell');
assert.ok(notes.filter(note => note.depth === null).every(note => note.radius <= PLANET_RADIUS * 0.55 + 1e-8),
  'artifacts with no shelf stay within the loose-artifact ball');
const result = {
  seed: seed.stats, radius: PLANET_RADIUS, artifacts: known.notes.size, active: known.active.size,
  placed: notes.filter(note => note.depth !== null).length, depthCounts, noShelf: notes.filter(note => note.depth === null).length, drawn: notes.length,
  shelves: core.shelves.length, emptyShelves: core.shelves.filter(shelf => shelf.empty).length,
  artifactLinks: [...known.active].reduce((n, id) => n + (known.linksIn.get(id) ?? 0), 0),
  ghosts: known.ghosts.size, proposed: known.proposed.size, loops: core.loops.length, threads: 0,
  stories: seed.tree.stories.map(story => ({ id: story.id, title: story.title,
    artifacts: notes.filter(note => note.story === story.id).length,
    shelves: core.shelves.filter(shelf => shelf.story === story.id).length })), notes,
  noShelfMeaning: 'No recorded route from a shelf; no depth. Spread through the loose-artifact ball, never unimportant.',
};
writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, notes: undefined, stories: undefined }));
