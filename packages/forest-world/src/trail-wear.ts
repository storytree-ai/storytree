// trail-wear.ts — THE DISTANCE-TO-PATH FIELD, layer 3's carrier. What `build_land_grid()` computes
// as `pdist` in `build_land.py:483-494` — a distance field to the path polyline, capped at the
// wear falloff — stated as a reader the wear atlas can sample per texel.
//
// ⚠⚠ THE POLYLINES ARE OPEN, AND THAT IS THE WHOLE DIFFERENCE FROM THE SHORE. The shore field
// indexes coast RINGS: each ring's last vertex joins back to its first, because a coast is a
// loop. A worn path has two ends and NO edge between them. Flattening a path through the ring
// flattener would add a straight chord from the far landing back to the first one, and the wear
// would follow it across the interior as a second, perfectly straight track nobody authored —
// invisible in any single sample, obvious in the picture. `polylineEdges` is the open flattener;
// `shore-grid.ts`'s `ringEdges` is the closed one, and the two are separate functions on purpose.
//
// ⚠ IT IS THE SHORE'S OWN WALK, over a differently-flattened edge set. `nearestOnSegments` and
// `buildSegmentGrid` are shared with `shoreField`, so the far-field short-circuit, the exactness
// argument (`edgeGridFarField`) and the 3x3 candidate scan are the same code the shore atlas
// already proved — and the field costs the same per texel, which is what makes it affordable at
// forest scale (`wear-atlas.ts` records the measured build).
//
// ⚠ THE CAP IS THE WEAR FALLOFF. `wearOf` clips at `1 - d / falloff`, so past `falloff` every
// distance delivers zero wear whatever its exact value; a field capped at exactly that width
// carries everything the recipe's scalar can read and nothing it cannot.

import type { CoastPoint } from './coast-clip.js';
import { WEAR_FALLOFF } from './land-wear.js';
import { indices } from './land-shadow.js';
import {
  buildSegmentGrid,
  nearestOnSegments,
  type CoastEdge,
  type NearestSample,
} from './shore-grid.js';

/** The worn-path field, as the thing the wear atlas asks it. */
export interface WearFieldReader {
  /** The falloff this field was built for — its cap, in ground units. */
  readonly width: number;
  /** How many open segments it indexes, over every polyline. */
  readonly segments: number;
  /** Ground units to the nearest point of any path, CAPPED at {@link WearFieldReader.width}. */
  sample(x: number, z: number): NearestSample;
}

/**
 * OPEN polylines, flattened to edges — consecutive pairs ONLY. A one-point polyline contributes
 * nothing; a two-point one contributes exactly one edge.
 *
 * ⚠ NO CLOSING CHORD, and the header says why: a path has two ends, and joining them draws a
 * track across the island that nobody authored.
 */
export function polylineEdges(polylines: readonly (readonly CoastPoint[])[]): CoastEdge[] {
  const edges: CoastEdge[] = [];
  for (const line of polylines) {
    for (const i of indices(line.length - 1)) {
      const a = line[i]!;
      const b = line[i + 1]!;
      edges.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
    }
  }
  return edges;
}

/**
 * THE DISTANCE-TO-PATH FIELD over a set of open polylines, capped at `width`.
 *
 * ⚠ THE GRID'S CELL IS THE CAP, exactly as the shore field's is: `buildSegmentGrid(edges, width)`
 * sets the cell to `width`, and `nearestOnSegments` caps at the same `width`, so the far-field
 * short-circuit's proof ({@link edgeGridFarField}) holds by construction. Passing the grid one
 * width and the walk another would break it silently.
 */
export function wearField(
  polylines: readonly (readonly CoastPoint[])[],
  width: number = WEAR_FALLOFF,
): WearFieldReader {
  const edges = polylineEdges(polylines);
  const grid = buildSegmentGrid(edges, width);
  return {
    width,
    segments: edges.length,
    sample(x: number, z: number): NearestSample {
      return nearestOnSegments(grid, x, z, width);
    },
  };
}
