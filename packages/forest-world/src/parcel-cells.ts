// parcel-cells.ts — the island's ground cells in the basis anything standing ON them works in,
// and the one route from the SHIPPED descriptor stream into it.
//
// ⚠ THE `y`-MEANS-`z` TRAP, and it is why the conversion happens in exactly one place. The relaxed
// mesh is built in 0.2's 2D drawing basis, where the second coordinate is `y`; the ground is a 3D
// plane where it is `z`. `forest-ground.ts` converts each ring once as it emits the cell, and this
// module reads only `x` and `z`. Converting ad hoc downstream is how a placement ends up rotated
// ninety degrees from the land it is standing on, and the picture looks merely odd rather than wrong.
//
// ⚠ THE BASIS IS THE ISLAND'S TRUE FOOTPRINT (ADR-0517 D1). `forestDescriptors` builds each island
// in plan view and sizes it about its own centre (`true-footprint.ts`). The globe's
// `planet/island-surface.ts` projects these local coordinates onto its visible surface.

import type { Descriptor3D } from './descriptors.js';

/** A ground-space point. x east, z south. */
export interface GPoint {
  x: number;
  z: number;
}

/** One cell's outline in `{x, z}`, plus the capability whose parcel it belongs to, the STORY whose
 *  island it sits on, and the folded status it wears. The form everything that stands on the
 *  ground works in.
 *
 *  ⚠ `parcel` AND `island` ARE TWO DIFFERENT QUESTIONS AND BOTH ARE NEEDED. A capability owns its
 *  own parcel; a story owns its whole ISLAND and no other. One id cannot answer both, and answering
 *  the second with the first is how a story's ground ends up scattered over its neighbours. */
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
 * it would silently shrink the island a whole-story claim reads, and on a
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
 * no such claim may be drawn on. Dropping them here means an unattributed cell belongs to no
 * story's ground rather than to everyone's.
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
