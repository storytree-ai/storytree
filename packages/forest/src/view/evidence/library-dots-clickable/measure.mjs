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
const { knowledge, underShelves, globePoints, noteTitle, isStoryText, LOOSE_BALL_RADIUS, LOOSE_MIN_SEPARATION } = await import(pathToFileURL(require.resolve('@storytree/knowledge-core')));
const { forestScene, storyNodes } = await import(pathToFileURL(require.resolve('@storytree/forest')));
const { workStates } = await import(pathToFileURL(require.resolve('@storytree/arc-surface')));
const { planetLayout } = await import('../../planet-navigation.ts');
const seed = JSON.parse(readFileSync(path.join(here, 'seed.json'), 'utf8'));
const changes = seed.changes.changes;
const known = knowledge(changes), core = underShelves(changes, known);
const layout = planetLayout(forestScene(seed.tree, changes, workStates(seed.lines.lines)),
  new Map(storyNodes(seed.tree, changes).map(story => [story.id, story.place])));
const { spots, radius: PLANET_RADIUS } = layout;
const points = globePoints(core, spots, PLANET_RADIUS, known.notes);
const depthCounts = {};
for (const placement of core.placed.values()) depthCounts[placement.depth] = (depthCounts[placement.depth] ?? 0) + 1;
const shelves = new Map(core.shelves.map(shelf => [shelf.node, shelf]));
const notes = points.map(point => {
  const placement = core.placed.get(point.id);
  const record = known.notes.get(point.id);
  const summary = [record.fields.description, record.fields.summary, record.fields.oneLine, record.fields.statement, record.fields.meaning].find(value => typeof value === 'string' && value.trim());
  return { id: point.id, kind: record.type, title: noteTitle(record), summary: summary ?? null, depth: point.depth ?? null,
    home: point.home ?? null, story: placement === undefined ? null : shelves.get(placement.home).story,
    entrances: placement?.entrances ?? [], at: point.at,
    radius: Math.hypot(point.at.x, point.at.y, point.at.z) };
});
const excluded = [...known.notes.values()].filter(isStoryText);
const loose = notes.filter(note => note.depth === null);
const shelf = notes.filter(note => note.depth !== null);
const distance = (a, b) => Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y, a.at.z - b.at.z);
const looseMinimum = Math.min(...loose.flatMap((a, index) => loose.slice(index + 1).map(b => distance(a, b))));
const shelfClearance = Math.min(...loose.flatMap(a => shelf.map(b => distance(a, b))));
assert.equal(notes.length, core.placed.size + core.outside.length - excluded.length);
assert.ok(notes.every(note => !isStoryText(known.notes.get(note.id))), 'story-text blocks are not drawn as knowledge');
assert.equal(new Set(notes.map(note => note.id)).size, notes.length);
assert.ok(notes.every(note => note.radius < PLANET_RADIUS), 'every artifact is inside the shell');
assert.ok(loose.every(note => note.radius <= PLANET_RADIUS * LOOSE_BALL_RADIUS), 'loose dots stay inside the filled ball');
assert.ok(looseMinimum >= PLANET_RADIUS * LOOSE_MIN_SEPARATION, 'loose dots have the promised separation');
assert.ok(shelfClearance >= PLANET_RADIUS * LOOSE_MIN_SEPARATION, 'loose dots stay clear of shelf dots');
assert.ok(LOOSE_MIN_SEPARATION > 0.012, 'clearance exceeds one drawn dot diameter');
const result = {
  seed: seed.stats, radius: PLANET_RADIUS, artifacts: known.notes.size, active: known.active.size,
  placed: shelf.length, depthCounts, noShelf: loose.length, drawn: notes.length,
  excludedStoryText: excluded.length, excludedIds: excluded.map(note => note.id),
  spread: { shape: "filled ball sampled from a shuffled cubic lattice", maximumRadius: LOOSE_BALL_RADIUS, requiredSeparation: LOOSE_MIN_SEPARATION,
    dotDiameter: 0.012, measuredMinimum: looseMinimum / PLANET_RADIUS, measuredShelfClearance: shelfClearance / PLANET_RADIUS,
    measuredMaximumRadius: Math.max(...loose.map(note => note.radius)) / PLANET_RADIUS },
  shelves: core.shelves.length, emptyShelves: core.shelves.filter(shelf => shelf.empty).length,
  artifactLinks: [...known.active].reduce((n, id) => n + (known.linksIn.get(id) ?? 0), 0),
  ghosts: known.ghosts.size, proposed: known.proposed.size, loops: core.loops.length, threads: 0,
  stories: seed.tree.stories.map(story => ({ id: story.id, title: story.title,
    artifacts: notes.filter(note => note.story === story.id).length,
    shelves: core.shelves.filter(shelf => shelf.story === story.id).length })), notes,
  noShelfMeaning: 'No recorded route from a shelf; no depth. Spread in a filled ball within 0.55 radii, at least 0.035 radii apart and clear of shelf points.',
};
writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, notes: undefined, stories: undefined, excludedIds: undefined }));
