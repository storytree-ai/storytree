// Capability 4 · The planet

import type { Descriptor3D } from './descriptors.js';

export interface GPoint {
  x: number;
  z: number;
}

export interface LayoutCell {
  points: GPoint[];
  parcel: string | undefined;
  island: string | undefined;
  status: string;
  cellId: string | undefined;
}

export function parcelCellsFrom(descriptors: readonly Descriptor3D[]): LayoutCell[] {
  const out: LayoutCell[] = [];
  for (const d of descriptors) {
    if (d.kind !== 'cell-ground') continue;
    const ring = d.points;
    if (!ring || ring.length < 3) continue;
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
