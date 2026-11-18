// Capability 4 · The planet

export interface StoreTile { readonly name: string; readonly x: number; readonly z: number; readonly width: number; readonly depth: number }

export interface StoreLayout { readonly width: number; readonly depth: number; readonly reach: number; readonly tiles: readonly StoreTile[] }

const TILE_WIDTH = 80;
const NAME_SIZE = 13;
const CHARACTER = 8;
const NAME_ROOM = 16;
const TILE_DEPTH = 30;
const GAP = 8;
const PAD = 12;
const HEADING = 36;
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

export function tableNameSize(pixels: number): number {
  return NAME_SIZE * Math.min(1, pixels);
}

export function tableNameSizes(laid: StoreLayout, drawn: (x: number, z: number) => readonly [number, number]): Map<string, number> {
  return new Map(laid.tiles.map((tile) => {
    const [wx, wy] = drawn(tile.x - tile.width / 2, tile.z), [ex, ey] = drawn(tile.x + tile.width / 2, tile.z);
    return [tile.name, tableNameSize(Math.hypot(ex - wx, ey - wy) / tile.width)];
  }));
}
