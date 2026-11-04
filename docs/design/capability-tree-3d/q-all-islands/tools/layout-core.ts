/** Round 9's layout core (round 10 keeps it), shared by the layout tool (Node) and the page (through territories-shim.ts): the map's own cutter
 * (`territories()`), run finer (CUT cells), with each cell handed to the territory the link layout chose, or left OPEN:
 * open land, owned by no territory, which the map draws as bare island ground and its borders outline. Pure: no three,
 * no DOM. */
import type { Border, Cell, Point, TerritoryMap, TerritoryShare } from "../../../../../packages/forest/src/territories/territories.ts";

export type P = Point;

/** How finely the island is cut: about twice the map's own 120, so territories can shrink and still follow their lines. */
export const CUT = 260;
/** A cell owned by no territory: open land. Its `territory` is -1, which the map's drawing and picking pass over. */
export const OPEN = "";
/** Rollout 1: the territory of an island's code no capability claims (the map's Unclaimed code), which has no capability
 * id; an arrangement names it by this. */
export const UNCLAIMED = "unclaimed";

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
  const index = new Map(map.territories.map((t, at) => [t.capability ?? UNCLAIMED, at]));
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

/** Rollout 1: The library's land in ground units (this snapshot's), the size every round so far was tuned at. */
export const LIBRARY_LAND = 24105;
const ringArea = (r: readonly P[]) => Math.abs(r.reduce((s, a, i) => { const b = r[(i + 1) % r.length]!; return s + a.x * b.z - b.x * a.z; }, 0) / 2);
/** An island's scale against The library's: the square root of its land over The library's. The map cuts every island into
 * about the same number of cells and the page frames each to fill the window at rest, so the look is laid out on the island
 * scaled to The library's size (`scaleMap` by 1 / scale) and drawn back at its own: at rest every island's gates, symbols,
 * roads and ports stand as large on the page as The library's, and its cells give a gate the room they give it there. */
export const islandScale = (coast: readonly (readonly P[])[]) => Math.sqrt(coast.reduce((s, r) => s + ringArea(r), 0) / LIBRARY_LAND);
const times = (p: P, k: number): P => ({ x: p.x * k, z: p.z * k });
export const scaleCoast = (coast: readonly (readonly P[])[], k: number) => coast.map(r => r.map(p => times(p, k)));
/** A territory map with every point scaled by `k` about the island's middle. */
export function scaleMap<M extends TerritoryMap>(map: M, k: number): M {
  if (k === 1) return map;
  return { ...map, radius: map.radius * k, ...(map.coast ? { coast: scaleCoast(map.coast, k) } : {}),
    cells: map.cells.map(c => ({ ...c, site: times(c.site, k), polygon: c.polygon.map(p => times(p, k)) })),
    borders: map.borders.map(b => ({ ...b, from: times(b.from, k), to: times(b.to, k) })) };
}

/** Rollout 1: every capability holds land. The map gives land only to code (a territory's size is its lines), so a
 * capability with no code yet has none and its links have no settlement to reach: on The command line, 7 of 13
 * capabilities and 24 links. Here each such capability gets a share of CODELESS lines, so round 13's minimum gives it the
 * smallest territory, in the story's order, coloured by its word as the map colours any (CODELESS=0 in the layout tool: as the map). */
export const CODELESS = 1;
export function withCodeless(shares: readonly TerritoryShare[], capabilities: readonly { id: string; title: string; description?: string; word: string; parked?: boolean }[]): TerritoryShare[] {
  const held = new Map(shares.filter(s => s.capability !== undefined).map(s => [s.capability!, s]));
  return [...capabilities.map(c => held.get(c.id) ?? ({ capability: c.id, title: c.title, ...(c.description === undefined ? {} : { description: c.description }), status: c.word, ...(c.parked ? { parked: true } : {}), lines: CODELESS } as TerritoryShare)),
    ...shares.filter(s => s.capability === undefined || !capabilities.some(c => c.id === s.capability))];
}
