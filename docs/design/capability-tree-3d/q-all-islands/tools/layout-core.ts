import type { Border, Cell, Point, TerritoryMap, TerritoryShare } from "../../../../../packages/forest/src/territories/territories.ts";

export type P = Point;

export const CUT = 260;
export const OPEN = "";
export const UNCLAIMED = "unclaimed";

const close = (a: P, b: P) => Math.abs(a.x - b.x) < 1e-5 && Math.abs(a.z - b.z) < 1e-5;

export function sharedEdge(a: Cell, b: Cell): [P, P] | undefined {
  const common = a.polygon.filter(p => b.polygon.some(q => close(p, q)));
  return common.length >= 2 ? [common[0]!, common[common.length - 1]!] : undefined;
}

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

export const LIBRARY_LAND = 24105;
const ringArea = (r: readonly P[]) => Math.abs(r.reduce((s, a, i) => { const b = r[(i + 1) % r.length]!; return s + a.x * b.z - b.x * a.z; }, 0) / 2);
export const islandScale = (coast: readonly (readonly P[])[]) => Math.sqrt(coast.reduce((s, r) => s + ringArea(r), 0) / LIBRARY_LAND);
const times = (p: P, k: number): P => ({ x: p.x * k, z: p.z * k });
export const scaleCoast = (coast: readonly (readonly P[])[], k: number) => coast.map(r => r.map(p => times(p, k)));
export function scaleMap<M extends TerritoryMap>(map: M, k: number): M {
  if (k === 1) return map;
  return { ...map, radius: map.radius * k, ...(map.coast ? { coast: scaleCoast(map.coast, k) } : {}),
    cells: map.cells.map(c => ({ ...c, site: times(c.site, k), polygon: c.polygon.map(p => times(p, k)) })),
    borders: map.borders.map(b => ({ ...b, from: times(b.from, k), to: times(b.to, k) })) };
}

export const CODELESS = 1;
export function withCodeless(shares: readonly TerritoryShare[], capabilities: readonly { id: string; title: string; description?: string; word: string; parked?: boolean }[]): TerritoryShare[] {
  const held = new Map(shares.filter(s => s.capability !== undefined).map(s => [s.capability!, s]));
  return [...capabilities.map(c => held.get(c.id) ?? ({ capability: c.id, title: c.title, ...(c.description === undefined ? {} : { description: c.description }), status: c.word, ...(c.parked ? { parked: true } : {}), lines: CODELESS } as TerritoryShare)),
    ...shares.filter(s => s.capability === undefined || !capabilities.some(c => c.id === s.capability))];
}
