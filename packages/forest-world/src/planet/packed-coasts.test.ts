/** ADR-0648's bounded packing proof: the look's real seven shores and all 36 sample shores. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3, Vector2 } from 'three';
import { forestScene, placeOnGlobe, PLANET_RADIUS } from '@storytree/forest';
import { workStates } from '@storytree/arc-surface';
import { clipToCoast, rimLoops, SHIPPED_COAST } from '../coast-clip.js';
import { forestDescriptors } from '../forest-ground/forest-ground.js';
import { plateTransform } from './planet.js';

const health = { reported: { state: 'not-checked' as const }, verified: { state: 'not-checked' as const } };
// Actual story ids and counts from spike/globe-land's spacing.json. Coast shape depends on id.
const seed = ['story_c49a3e654505', 'story_5575e4b90dd3', 'story_f9e22610d77a', 'story_af6675767df3',
  'story_3112ce58d261', 'story_430046bf71e9', 'story_3fb7c1773675'];
const counts = [8, 4, 5, 10, 7, 6, 13];

function hull(points: Vector2[]): Vector2[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (ps: Vector2[]) => {
    const out: Vector2[] = [];
    for (const p of ps) {
      while (out.length > 1 && out.at(-1)!.clone().sub(out.at(-2)!).cross(p.clone().sub(out.at(-1)!)) <= 0) out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...half(sorted), ...half(sorted.reverse())];
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
  const ha = hull(a.map(project)), hb = hull(b.map(project));
  return [ha, hb].some(poly => poly.some((p, i) => {
    const edge = poly[(i + 1) % poly.length]!.clone().sub(p), axis = new Vector2(-edge.y, edge.x);
    const pa = ha.map(v => v.dot(axis)), pb = hb.map(v => v.dot(axis));
    return Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa);
  }));
}

test('1.6 packed neighbours never overlap through all 36 measured places, at their real shore sizes including beaches', () => {
  for (const ids of [seed, Array.from({ length: 36 }, (_, i) => `synthetic-story-${i + 1}`)]) {
    const shores = ids.map((id, i) => {
      const story = { id, title: id, health, capabilities: Array.from({ length: counts[i % counts.length]! }, (_, c) => ({
        id: `${id}-cap-${c}`, title: `Capability ${c}`, dependsOn: [], contracts: [], health,
      })) };
      const scene = forestScene({ stories: [story], arcs: [] }, [], workStates([]));
      const coast = clipToCoast(forestDescriptors(scene).filter(d => d.kind === 'cell-ground'), SHIPPED_COAST);
      const spot = placeOnGlobe(i + 1), normal = new Vector3(spot.x, spot.y, spot.z).normalize();
      const { position, quaternion } = plateTransform(normal, PLANET_RADIUS);
      const points = rimLoops(coast.map(c => c.points!)).flat().map(p =>
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
