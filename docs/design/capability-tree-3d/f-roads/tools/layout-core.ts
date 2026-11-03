/** Round 9's layout core, shared by the layout tool (Node) and the page (through territories-shim.ts): the map's own cutter
 * (`territories()`), run finer (CUT cells), with each cell handed to the territory the link layout chose, or left OPEN:
 * open land, owned by no territory, which the map draws as bare island ground and its borders outline. Pure: no three,
 * no DOM. */
import type { Border, Cell, Point, TerritoryMap } from "../../../../../packages/forest/src/territories/territories.ts";

export type P = Point;

/** How finely the island is cut: about twice the map's own 120, so territories can shrink and still follow their lines. */
export const CUT = 260;
/** A cell owned by no territory: open land. Its `territory` is -1, which the map's drawing and picking pass over. */
export const OPEN = "";

const close = (a: P, b: P) => Math.abs(a.x - b.x) < 1e-5 && Math.abs(a.z - b.z) < 1e-5;

/** The edge two neighbouring cells share: the two corners of `a`'s outline that are also corners of `b`'s. */
export function sharedEdge(a: Cell, b: Cell): [P, P] | undefined {
  const common = a.polygon.filter(p => b.polygon.some(q => close(p, q)));
  return common.length >= 2 ? [common[0]!, common[common.length - 1]!] : undefined;
}

/** Every cell pair's shared edge, once, for a cut. */
const edgeCache = new WeakMap<readonly Cell[], Map<string, [P, P]>>();
export function cellEdges(cells: readonly Cell[]): Map<string, [P, P]> {
  const known = edgeCache.get(cells);
  if (known) return known;
  const out = new Map<string, [P, P]>();
  for (const a of cells) for (const n of a.neighbours) if (n > a.index) {
    const e = sharedEdge(a, cells[n]!);
    if (e) out.set(`${a.index}:${n}`, e);
  }
  edgeCache.set(cells, out);
  return out;
}

/** The cut with each cell given to `owners[cell]` (a capability id, or OPEN), its borders drawn again between the new owners:
 * between two territories, and between a territory and open land (its outline), never between two open cells. */
export function relayout(map: TerritoryMap, owners: readonly string[]): TerritoryMap {
  if (owners.length !== map.cells.length) throw new Error(`layout has ${owners.length} cells, the map cut ${map.cells.length}`);
  const index = new Map(map.territories.map((t, at) => [t.capability, at]));
  const cells = map.cells.map((cell, at): Cell => {
    const territory = owners[at] === OPEN ? -1 : index.get(owners[at]!);
    if (territory === undefined) throw new Error(`layout names ${owners[at]}, which the island does not hold`);
    return { ...cell, territory };
  });
  const borders: Border[] = [];
  for (const [key, [from, to]] of cellEdges(map.cells)) {
    const [a, b] = key.split(":").map(Number) as [number, number];
    if (cells[a]!.territory !== cells[b]!.territory) borders.push({ from, to, between: [a, b] });
  }
  return { ...map, cells, borders };
}
