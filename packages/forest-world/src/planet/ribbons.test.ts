import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { drawLane, laneMaterial, laneRibbon } from './PlanetTrailRibbons.js';
import { SEA_LANE } from './lanes.js';

test('4.9 · The rendered lane front crosses unevenly sampled road sections by physical distance, including between samples', () => {
  const geometry = laneRibbon({ points: [0, 1, 2, 10].map(x => new Vector3(x, 100, 0)), widths: [0.5, 0.5, 0.5, 0.5] });
  const material = laneMaterial(SEA_LANE, 1);
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
