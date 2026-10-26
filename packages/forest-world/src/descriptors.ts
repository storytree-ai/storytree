// Capability 1 · Scene layout. descriptors.ts — the ground cells the globe draws, as the drawing engine hands them over.
//
// Since ADR-0920 the engine builds only the ground under the globe's islands (`forest-ground.ts`):
// one `cell-ground` descriptor per relaxed-mesh cell, carrying its capability's parcel and its
// island. 0.2's trees, flora, blooms, caves and wisps, and the 2D scene they were mapped from, are
// gone with the flat canvas; git holds them at bef6dd7b.

/** A 3D ground-plane position: x east, z south, y up (always 0 on the ground). */
export interface Transform3D {
  x: number;
  y: number;
  z: number;
}

/** One ground cell of an island. */
export interface InstanceDescriptor {
  kind: 'cell-ground';
  /** The cell's middle. */
  transform: Transform3D;
  group: 'cell-ground';
  /** The status of the capability whose parcel the cell is in (the island's own, for an island with no parcel). */
  material?: string;
  /** The cell's closed ring, each vertex once, at a tenth of a ground unit. */
  points?: Transform3D[];
  /** The story whose island the cell is on. */
  island?: string;
  /**
   * The capability whose parcel the cell is in. Not derivable from anything else on the cell:
   * `material` folds two capabilities in the same state into one value. Absent on an island with
   * no capability yet.
   */
  parcel?: string;
}

/** What the engine hands the globe: its ground cells. */
export type Descriptor3D = InstanceDescriptor;
