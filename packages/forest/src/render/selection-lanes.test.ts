/** Story node render 3.26: a selected story's links to other stories light as lanes, by direction. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { workStates } from '@storytree/arc-surface';
import type { AnnotatedCapability, AnnotatedStory } from '@storytree/library';
import type { ForestScene, Island } from '../index.js';
import { forestScene, selectionLanes } from '../index.js';

const island = (story: string, capabilities: string[]): Island => ({
  story, title: story, x: 0, z: 0, key: story,
  trees: capabilities.map(capability => ({ capability, form: 'green', contracts: 0, x: 0, z: 0, scale: 1, turn: 0 })),
});
// b builds on a; c builds on b; a2 builds on a1 within a; c also builds on a.
const scene: ForestScene = {
  islands: [island('a', ['a1', 'a2']), island('b', ['b1']), island('c', ['c1'])],
  links: [{ from: 'a2', to: 'a1' }, { from: 'b1', to: 'a1' }, { from: 'c1', to: 'b1' }, { from: 'c1', to: 'a2' }],
};

test('3.26 selecting a story lights its links to other stories, up where it builds on them and down where they build on it', () => {
  assert.deepEqual(selectionLanes(scene, 'b'), [
    { from: 'b1', to: 'a1', dir: 'up' },
    { from: 'c1', to: 'b1', dir: 'down' },
  ]);
  assert.deepEqual(selectionLanes(scene, 'a'), [
    { from: 'b1', to: 'a1', dir: 'down' },
    { from: 'c1', to: 'a2', dir: 'down' },
  ], 'its own internal link, a2 on a1, stays unlit');
  assert.deepEqual(selectionLanes(scene, undefined), []);
  assert.deepEqual(selectionLanes(scene, 'nowhere'), []);
});

test('3.26 a link the code derives lights like a recorded one, and a story edge with no capability end lights no lane', () => {
  const NO_HEALTH = { reported: { state: 'not-checked' as const }, verified: { state: 'not-checked' as const } };
  const capability = (id: string, dependsOn: string[] = []): AnnotatedCapability => ({ id, title: id, dependsOn, proposed: true, status: 'proposed' as const, contracts: [], health: NO_HEALTH });
  const story = (id: string, ...capabilities: AnnotatedCapability[]): AnnotatedStory => ({ id, title: id, capabilities, health: NO_HEALTH });
  // The website's code takes the world's types and imports a forest file no capability owns; the plan records website on forest.
  const tree = { arcs: [], stories: [story('world', capability('w1')), story('forest', capability('f1')), story('website', capability('s1', ['f1']))] };
  const code = { website: { files: [], imports: [], edges: [
    { story: 'world', from: 's1', to: 'w1', typeOnly: true, files: [] },
    { story: 'forest', from: 's1', typeOnly: false, files: [] },
  ] } };
  const scene = forestScene(tree, [], workStates([]), code);
  assert.deepEqual(selectionLanes(scene, 'website'), [
    { from: 's1', to: 'f1', dir: 'up' },
    { from: 's1', to: 'w1', dir: 'up' },
  ]);
  assert.deepEqual(selectionLanes(scene, 'world'), [{ from: 's1', to: 'w1', dir: 'down' }]);
});
