import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3, type BufferGeometry } from 'three';
import { drawLane, laneMaterial, laneRibbon, ribbon, revealRibbon } from './PlanetTrailRibbons.js';
import { laneHeads } from './lanes.js';

function front(geometry: BufferGeometry): number {
  const lastPair = geometry.drawRange.count / 6;
  const positions = geometry.getAttribute('position');
  return (positions.getX(lastPair * 2) + positions.getX(lastPair * 2 + 1)) / 2;
}

test('6.9 · The rendered lane front crosses unevenly sampled road sections by physical distance, including between samples', () => {
  const geometry = laneRibbon({ points: [0, 1, 2, 10].map(x => new Vector3(x, 100, 0)), widths: [0.5, 0.5, 0.5, 0.5] });
  const material = laneMaterial('#0d8fb0', false, 1);
  const along = geometry.getAttribute('along'), position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) assert.ok(Math.abs(along.getX(i) - position.getX(i)) < 1e-5, `vertex ${i} carries its distance along the route`);
  drawLane(material, 0, 0, 10);
  assert.ok(material.uniforms.uDrawn!.value < 0, 'normal motion begins undrawn');
  for (const progress of [0.05, 0.15, 0.5, 0.7, 1, 0.3, 1]) {
    drawLane(material, progress, 1, 10);
    assert.ok(Math.abs(material.uniforms.uDrawn!.value - progress * 10) < 1e-9, `${progress * 100}% of a ten-unit route ends at ${progress * 10}`);
  }
  geometry.dispose();
  material.dispose();
});

test('6.16 · A live road entering at the far end grows back by physical distance without changing its completed geometry', () => {
  const geometry = ribbon({ points: [0, 1, 2, 10].map(x => new Vector3(x, 100, 0)), width: 2 });
  const original = Array.from(geometry.getAttribute('position').array);
  for (const progress of [0, 0.05, 0.5, 0.85, 0.95, 1, 0.3, 1]) {
    revealRibbon(geometry, progress, true);
    if (progress === 0) { assert.equal(geometry.drawRange.count, 0); continue; }
    const firstPair = geometry.drawRange.start / 6;
    const position = geometry.getAttribute('position');
    const at = (position.getX(firstPair * 2) + position.getX(firstPair * 2 + 1)) / 2;
    assert.ok(Math.abs(at - (1 - progress) * 10) < 1e-5,
      `${progress * 100}% from the far end reaches ${(1 - progress) * 10}, got ${at}`);
  }
  assert.deepEqual(Array.from(geometry.getAttribute('position').array), original);
  revealRibbon(geometry, 0.3, true);
  revealRibbon(geometry, 0.4);
  assert.ok(Math.abs(front(geometry) - 4) < 1e-5, 'a changed entry direction restores the former front first');
  geometry.dispose();
});

test('6.8 · Lanes sharing a stretch of road lay one glow on it between them, however many ride it', () => {
  const trunk = [0, 1, 2].map(x => new Vector3(x, 100, 0));
  const lanes = [
    { from: 'b1', to: 'a1', colour: '#6a5fee', points: [...trunk, new Vector3(3, 100, 0), new Vector3(4, 100, 0)] },
    { from: 'b2', to: 'a1', colour: '#6a5fee', points: [...trunk, new Vector3(2, 100, 1), new Vector3(2, 100, 2)] },
    { from: 'b3', to: 'a1', colour: '#6a5fee', points: [...trunk, new Vector3(2, 100, 1), new Vector3(2, 100, 2)] },
  ];
  const heads = laneHeads(lanes);
  const stretches = lanes.map((lane, i) => laneRibbon({ points: lane.points, widths: lane.points.map(() => 1) }, 2.6, 0, heads[i]!).index!.count / 6);
  // Two stretches of trunk, two on to b1 and two on to b2 and b3: six in all, each under one glow.
  assert.deepEqual(stretches, [4, 2, 0]);
});
