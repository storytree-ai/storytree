/** ADR-0648's bounded packing proof: the look's real seven shores and all 36 sample shores. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3, Vector2 } from 'three';
import { forestScene, placeOnGlobe, PLANET_RADIUS } from '@storytree/forest';
import { workStates } from '@storytree/arc-surface';
import { clipToCoast, rimLoops, SHIPPED_COAST } from '../coast-clip.js';
import { forestDescriptors } from '../forest-ground/forest-ground.js';
import { plateTransform } from './planet.js';
import type { InstanceDescriptor } from '../world-to-3d.js';

const health = { reported: { state: 'not-checked' as const }, verified: { state: 'not-checked' as const } };
// Actual story ids and counts from spike/globe-land's spacing.json. Coast shape depends on id.
const seed = ['story_c49a3e654505', 'story_5575e4b90dd3', 'story_f9e22610d77a', 'story_af6675767df3',
  'story_3112ce58d261', 'story_430046bf71e9', 'story_3fb7c1773675'];
const counts = [8, 4, 5, 10, 7, 6, 13];

function inside(point: Vector2, polygon: Vector2[]): boolean {
  let within = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) within = !within;
  }
  return within;
}

function separated(a: Vector3[], b: Vector3[], na: Vector3, nb: Vector3): boolean {
  // Disjoint spherical caps need no polygon projection (which fails for near-antipodal pairs).
  const reach = (points: Vector3[], n: Vector3) => Math.max(...points.map(p => p.angleTo(n)));
  if (na.angleTo(nb) > reach(a, na) + reach(b, nb)) return true;
  const front = na.clone().add(nb).normalize(), x = nb.clone().sub(na).normalize(), y = front.clone().cross(x);
  // Gnomonic projection preserves the straight edges of radially projected tangent plates.
  const project = (p: Vector3) => {
    assert.ok(p.dot(front) > 0);
    return new Vector2(p.dot(x) / p.dot(front), p.dot(y) / p.dot(front));
  };
  const pa = a.map(project), pb = b.map(project);
  if (inside(pa[0]!, pb) || inside(pb[0]!, pa)) return false;
  const cross = (p: Vector2, q: Vector2, r: Vector2) => q.clone().sub(p).cross(r.clone().sub(p));
  const on = (p: Vector2, q: Vector2, r: Vector2) => Math.abs(cross(p, q, r)) < 1e-12 &&
    r.x >= Math.min(p.x, q.x) && r.x <= Math.max(p.x, q.x) && r.y >= Math.min(p.y, q.y) && r.y <= Math.max(p.y, q.y);
  // Test the actual concave coasts, including every edge; convex hulls would fill their bays.
  return pa.every((p, i) => pb.every((u, j) => {
    const q = pa[(i + 1) % pa.length]!, v = pb[(j + 1) % pb.length]!;
    const crossing = cross(p, q, u) * cross(p, q, v) < 0 && cross(u, v, p) * cross(u, v, q) < 0;
    return !crossing && !on(p, q, u) && !on(p, q, v) && !on(u, v, p) && !on(u, v, q);
  }));
}

test('1.6 packed neighbours never overlap through all 36 measured places, at their real shore sizes including beaches', () => {
  for (const ids of [seed, Array.from({ length: 36 }, (_, i) => `synthetic-story-${i + 1}`)]) {
    const shores = ids.map((id, i) => {
      const story = { id, title: id, health, capabilities: Array.from({ length: counts[i % counts.length]! }, (_, c) => ({
        id: `${id}-cap-${c}`, title: `Capability ${c}`, dependsOn: [], contracts: [], health,
      })) };
      const scene = forestScene({ stories: [story], arcs: [] }, [], workStates([]));
      const coast = clipToCoast(forestDescriptors(scene).filter((d): d is InstanceDescriptor => d.kind === 'cell-ground' && d.points !== undefined), SHIPPED_COAST);
      const spot = placeOnGlobe(i + 1), normal = new Vector3(spot.x, spot.y, spot.z).normalize();
      const { position, quaternion } = plateTransform(normal, PLANET_RADIUS);
      const rings = rimLoops(coast.map(c => c.points!));
      assert.equal(rings.length, 1, 'each sample has one closed coast');
      const points = rings[0]!.map(p =>
        new Vector3(p.x, 0, p.z).applyQuaternion(quaternion).add(new Vector3(...position)).normalize());
      assert.ok(points.length > 2, 'a real closed shore was measured');
      return { normal, points };
    });
    for (let i = 1; i < shores.length; i++) for (let j = 0; j < i; j++) {
      assert.ok(separated(shores[i]!.points, shores[j]!.points, shores[i]!.normal, shores[j]!.normal),
        `${ids[j]} / ${ids[i]} overlap at places ${j + 1} / ${i + 1}`);
    }
  }
});
