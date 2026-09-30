/** Story node render 3.8 (ADR-0804 D1): an island is one flat, pale, see-through surface with a coast line. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Mesh, MeshBasicMaterial, Vector3, type Object3D } from 'three';
import { workStates } from '@storytree/arc-surface';
import { forestScene, placeOnPackedGlobe, PLANET_RADIUS } from '../index.js';
import { buildPlanetPathways } from '../../../forest-world/src/planet/pathways.js';
import { islandSurface } from '../../../forest-world/src/planet/island-surface.js';
import { PLATE_CLEARANCE } from '../../../forest-world/src/planet/planet.js';

const health = { reported: { state: 'not-checked' as const }, verified: { state: 'not-checked' as const } };
const capability = (id: string, dependsOn: string[]) =>
  ({ id, title: id, dependsOn, proposed: true, status: 'proposed' as const, contracts: [], health });
const tree = { arcs: [], stories: [
  { id: 'a', title: 'A', health, capabilities: [capability('a1', []), capability('a2', ['a1']), capability('a3', ['a2'])] },
  { id: 'b', title: 'B', health, capabilities: [capability('b1', ['a1']), capability('b2', ['b1', 'a2'])] },
] };
const scene = forestScene(tree, [], workStates([]));
const spots = new Map(tree.stories.map((s, i) => [s.id, placeOnPackedGlobe(i + 1)]));
const plates = buildPlanetPathways(scene, spots, PLANET_RADIUS).plates;

function all(root: Object3D): Object3D[] {
  const found: Object3D[] = [];
  root.traverse(object => { if (object !== root) found.push(object); });
  return found;
}
const S = PLANET_RADIUS + PLATE_CLEARANCE;

test('3.8 an island is drawn as one ground surface and its coast, with no pines, plants or other props', () => {
  for (const [story, plate] of plates) {
    const surface = islandSurface(plate.coast, PLANET_RADIUS, story);
    assert.equal(surface.name, `island-surface:${story}`);
    const kinds = all(surface).map(object => object.name.split(':')[0]);
    assert.deepEqual([...new Set(kinds)].sort(), ['island-coast', 'island-ground']);
    assert.equal(all(surface).filter(object => object.name === 'island-ground').length, plate.coast.length > 0 ? 1 : 0);
    assert.ok(all(surface).every(object => object instanceof Mesh), 'nothing else is mounted');
  }
});

test('3.8 the ground is one pale see-through surface conformed to the globe, covering exactly the coast', () => {
  const plate = plates.get('a')!;
  const surface = islandSurface(plate.coast, PLANET_RADIUS, 'a');
  const ground = all(surface).find(object => object.name === 'island-ground') as Mesh;
  const material = ground.material as MeshBasicMaterial;
  // Meaning outranks appearance: a line diving through into the core must stay visible through it.
  assert.ok(material.transparent && material.opacity > 0 && material.opacity <= 0.5);
  assert.equal(material.depthWrite, false);
  assert.equal(material.vertexColors, false, 'no banded land colouring: one colour');
  assert.equal(Object.keys(ground.geometry.attributes).sort().join(), 'normal,position');
  // Every vertex lies on the sphere the plate rests on (local frame: origin at S above the centre).
  const centre = new Vector3(0, -S, 0), at = ground.geometry.attributes.position!;
  let area = 0;
  for (let i = 0; i < at.count; i++) {
    const p = new Vector3().fromBufferAttribute(at, i);
    assert.ok(Math.abs(p.distanceTo(centre) - S) < 1e-6, 'the surface follows the globe');
  }
  const index = ground.geometry.index!;
  for (let i = 0; i < index.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map(k => new Vector3().fromBufferAttribute(at, index.getX(i + k)));
    area += ((b!.x - a!.x) * (c!.z - a!.z) - (c!.x - a!.x) * (b!.z - a!.z)) / 2;
  }
  const shoelace = (ring: readonly { x: number; z: number }[]) =>
    ring.reduce((sum, p, i) => sum + (p.x * ring[(i + 1) % ring.length]!.z - ring[(i + 1) % ring.length]!.x * p.z), 0) / 2;
  const outline = plate.coast.map(shoelace).map(Math.abs).sort((x, y) => y - x);
  const expected = outline[0]! - outline.slice(1).reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(Math.abs(area) - expected) < expected * 0.02, `covers ${Math.abs(area)} of ${expected}`);
});

test('3.8 the coast is a thin band centred on every point of the island rim, on the same sphere', () => {
  const plate = plates.get('b')!;
  const surface = islandSurface(plate.coast, PLANET_RADIUS, 'b');
  const bands = all(surface).filter((object): object is Mesh => object.name.startsWith('island-coast'));
  assert.equal(bands.length, plate.coast.length);
  const centre = new Vector3(0, -S, 0);
  bands.forEach((band, ring) => {
    const at = band.geometry.attributes.position!;
    assert.equal(at.count, 2 * plate.coast[ring]!.length, 'one vertex either side of each rim point');
    for (let i = 0; i < plate.coast[ring]!.length; i++) {
      const [a, b] = [2 * i, 2 * i + 1].map(k => new Vector3().fromBufferAttribute(at, k));
      assert.ok(Math.abs((a!.x + b!.x) / 2 - plate.coast[ring]![i]!.x) < 1e-5 && Math.abs((a!.z + b!.z) / 2 - plate.coast[ring]![i]!.z) < 1e-5, 'centred on the rim');
      assert.ok(a!.distanceTo(b!) > 0.1 && a!.distanceTo(b!) < 3, 'a thin line, not a fill');
      assert.ok(Math.abs(a!.distanceTo(centre) - S) < 1e-6 && Math.abs(b!.distanceTo(centre) - S) < 1e-6);
    }
  });
});
