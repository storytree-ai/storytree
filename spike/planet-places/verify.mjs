// Measurement sanity checks, kept with the throwaway spike, not a product test suite.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dot, footprint, unit, shoreGap } from './shore-geometry.mjs';

const data = JSON.parse(await readFile(new URL('./results/measurements.json', import.meta.url), 'utf8'));
const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const checks = [];
assert.equal(data.groundPerPlace, 110);
for (const m of data.measurements) {
  for (const p of m.places) {
    near(dot(p.normal, p.normal), 1);
    near(dot(p.east, p.east), 1);
    near(dot(p.north, p.north), 1);
    near(dot(p.normal, p.east), 0);
    near(dot(p.normal, p.north), 0);
    near(dot(p.east, p.north), 0);
  }
  for (const count of m.counts) {
    assert.equal(count.frontCentres + count.backCentres, count.count);
    // Independent acos implementation of the all-pair centre scan.
    let minimum = Infinity;
    for (let i = 1; i < count.count; i++) for (let j = 0; j < i; j++) {
      const d = Math.acos(Math.max(-1, Math.min(1, dot(m.places[i].normal, m.places[j].normal)))) * m.radius;
      minimum = Math.min(minimum, d);
    }
    for (const size of count.sizes) {
      near(size.centreArc, minimum);
      const actual = m.shores.find(s => s.capabilities === size.capabilities).byCount.find(s => s.count === count.count);
      assert.ok(actual.gap + 1e-7 >= size.tangentCapGap, 'Real coast clearance must respect the enclosing-circle bound');
    }
  }
}
checks.push('All 27 radius/count/capability readings agree with an independent acos centre scan; tangent frames orthonormal and coast gaps respect bounds.');

// Independently approximate two critical positive coast minima using ONLY
// densely sampled points and maximum dot products, with no arc-distance code.
for (const [mi, caps, count] of [[0, 6, 36], [2, 19, 100]]) {
  const m = data.measurements[mi];
  const actual = m.shores.find(s => s.capabilities === caps).byCount.find(s => s.count === count);
  const shapes = data.shapes.find(s => s.capabilities === caps).islands;
  const dense = index => {
    const coast = shapes[index].coast[0];
    const points = coast.flatMap((a, i) => {
      const b = coast[(i + 1) % coast.length];
      return Array.from({ length: 8 }, (_, k) => a.map((x, j) => x + (b[j] - x) * k / 8));
    });
    return footprint(points, m.places[index], m.radius);
  };
  const [a, b] = actual.places.map(p => dense(p - 1));
  let maxDot = -1;
  for (const p of a) for (const q of b) maxDot = Math.max(maxDot, dot(p, q));
  const sampled = m.radius * Math.acos(Math.min(1, maxDot));
  assert.ok(sampled >= actual.gap - 1e-6 && sampled < actual.gap + .02);
  checks.push(`Independent dense coast sampling: R=${m.radius.toFixed(3)}, ${caps} caps, places ${actual.places.join('/')} -> ${sampled.toFixed(6)} vs exact ${actual.gap.toFixed(6)} ground units (within 0.02).`);
}

// An analytic pair of equatorial arcs encoded as degenerate closed triangles:
// [0, .1] and [.3, .4] radians have a .2-radian gap. They exercise interior
// projection and endpoints independently of the real-ground fixture.
const p = a => [Math.sin(a), 0, Math.cos(a)];
near(shoreGap([p(0), p(.05), p(.1)], [p(.3), p(.35), p(.4)], p(.05), p(.35)).angle, .2);
const square = [[-1, -1, 10], [1, -1, 10], [1, 1, 10], [-1, 1, 10]].map(unit);
const small = [[-.5, -.5, 10], [.5, -.5, 10], [.5, .5, 10], [-.5, .5, 10]].map(unit);
assert.equal(shoreGap(square, small, [0, 0, 1], [0, 0, 1]).overlap, true);
checks.push('Analytic .2-radian gap and polygon containment checks pass.');
console.log(checks.join('\n'));
