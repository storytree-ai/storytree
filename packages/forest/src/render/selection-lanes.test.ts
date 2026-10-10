/** Story node render 3.26: a selected story's links to other stories light as lanes, by direction. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { workStates } from '@storytree/arc-surface';
import type { AnnotatedCapability, AnnotatedStory } from '@storytree/library';
import type { ForestScene, Island } from '../index.js';
import { forestScene, reachedNeighbour, ringPulse, selectionLanes, selectionNeighbours } from '../index.js';

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

test('3.27 a selected story\'s neighbours are ringed by relation, violet when both, each pulsing in once as a lane\'s front reaches its dock', () => {
  assert.deepEqual([...selectionNeighbours(scene, 'b')], [['a', 'up'], ['c', 'down']]);
  const cycle: ForestScene = { ...scene, links: [...scene.links!, { from: 'a1', to: 'c1' }] };
  assert.deepEqual([...selectionNeighbours(cycle, 'c')], [['b', 'up'], ['a', 'down']], 'a story on both sides reads as building on it');
  assert.deepEqual([...selectionNeighbours(scene, undefined)], []);
  const start = ringPulse(0, false), settled = ringPulse(0.72, false);
  assert.ok(start.width > settled.width && start.opacity < settled.opacity, 'it starts wide and faint');
  assert.deepEqual(ringPulse(5, false), settled);
  assert.deepEqual(ringPulse(0, true), settled);
  assert.equal(settled.opacity, 1);
  // b builds on a (an up lane, setting out from a's dock); c builds on b (a down lane, arriving at c's dock).
  assert.equal(reachedNeighbour(scene, { from: 'b1', to: 'a1', dir: 'up' }, 'start'), 'a', 'an up lane leaves its neighbour');
  assert.equal(reachedNeighbour(scene, { from: 'b1', to: 'a1', dir: 'up' }, 'end'), undefined, 'and ends on the selected island');
  assert.equal(reachedNeighbour(scene, { from: 'c1', to: 'b1', dir: 'down' }, 'start'), undefined, 'a down lane leaves the selected island');
  assert.equal(reachedNeighbour(scene, { from: 'c1', to: 'b1', dir: 'down' }, 'end'), 'c', 'and arrives at its neighbour');
});

test('3.26 selecting a story also lights a lane to each story its row depends on, and from each that depends on it, where no capability link joins them', () => {
  const NO_HEALTH = { reported: { state: 'not-checked' as const }, verified: { state: 'not-checked' as const } };
  const capability = (id: string, dependsOn: string[] = []): AnnotatedCapability => ({ id, title: id, dependsOn, proposed: true, status: 'proposed' as const, contracts: [], health: NO_HEALTH });
  const story = (id: string, ...capabilities: AnnotatedCapability[]): AnnotatedStory => ({ id, title: id, capabilities, health: NO_HEALTH });
  // The website's package depends on the world's and the forest's; the plan records only website on forest.
  const tree = { arcs: [], stories: [story('world', capability('w1')), story('forest', capability('f1')), story('website', capability('s1', ['f1']))] };
  const code = { website: { files: [], imports: [], dependsOn: ['world', 'forest'] } };
  const scene = forestScene(tree, [], workStates([]), code);
  assert.deepEqual(selectionLanes(scene, 'website'), [
    { from: 's1', to: 'f1', dir: 'up' },
    { from: 'website', to: 'world', dir: 'up' },
  ], 'the code dependency with no plan link lights a lane between the stories; the planned one is not lit twice');
  assert.deepEqual(selectionLanes(scene, 'world'), [{ from: 'website', to: 'world', dir: 'down' }]);
  assert.deepEqual([...selectionNeighbours(scene, 'website')], [['forest', 'up'], ['world', 'up']]);
  assert.equal(reachedNeighbour(scene, { from: 'website', to: 'world', dir: 'up' }, 'start'), 'world');
});
