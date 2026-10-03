/** Story node render 3.26: a selected story's links to other stories light as lanes, by direction. */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ForestScene, Island } from '../index.js';
import { ringPulse, selectionLanes, selectionNeighbours } from '../index.js';

const island = (story: string, capabilities: string[]): Island => ({
  story, title: story, x: 0, z: 0, radius: 1, key: story,
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

test('3.27 a selected story\'s neighbours are ringed by relation, violet when both, pulsing in once', () => {
  assert.deepEqual([...selectionNeighbours(scene, 'b')], [['a', 'up'], ['c', 'down']]);
  const cycle: ForestScene = { ...scene, links: [...scene.links!, { from: 'a1', to: 'c1' }] };
  assert.deepEqual([...selectionNeighbours(cycle, 'c')], [['b', 'up'], ['a', 'down']], 'a story on both sides reads as building on it');
  assert.deepEqual([...selectionNeighbours(scene, undefined)], []);
  const start = ringPulse(0, false), settled = ringPulse(0.72, false);
  assert.ok(start.width > settled.width && start.opacity < settled.opacity, 'it starts wide and faint');
  assert.deepEqual(ringPulse(5, false), settled);
  assert.deepEqual(ringPulse(0, true), settled);
  assert.equal(settled.opacity, 1);
});
