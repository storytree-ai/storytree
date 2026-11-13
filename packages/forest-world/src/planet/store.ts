/**
 * Capability 4 · The planet. A shared store's own flat object on the sheet (ADR-1332 D1): a slab beside the islands, never
 * part of one's land, with its tables laid inside it as tiles in rows, west to east then north to south, in the order given.
 * Each column of tiles is as wide as the longest table name in it, so every name stays whole inside its own tile.
 * A store with no tables (a Redis, say) is a bare slab. On the slab x runs east and z south, about its middle, in ground units.
 */

/** One table's tile on its store: its middle and size. */
export interface StoreTile { readonly name: string; readonly x: number; readonly z: number; readonly width: number; readonly depth: number }

/** A store's slab, its tables' tiles, and its reach: how far from its middle its corners lie. */
export interface StoreLayout { readonly width: number; readonly depth: number; readonly reach: number; readonly tiles: readonly StoreTile[] }

/** The least tile, so a store of short names stands as large as a middling island. */
const TILE_WIDTH = 80;
/** A name is drawn 13px across at about a pixel a ground unit at the map's opening: under 8 a character, with room at its ends. */
const CHARACTER = 8;
const NAME_ROOM = 16;
const TILE_DEPTH = 30;
const GAP = 8;
const PAD = 12;
/** The strip along the slab's north edge kept for the store's own name. */
const HEADING = 36;
/** The least slab, for a store with no tables. */
const BARE = { width: 120, depth: 60 };

export function storeLayout(tables: readonly string[]): StoreLayout {
  const columns = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
  const rows = Math.ceil(tables.length / columns);
  const across = Array.from({ length: columns }, (_, column) =>
    Math.max(TILE_WIDTH, ...tables.filter((_, index) => index % columns === column).map((name) => name.length * CHARACTER + NAME_ROOM)));
  const west = across.map((_, column) => across.slice(0, column).reduce((sum, w) => sum + w + GAP, 0));
  const width = Math.max(BARE.width, 2 * PAD + across.reduce((sum, w) => sum + w, 0) + (columns - 1) * GAP);
  const depth = Math.max(BARE.depth, HEADING + PAD + rows * TILE_DEPTH + Math.max(0, rows - 1) * GAP);
  const tiles = tables.map((name, index) => ({
    name,
    x: -width / 2 + PAD + west[index % columns]! + across[index % columns]! / 2,
    z: -depth / 2 + HEADING + Math.floor(index / columns) * (TILE_DEPTH + GAP) + TILE_DEPTH / 2,
    width: across[index % columns]!,
    depth: TILE_DEPTH,
  }));
  return { width, depth, reach: Math.hypot(width, depth) / 2, tiles };
}
