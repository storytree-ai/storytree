// Radially project the real, rigid tangent plate onto the sphere. Its straight
// shoreline edges become minor great-circle arcs. Distances below are angular.
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = v => { const n = Math.hypot(...v); return v.map(x => x / n); };
export const angle = (a, b) => Math.atan2(Math.hypot(...cross(a, b)), dot(a, b));
export function footprint(loop, place, R) {
  return loop.map(([x, y]) => unit(place.normal.map((n, k) => R * n + x * place.east[k] + y * place.north[k])));
}

const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function crosses(a, b, c, d) {
  if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
      Math.max(a[1], b[1]) < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < Math.min(a[1], b[1])) return false;
  return orient(a, b, c) * orient(a, b, d) <= 0 && orient(c, d, a) * orient(c, d, b) <= 0;
}
function inside(p, ring) {
  let odd = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) odd = !odd;
  }
  return odd;
}
function edges(ring) {
  return ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    return { a, b, normal: unit(cross(a, b)) };
  });
}
function pointArc(p, { a, b, normal }) {
  const h = dot(p, normal);
  const q = unit(p.map((x, i) => x - h * normal[i]));
  if (dot(cross(a, q), normal) >= -1e-13 && dot(cross(q, b), normal) >= -1e-13) {
    return Math.asin(Math.min(1, Math.abs(h)));
  }
  return Math.min(angle(p, a), angle(p, b));
}

export function shoreGap(a, b, na, nb) {
  // Gnomonic projection preserves great-circle edges and polygon intersections.
  // The caller only sends nearby pairs whose coasts fit in this shared hemisphere.
  const n = unit(na.map((x, k) => x + nb[k]));
  const east = unit(cross(Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0], n));
  const north = cross(n, east);
  const project = p => {
    const depth = dot(p, n);
    if (depth <= 0) throw new Error('Pair does not fit a shared gnomonic chart');
    return [dot(p, east) / depth, dot(p, north) / depth];
  };
  const pa = a.map(project), pb = b.map(project);
  if (inside(pa[0], pb) || inside(pb[0], pa)) return { angle: 0, overlap: true };
  for (let i = 0; i < pa.length; i++) for (let j = 0; j < pb.length; j++) {
    if (crosses(pa[i], pa[(i + 1) % pa.length], pb[j], pb[(j + 1) % pb.length])) return { angle: 0, overlap: true };
  }
  // Disjoint minor geodesic segments attain their distance at an endpoint of
  // at least one segment. Check both point-to-arc directions, including endpoints.
  let best = Infinity;
  const ea = edges(a), eb = edges(b);
  for (const p of a) for (const edge of eb) best = Math.min(best, pointArc(p, edge));
  for (const p of b) for (const edge of ea) best = Math.min(best, pointArc(p, edge));
  return { angle: best, overlap: false };
}

export function measureShore(shapes, places, R, counts) {
  const footprints = shapes.map((s, i) => footprint(s.coast[0], places[i], R));
  const pairs = [];
  for (let i = 1; i < shapes.length; i++) for (let j = 0; j < i; j++) {
    pairs.push({ i, j, lowerBound: R * (angle(places[i].normal, places[j].normal) -
      Math.atan(shapes[i].shoreRadius / R) - Math.atan(shapes[j].shoreRadius / R)) });
  }
  pairs.sort((a, b) => a.lowerBound - b.lowerBound);
  const cache = new Map();
  function exact(pair) {
    const key = `${pair.i}:${pair.j}`;
    if (!cache.has(key)) {
      const result = shoreGap(footprints[pair.i], footprints[pair.j], places[pair.i].normal, places[pair.j].normal);
      cache.set(key, { gap: result.angle * R, overlap: result.overlap, places: [pair.j + 1, pair.i + 1] });
    }
    return cache.get(key);
  }
  const byCount = counts.map(count => {
    let best = { gap: Infinity };
    for (const pair of pairs) {
      if (pair.i >= count) continue;
      if (pair.lowerBound >= best.gap) break;
      const result = exact(pair);
      if (result.gap < best.gap) best = result;
      if (best.overlap) break;
    }
    return { count, ...best };
  });
  // Find the earliest actual overlap in this fixture, independently of the
  // nearest pair at 5 / 36 / 100. Only overlapping envelopes need narrow checks.
  let firstOverlap = null;
  for (const pair of pairs) {
    if (pair.lowerBound > 0) break;
    if (firstOverlap && pair.i + 1 >= firstOverlap.places[1]) continue;
    const result = exact(pair);
    if (result.overlap) firstOverlap = result;
  }
  return { byCount, firstOverlap, evaluatedPairs: cache.size };
}
