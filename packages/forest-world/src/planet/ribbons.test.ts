import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferGeometry, Mesh, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { drawDots, drawLane, laneDotMaterial, laneDots, laneMaterial, laneRibbon, worldPerPixel } from './PlanetTrailRibbons.js';
import { LANE_DOTS, LANE_STRANDS, laneScale, SEA_LANE, SEA_LANE_FILL, SEA_LANE_ONE } from './lanes.js';

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

test('4.44 · the dots at rest are round quads in the lane blue, one per dot at its size and place in its strand, set across the route and fanning in by its distance from the stretch\'s ends, brighter on a busy stretch, scaled together, dimmed while a story is selected and hidden while their islands rise', () => {
  const dots = [-0.1, 0.1].flatMap(across => [0, 1, 2].map(x => ({ at: new Vector3(x, 100, 0), along: new Vector3(1, 0, 0), across, ends: [x + 0.5, 2.5 - x] as const })));
  const stretches = [{ id: 's', size: 0.4, strands: 2, carries: [['p'], ['q']], bright: 0.25, islands: [['a', 'b'] as const], dots }];
  const geometry = laneDots(stretches), material = laneDotMaterial();
  const position = geometry.getAttribute('position'), corner = geometry.getAttribute('corner');
  assert.equal(position.count, 24, 'four corners a dot');
  for (let i = 0; i < position.count; i++) {
    const dot = dots[Math.floor(i / 4)]!, centre = dot.at;
    assert.ok(new Vector3().fromBufferAttribute(position, i).sub(centre).projectOnPlane(centre.clone().normalize()).length() < 1e-5, 'about its dot\'s place');
    assert.ok(Math.abs(Math.abs(corner.getX(i)) - 1) < 1e-9 && Math.abs(Math.abs(corner.getY(i)) - 1) < 1e-9, 'each corner of a unit square the shader rounds and sizes');
    assert.ok(Math.abs(geometry.getAttribute('size').getX(i) - 0.4) < 1e-6, 'its size');
    assert.equal(geometry.getAttribute('order').getX(i), Math.floor(i / 4) % 3, 'its place in its strand, for the scale to keep every second at the next step');
    assert.ok(Math.abs(geometry.getAttribute('across').getX(i) - dot.across) < 1e-6, 'its strand\'s place across the route');
    assert.deepEqual([geometry.getAttribute('ends').getX(i), geometry.getAttribute('ends').getY(i)], [...dot.ends], 'how far it is from the stretch\'s two ends');
    assert.equal(geometry.getAttribute('bright').getX(i), 0.25, 'how bright its stretch is');
  }
  assert.equal(`#${material.uniforms.uColour!.value.getHexString()}`, SEA_LANE);
  assert.equal(`#${material.uniforms.uBright!.value.getHexString()}`, SEA_LANE_FILL, 'a busy stretch tinted towards the fill');
  assert.equal(material.uniforms.uFan!.value, LANE_STRANDS.fan * SEA_LANE_ONE, 'fanning in as strandSpread does');
  const lane = laneMaterial(SEA_LANE, 1);
  drawLane(lane, 1, 0, 10, 8);
  assert.equal(lane.uniforms.uScale!.value, 8, 'a fill scales with the dots');
  // Measured as the screen draws it: one unit of the drawing, scaled up twice, seen square on by a camera zoomed twice.
  const mesh = new Mesh(geometry);
  mesh.scale.setScalar(2);
  mesh.updateMatrixWorld();
  const centre = mesh.localToWorld(geometry.boundingSphere!.center.clone());
  const camera = new PerspectiveCamera(50, 1.5, 0.1, 1000);
  camera.position.copy(centre).add(new Vector3(0, 0, 300));
  camera.zoom = 2;
  camera.lookAt(centre);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const pixels = (centre.clone().add(new Vector3(0, 2, 0)).project(camera).y - centre.clone().project(camera).y) * 900 / 2;
  assert.ok(Math.abs(worldPerPixel(mesh, geometry, camera, 900) - 1 / pixels) < 1e-9, 'the drawing\'s own units a pixel across');
  assert.equal(worldPerPixel(mesh, geometry, new OrthographicCamera(), 900), 0, 'no reading but through a perspective eye');
  assert.equal(worldPerPixel(mesh, geometry, camera, 0), 0, 'nor on a canvas with no height');
  assert.equal(worldPerPixel(mesh, new BufferGeometry(), camera, 900), 0, 'nor of a drawing with no extent yet');
  assert.equal(laneScale(0), 1, 'and with no reading, lanes are their ground width');
  geometry.dispose();
  material.dispose();
  lane.dispose();
});
