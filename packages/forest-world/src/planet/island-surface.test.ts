import assert from 'node:assert/strict';
import test from 'node:test';
import { FrontSide, Mesh, MeshBasicMaterial, Raycaster, Vector3, type Intersection, type Object3D } from 'three';
import type { InstanceDescriptor } from '../world-to-3d.js';
import { forestDescriptors } from '../index.js';
import { clipToCoast, islandSurface, PLATE_CLEARANCE, rimLoops, SHIPPED_COAST } from '../geometry.js';
import { onIslandSurface } from './PlanetWorldCanvas.js';
import { ISLAND_DEPTH_INSET } from './island-surface.js';

const R = 218;
const trees = ['c1', 'c2', 'c3'].map((capability, i) => ({ capability, form: 'green' as const, contracts: 1, x: i, z: 0, scale: 1, turn: 0 }));
const descriptors = forestDescriptors({ islands: [{ story: 's', title: 'S', x: 0, z: 0, radius: 1, key: 's', trees }] });
const cells = clipToCoast(descriptors.filter((d): d is InstanceDescriptor => d.kind === 'cell-ground' && d.points !== undefined), SHIPPED_COAST);
const coast = rimLoops(cells.map(c => c.points!));

test('6.5 an island on the globe is one ground surface and a coast line per rim, lying on the globe, with marks laid on it', () => {
  const surface = islandSurface(coast, R, 's');
  const parts: Object3D[] = [];
  surface.traverse(o => { if (o !== surface) parts.push(o); });
  assert.ok(parts.every(o => o instanceof Mesh), 'nothing but the ground, its depth and its coast');
  assert.equal(parts.filter(o => o.name === 'island-ground').length, 1);
  assert.equal(parts.filter(o => o.name.startsWith('island-coast')).length, coast.length);
  const centre = new Vector3(0, -(R + PLATE_CLEARANCE), 0);
  const ground = parts.find(o => o.name === 'island-ground') as Mesh;
  const at = ground.geometry.attributes.position!;
  for (let i = 0; i < at.count; i++) assert.ok(Math.abs(new Vector3().fromBufferAttribute(at, i).distanceTo(centre) - (R + PLATE_CLEARANCE)) < 1e-6);
  const mark = onIslandSurface(R)(coast[0]![0]!);
  assert.ok(Math.abs(mark.distanceTo(centre) - (R + PLATE_CLEARANCE)) < 1e-6, 'a mark laid on the land sits on its surface');
});

test('6.11 an island facing the viewer hides what lies behind it, and nothing laid on its land', () => {
  const surface = islandSurface(coast, R, 's');
  const depth = surface.getObjectByName('island-depth') as Mesh;
  assert.ok(depth, 'the island has a depth layer');
  const material = depth.material as MeshBasicMaterial;
  // ADR-0919 D2: it writes depth and no colour, in the opaque pass, before any see-through line or note behind it is drawn.
  assert.deepEqual([material.colorWrite, material.depthWrite, material.depthTest, material.transparent], [false, true, true, false]);
  // Only its outward face is drawn: an island seen from behind, through the glass, hides nothing.
  assert.equal(material.side, FrontSide);
  const centre = new Vector3(0, -(R + PLATE_CLEARANCE), 0);
  const at = depth.geometry.attributes.position!;
  const index = depth.geometry.index!;
  const vertex = (i: number) => new Vector3().fromBufferAttribute(at, index.getX(i));
  for (let i = 0; i < index.count; i += 3) {
    const [a, b, c] = [vertex(i), vertex(i + 1), vertex(i + 2)];
    const face = b.clone().sub(a).cross(c.clone().sub(a));
    // A sliver along a straight coast edge has no area and no facing to get wrong.
    if (face.length() / 2 < 0.01) continue;
    assert.ok(face.dot(a.clone().sub(centre)) > 0, 'each triangle faces out of the globe');
  }
  // Just under the land: a straight 25-unit chord laid on the surface (a territory triangle's edge sags most) stays in front.
  const sphere = R + PLATE_CLEARANCE;
  for (let i = 0; i < at.count; i++) assert.ok(Math.abs(new Vector3().fromBufferAttribute(at, i).distanceTo(centre) - (sphere - ISLAND_DEPTH_INSET)) < 1e-6);
  const chordSag = sphere - Math.sqrt(sphere ** 2 - 12.5 ** 2);
  assert.ok(ISLAND_DEPTH_INSET > chordSag && ISLAND_DEPTH_INSET <= 1, `${ISLAND_DEPTH_INSET} under the land, where a chord sags ${chordSag}`);
  // It is never picked: picking finds the island by its ground.
  const hits: Intersection[] = [];
  depth.raycast(new Raycaster(new Vector3(0, 50, 0), new Vector3(0, -1, 0)), hits);
  assert.deepEqual(hits, []);
});
