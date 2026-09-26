// parcel-cells.ts — the island's ground cells in the basis anything standing ON them works in,
// and the one route from the SHIPPED descriptor stream into it.
//
// ⚠⚠ WHY THIS EXISTS AS ITS OWN MODULE. `harness/prop-layout.ts` has owned `GPoint` and
// `LayoutCell` since the procedural dressing, and it is 1,100 lines of scatter, stand, meander and
// loop machinery that the shipped map has no use for. When the bought kit crossed on 2026-08-30 it
// needed the two TYPES and a way to reach them from `worldTo3D`'s output — not the machinery. So
// the shapes crossed and the machinery stayed, and `harness/prop-layout.ts` re-exports them, which
// is what stops the harness and the product disagreeing about what a cell is.
//
// ⚠ THE `y`-MEANS-`z` TRAP, and it is why the conversion happens in exactly one place. The scene
// is authored in a 2D drawing basis where the second coordinate is `y`; the ground is a 3D plane
// where it is `z`. Converting ad hoc downstream is how a placement ends up rotated ninety degrees
// from the land it is standing on, and the picture looks merely odd rather than wrong.
//
// ⚠⚠ THE SHIPPED BASIS IS THE ISLAND'S TRUE FOOTPRINT SINCE 2026-09-05 (ADR-0517 D1). Until then
// `worldTo3D` mapped the drawing's `(x, y)` straight to `(x, 0, z)`, so the shipped island was the
// PROJECTED shape used as a ground plane — 234 units wide and 46 deep, measurably squashed — and
// this header warned that the harness's `groundCellsFrom` (which unprojects) and the shipped path
// (which did not) were two different bases. The mapper now unprojects per island itself
// (`true-footprint.ts`), so the two agree on the island's shape; they still differ by where the
// island sits (the harness unprojects about the drawing's origin, the mapper about each island's
// own centre, holding the layout still). What matters here is unchanged: a prop placed off these
// rings and lifted by `landRelief.height` sits on the ground the canvas actually draws, because
// both read the same numbers.

import type { Descriptor3D } from './world-to-3d.js';

/** A ground-space point. x east, z south — the space `landHeight(x, z)` takes. */
export interface GPoint {
  x: number;
  z: number;
}

/** One cell's outline in `{x, z}`, plus the capability whose parcel it belongs to, the STORY whose
 *  island it sits on, and the folded status it wears. The form everything that stands on the
 *  ground works in.
 *
 *  ⚠ `parcel` AND `island` ARE TWO DIFFERENT QUESTIONS AND BOTH ARE NEEDED. A capability's tree
 *  stands on its own parcel; a story's UAT bloom stands anywhere on its own ISLAND and on no
 *  other. One id cannot answer both, and answering the second with the first is how a story's
 *  signatures end up scattered over its neighbours. */
export interface LayoutCell {
  points: GPoint[];
  parcel: string | undefined;
  island: string | undefined;
  status: string;
  cellId: string | undefined;
}

/**
 * THE SHIPPED DESCRIPTOR STREAM'S GROUND CELLS, in the placement basis.
 *
 * ⚠ A CELL WITH NO `parcel` IS KEPT, NOT DROPPED, and the distinction is load-bearing. Dropping
 * it would silently shrink the island a whole-story prop (a UAT bloom) may stand on, and on a
 * substrate with no parcel groups at all it would shrink it to nothing — an island that reports
 * none of the work, drawn with no error anywhere. Callers that need per-capability identity group
 * by `parcel` and get an honest absence.
 */
export function parcelCellsFrom(descriptors: readonly Descriptor3D[]): LayoutCell[] {
  const out: LayoutCell[] = [];
  for (const d of descriptors) {
    if (d.kind !== 'cell-ground') continue;
    const ring = d.points;
    if (!ring || ring.length < 3) continue;
    // ANNOTATED local, then guarded assignments — `anti-slop/no-conditional-empty-object-spread`.
    const cell: LayoutCell = {
      points: ring.map((p) => ({ x: p.x, z: p.z })),
      parcel: d.parcel,
      island: d.island,
      status: d.material ?? 'unknown',
      cellId: undefined,
    };
    out.push(cell);
  }
  return out;
}

/** Group cells by the capability whose parcel they belong to, in first-seen order. Cells carrying
 *  no parcel are left out of every group — they belong to no capability, which is a different
 *  thing from belonging to a group of unnamed ones. */
export function cellsByParcel(cells: readonly LayoutCell[]): Map<string, LayoutCell[]> {
  const out = new Map<string, LayoutCell[]>();
  for (const cell of cells) {
    if (cell.parcel === undefined) continue;
    const list = out.get(cell.parcel);
    if (list) list.push(cell);
    else out.set(cell.parcel, [cell]);
  }
  return out;
}

/**
 * Group cells by the STORY whose island they sit on, in first-seen order.
 *
 * ⚠ CELLS CARRYING NO ISLAND ARE LEFT OUT, and unlike {@link cellsByParcel}'s absence this one is
 * fail-CLOSED on purpose. A caller groups by island precisely so a per-story claim lands on the
 * right story's ground; a bucket of cells the substrate could not attribute is exactly the ground
 * no such claim may be drawn on. Dropping them here means an unattributed island grows no blooms
 * rather than growing everyone's — the same choice the shipped call sites were already making with
 * `blooms: 0`, now made per island instead of for the whole map.
 */
export function cellsByIsland(cells: readonly LayoutCell[]): Map<string, LayoutCell[]> {
  const out = new Map<string, LayoutCell[]>();
  for (const cell of cells) {
    if (cell.island === undefined) continue;
    const list = out.get(cell.island);
    if (list) list.push(cell);
    else out.set(cell.island, [cell]);
  }
  return out;
}
