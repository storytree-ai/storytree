import assert from 'node:assert/strict';
import test from 'node:test';
import { Mesh, PerspectiveCamera, Vector3 } from 'three';
import { drawDots, drawLane, laneDotMaterial, laneDots, laneMaterial, laneRibbon, worldPerPixel } from './PlanetTrailRibbons.js';
import { LANE_DOTS, SEA_LANE } from './lanes.js';

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

test('4.44 · the dots at rest are round quads in the lane blue, one per dot at its size and place in its stretch, scaled together, dimmed while a story is selected and hidden while their islands rise', () => {
  const stretches = [{ id: 's', size: 0.4, islands: [['a', 'b'] as const], dots: [0, 1, 2].map(x => ({ at: new Vector3(x, 100, 0), along: new Vector3(1, 0, 0) })) }];
  const geometry = laneDots(stretches), material = laneDotMaterial();
  const position = geometry.getAttribute('position'), corner = geometry.getAttribute('corner');
  assert.equal(position.count, 12, 'four corners a dot');
  for (let i = 0; i < position.count; i++) {
    const centre = new Vector3(Math.floor(i / 4), 100, 0);
    assert.ok(new Vector3().fromBufferAttribute(position, i).sub(centre).projectOnPlane(centre.clone().normalize()).length() < 1e-5, 'about its dot\'s place');
    assert.ok(Math.abs(Math.abs(corner.getX(i)) - 1) < 1e-9 && Math.abs(Math.abs(corner.getY(i)) - 1) < 1e-9, 'each corner of a unit square the shader rounds and sizes');
    assert.ok(Math.abs(geometry.getAttribute('size').getX(i) - 0.4) < 1e-6, 'its size');
    assert.equal(geometry.getAttribute('order').getX(i), Math.floor(i / 4), 'its place in its stretch, for the scale to keep every second at the next step');
  }
  assert.equal(`#${material.uniforms.uColour!.value.getHexString()}`, SEA_LANE);
  drawDots(material, geometry, stretches, false, () => 1, 8);
  assert.equal(material.uniforms.uOpacity!.value, LANE_DOTS.opacity);
  assert.equal(material.uniforms.uScale!.value, 8, 'scaled with every lane');
  drawDots(material, geometry, stretches, true, () => 1);
  assert.equal(material.uniforms.uOpacity!.value, LANE_DOTS.opacity * LANE_DOTS.dim, 'dim while a story is selected');
  assert.ok([0, 1, 2, 3].every(i => geometry.getAttribute('shown').getX(i) === 1));
  drawDots(material, geometry, stretches, true, story => story === 'a' ? 0.3 : 1);
  assert.ok([0, 1, 2, 3].every(i => geometry.getAttribute('shown').getX(i) === 0), 'hidden while an island of its lane rises');
  const lane = laneMaterial(SEA_LANE, 1);
  drawLane(lane, 1, 0, 10, 8);
  assert.equal(lane.uniforms.uScale!.value, 8, 'a fill scales with the dots');
  const camera = new PerspectiveCamera(50, 1.5, 0.1, 1000);
  camera.position.set(0, 100, 0);
  camera.updateMatrixWorld();
  const mesh = new Mesh(geometry);
  mesh.scale.setScalar(2);
  mesh.updateMatrixWorld();
  const expected = 2 * mesh.localToWorld(geometry.boundingSphere!.center.clone()).distanceTo(camera.position) * Math.tan(25 * Math.PI / 180) / 900 / 2;
  assert.ok(Math.abs(worldPerPixel(mesh, geometry, camera, 900) - expected) < 1e-9, 'ground units a pixel across, in the drawing\'s own units');
  geometry.dispose();
  material.dispose();
  lane.dispose();
});
