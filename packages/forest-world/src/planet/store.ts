/**
 * Capability 4 · The planet. A shared store's own flat object on the sheet (ADR-1332 D1): a slab beside the islands, never
 * part of one's land, with its tables laid inside it as tiles in rows, west to east then north to south, in the order given.
 * A store with no tables (a Redis, say) is a bare slab. On the slab x runs east and z south, about its middle, in ground units.
 */

/** One table's tile on its store: its middle and size. */
export interface StoreTile { readonly name: string; readonly x: number; readonly z: number; readonly width: number; readonly depth: number }

/** A store's slab, its tables' tiles, and its reach: how far from its middle its corners lie. */
export interface StoreLayout { readonly width: number; readonly depth: number; readonly reach: number; readonly tiles: readonly StoreTile[] }

/** A tile is as wide as a table's name drawn at the map's opening, so a store stands as large as a middling island. */
const TILE_WIDTH = 36;
const TILE_DEPTH = 12;
const GAP = 4;
const PAD = 6;
/** The strip along the slab's north edge kept for the store's own name. */
const HEADING = 16;
/** The least slab, for a store with no tables. */
const BARE = { width: 60, depth: 30 };

export function storeLayout(tables: readonly string[]): StoreLayout {
  const columns = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
  const rows = Math.ceil(tables.length / columns);
  const width = Math.max(BARE.width, 2 * PAD + columns * TILE_WIDTH + (columns - 1) * GAP);
  const depth = Math.max(BARE.depth, HEADING + PAD + rows * TILE_DEPTH + Math.max(0, rows - 1) * GAP);
  const tiles = tables.map((name, index) => ({
    name,
    x: -width / 2 + PAD + (index % columns) * (TILE_WIDTH + GAP) + TILE_WIDTH / 2,
    z: -depth / 2 + HEADING + Math.floor(index / columns) * (TILE_DEPTH + GAP) + TILE_DEPTH / 2,
    width: TILE_WIDTH,
    depth: TILE_DEPTH,
  }));
  return { width, depth, reach: Math.hypot(width, depth) / 2, tiles };
}
