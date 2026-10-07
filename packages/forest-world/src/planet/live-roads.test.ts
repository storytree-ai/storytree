import assert from 'node:assert/strict';
import test from 'node:test';
import type { ForestScene, Island } from '../scene.js';
import { crossingLength, linkKey, roadSegmentWindows, type GrowthWindow } from './growth.js';
import { laneDrawSeconds } from './lanes.js';
import { liveRoadProgress, nextLiveRoads } from './live-roads.js';
import { buildPlanetPathways } from './pathways.js';

const R = 218;
const island = (story: string): Island => ({ story, title: story, x: 0, z: 0, key: story,
  trees: [1, 2].map(i => ({ capability: `${story}${i}`, form: 'green', status: 'healthy', contracts: 1, x: i, z: 0, scale: 1, turn: 0 })),
});
const islands = ['a', 'b', 'c'].map(island);
const spots = new Map([
  ['a', { x: R * Math.sin(0.4), y: 0, z: R * Math.cos(0.4) }],
  ['b', { x: -R * Math.sin(0.4), y: 0, z: R * Math.cos(0.4) }],
  ['c', { x: 0, y: R * Math.sin(0.6), z: R * Math.cos(0.6) }],
]);
const scene: ForestScene = { islands, links: [{ from: 'b1', to: 'a1' }] };
const initial = buildPlanetPathways(scene, spots, R);
const added = buildPlanetPathways({ ...scene, links: [...scene.links!, { from: 'c1', to: 'a1' }] }, spots, R);

test('6.16 live roads grow initially, then adding a real dependency preserves completed shared roads while its new spans grow from dependency to dependent', () => {
  const first = nextLiveRoads(new Map(), initial, 0);
  assert.deepEqual([...first.keys()], ['b1->a1']);
  const original = first.get('b1->a1')!;
  assert.equal(original.seconds, laneDrawSeconds(crossingLength(initial, 'b1->a1')));
  assert.equal(liveRoadProgress(original, 0, false), 0, 'first seen, the live road is undrawn');
  assert.equal(liveRoadProgress(original, original.seconds / 2, false), 0.5, 'half its time grows half its length');

  const arrival = 5;
  const next = nextLiveRoads(first, added, arrival);
  assert.deepEqual([...next.keys()].sort(), ['b1->a1', 'c1->a1']);
  assert.equal(next.get('b1->a1'), original, 'a real link keeps its arrival when routing changes');
  assert.equal(next.get('c1->a1')!.start, arrival);
  const cross = added.segments.filter(segment => segment.island === undefined);
  assert.ok(cross.every(segment => !initial.segments.some(old => old.id === segment.id)), 'the real router rebuilt these segment IDs');
  const shared = cross.filter(segment => segment.links.length > 1);
  const fresh = cross.filter(segment => segment.links.length === 1 && segment.links.includes('c1->a1'));
  assert.ok(shared.length > 0 && fresh.length > 0, 'the real new road shares a trunk and adds its own span');
  const windows = roadSegmentWindows(added, next);
  for (const segment of cross.filter(segment => segment.links.includes('b1->a1'))) {
    assert.equal(liveRoadProgress(windows.get(segment.id), arrival, false), 1, 'an old or shared span remains complete');
  }
  const newEdge = added.edges.find(edge => linkKey(edge) === 'c1->a1')!;
  for (const segment of fresh) {
    const window = windows.get(segment.id)!;
    assert.equal(liveRoadProgress(window, arrival, false), 0, 'the added span has not flashed whole');
    assert.ok(Math.abs(liveRoadProgress(window, window.start + window.seconds / 2, false) - 0.5) < 1e-9);
    assert.equal(window.fromEnd, !newEdge.segments.find(ref => ref.id === segment.id)!.reversed, 'it grows toward the dependent');
    assert.equal(liveRoadProgress(window, window.start + window.seconds, false), 1);
  }
});

test('6.16 unchanged real link identities keep the same live arrival book through unrelated geometry and segment-ID updates', () => {
  const book = nextLiveRoads(new Map(), added, 0);
  const repainted = { ...added, segments: added.segments.map(segment => ({ ...segment, id: `new:${segment.id}`, points: segment.points.map(p => p.clone()) })),
    edges: [...added.edges].reverse().map(edge => ({ ...edge, segments: edge.segments.map(ref => ({ ...ref, id: `new:${ref.id}` })) })),
  };
  assert.equal(nextLiveRoads(book, repainted, 8), book, 'polls and geometry rebuilds cannot restart any road');
});

test('6.16 a link removed then added again has a fresh arrival, while an addition during growth preserves the unfinished roads clock', () => {
  const first = nextLiveRoads(new Map(), initial, 0);
  const during = nextLiveRoads(first, added, 0.05);
  const original = first.get('b1->a1')!;
  assert.equal(during.get('b1->a1'), original);
  assert.equal(during.get('c1->a1')!.start, 0.05);
  assert.ok(Math.abs(liveRoadProgress(original, 0.05, false) - 0.05 / original.seconds) < 1e-9, 'the earlier front retains its elapsed distance');
  const removed = nextLiveRoads(during, initial, 1);
  assert.deepEqual([...removed.keys()], ['b1->a1']);
  assert.equal(during.size, 2, 'updating the book never mutates the previous reading');
  const returned = nextLiveRoads(removed, added, 3);
  assert.equal(returned.get('b1->a1'), original);
  assert.equal(returned.get('c1->a1')!.start, 3);
  assert.notEqual(returned.get('c1->a1'), during.get('c1->a1'));
});

test('6.16 reduced motion and unscheduled roads are whole immediately; normal live-road progress is bounded and linear', () => {
  const window: GrowthWindow = { start: 2, seconds: 1 };
  assert.equal(liveRoadProgress(undefined, 0, false), 1);
  assert.equal(liveRoadProgress(window, 0, true), 1);
  assert.equal(liveRoadProgress(window, 1, false), 0);
  assert.equal(liveRoadProgress(window, 2, false), 0);
  assert.equal(liveRoadProgress(window, 2.25, false), 0.25);
  assert.equal(liveRoadProgress(window, 2.5, false), 0.5);
  assert.equal(liveRoadProgress(window, 4, false), 1);
  assert.equal(liveRoadProgress({ start: 2, seconds: 0 }, 2, false), 0, 'a zero-length span is still undrawn at its start');
  assert.equal(liveRoadProgress({ start: 2, seconds: 0 }, 2.01, false), 1, 'a zero-length span completes without a non-finite front');
});
