import assert from 'node:assert/strict';
import test from 'node:test';
import { Mesh, Vector3, type Object3D } from 'three';
import type { InstanceDescriptor } from '../world-to-3d.js';
import { forestDescriptors } from '../index.js';
import { clipToCoast, islandSurface, PLATE_CLEARANCE, rimLoops, SHIPPED_COAST } from '../geometry.js';
import { onIslandSurface } from './PlanetWorldCanvas.js';

const R = 218;
const trees = ['c1', 'c2', 'c3'].map((capability, i) => ({ capability, form: 'green' as const, contracts: 1, x: i, z: 0, scale: 1, turn: 0 }));
const descriptors = forestDescriptors({ islands: [{ story: 's', title: 'S', x: 0, z: 0, radius: 1, key: 's', trees }] });
const cells = clipToCoast(descriptors.filter((d): d is InstanceDescriptor => d.kind === 'cell-ground' && d.points !== undefined), SHIPPED_COAST);
const coast = rimLoops(cells.map(c => c.points!));

test('6.5 an island on the globe is one ground surface and a coast line per rim, lying on the globe, with marks laid on it', () => {
  const surface = islandSurface(coast, R, 's');
  const parts: Object3D[] = [];
  surface.traverse(o => { if (o !== surface) parts.push(o); });
  assert.ok(parts.every(o => o instanceof Mesh), 'nothing but the ground and its coast');
  assert.equal(parts.filter(o => o.name === 'island-ground').length, 1);
  assert.equal(parts.filter(o => o.name.startsWith('island-coast')).length, coast.length);
  const centre = new Vector3(0, -(R + PLATE_CLEARANCE), 0);
  const ground = parts.find(o => o.name === 'island-ground') as Mesh;
  const at = ground.geometry.attributes.position!;
  for (let i = 0; i < at.count; i++) assert.ok(Math.abs(new Vector3().fromBufferAttribute(at, i).distanceTo(centre) - (R + PLATE_CLEARANCE)) < 1e-6);
  const mark = onIslandSurface(R)(coast[0]![0]!);
  assert.ok(Math.abs(mark.distanceTo(centre) - (R + PLATE_CLEARANCE)) < 1e-6, 'a mark laid on the land sits on its surface');
});
