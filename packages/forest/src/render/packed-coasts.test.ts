/** ADR-0648's bounded packing proof: the look's real seven shores and all 36 sample shores. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3, Vector2 } from 'three';
import { forestScene, placeOnGlobe, PLANET_RADIUS } from '../index.js';
import { workStates } from '@storytree/arc-surface';
import { forestDescriptors, type InstanceDescriptor } from '@storytree/forest-world';
import { clipToCoast, plateTransform, RIBBON_GROUND_SCALE, rimLoops, SHIPPED_COAST, trailFillWidth } from '@storytree/forest-world/geometry';

const health = { reported: { state: 'not-checked' as const }, verified: { state: 'not-checked' as const } };
// Actual story ids and counts from spike/globe-land's spacing.json. Coast shape depends on id.
const seed = ['story_c49a3e654505', 'story_5575e4b90dd3', 'story_f9e22610d77a', 'story_af6675767df3',
  'story_3112ce58d261', 'story_430046bf71e9', 'story_3fb7c1773675'];
// Regression: a fresh seed on 2026-09-27 overlapped places 1/2 under the look-only table.
const freshSeed = ["story_a9a21c44a1e7", "story_a1c7adb510b4", "story_730a208989d1", "story_c9107adf051c", "story_4280df77bc0e", "story_3c99aeeade44", "story_1e9d6400be09"];
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

test('1.6 / 3.8 all 36 measured places leave the approved trunk clearance between their clipped coasts', () => {
  for (const ids of [seed, freshSeed, Array.from({ length: 36 }, (_, i) => `synthetic-story-${i + 1}`)]) {
    const shores = ids.map((id, i) => {
      const story = { id, title: id, health, capabilities: Array.from({ length: counts[i % counts.length]! }, (_, c) => ({
        id: `${id}-cap-${c}`, title: `Capability ${c}`, dependsOn: [], proposed: true, status: "proposed" as const, contracts: [], health,
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
    // The approved look reserved four ribbon widths for a 22-link trunk (ADR-0655 D3).
    // This is the fixed placement envelope, not a refit to the live graph.
    const gap = 4 * trailFillWidth(22) * RIBBON_GROUND_SCALE;
    const arcDistance = (p: Vector3, a: Vector3, b: Vector3): number => {
      const n = a.clone().cross(b).normalize();
      const foot = p.clone().addScaledVector(n, -p.dot(n)).normalize();
      let d = Math.min(p.angleTo(a), p.angleTo(b));
      for (const q of [foot, foot.clone().negate()]) {
        if (a.angleTo(q) + q.angleTo(b) <= a.angleTo(b) + 1e-9) d = Math.min(d, p.angleTo(q));
      }
      return d * PLANET_RADIUS;
    };
    for (let i = 1; i < shores.length; i++) for (let j = 0; j < i; j++) {
      assert.ok(separated(shores[i]!.points, shores[j]!.points, shores[i]!.normal, shores[j]!.normal),
        `${ids[j]} / ${ids[i]} overlap at places ${j + 1} / ${i + 1}`);
      const a = shores[i]!, b = shores[j]!;
      const reach = (s: typeof a) => Math.max(...s.points.map(p => p.angleTo(s.normal)));
      if (PLANET_RADIUS * (a.normal.angleTo(b.normal) - reach(a) - reach(b)) >= gap) continue;
      for (const [one, other] of [[a.points, b.points], [b.points, a.points]]) {
        for (const p of one!) for (let k = 0; k < other!.length; k++) {
          assert.ok(arcDistance(p, other![k]!, other![(k+1)%other!.length]!) >= gap,
            `${ids[j]} / ${ids[i]} need at least ${gap} ground units for the ribbon`);
        }
      }
    }
  }
});
