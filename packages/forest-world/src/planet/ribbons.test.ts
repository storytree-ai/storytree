import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3, type BufferGeometry } from 'three';
import { ribbon, revealRibbon } from './PlanetTrailRibbons.js';

function front(geometry: BufferGeometry): number {
  const lastPair = geometry.drawRange.count / 6;
  const positions = geometry.getAttribute('position');
  return (positions.getX(lastPair * 2) + positions.getX(lastPair * 2 + 1)) / 2;
}

test('6.9 · The rendered lane front crosses unevenly sampled road sections by physical distance, including between samples', () => {
  const geometry = ribbon({ points: [0, 1, 2, 10].map(x => new Vector3(x, 100, 0)), width: 0.5 });
  const original = Array.from(geometry.getAttribute('position').array);
  revealRibbon(geometry, 0);
  assert.equal(geometry.drawRange.count, 0, 'normal motion begins undrawn');
  for (const progress of [0.05, 0.15, 0.5, 0.7, 1, 0.3, 1]) {
    revealRibbon(geometry, progress);
    assert.ok(Math.abs(front(geometry) - progress * 10) < 1e-5,
      `${progress * 100}% of a ten-unit route ends at ${progress * 10}, got ${front(geometry)}`);
  }
  assert.deepEqual(Array.from(geometry.getAttribute('position').array), original, 'the complete strip retains its shape after growth or a rewind');
  geometry.dispose();
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
