/**
 * Capability 1 · Knowledge under its shelves. Under the glass sheet (ADR-1043 D5): each shelf's notes hang beneath its
 * place on the sheet, a story's under its island and a capability's under its territory, one step deeper per computed
 * depth, as a sunflower so a deep shelf reads as a column hanging from its land. Notes no shelf reaches lie in a pool
 * along the sheet's south edge, just under the glass. The links between hung notes are returned too, to be drawn as lines.
 * Positions are in the sheet's own frame: x east, y north, z up from the glass, so a hung note's z is below zero.
 */
import type { RecordEnvelope } from "@storytree/library";
import { linksOf } from "../ghosts/ghosts.js";
import type { Core } from "./shelves.js";
import type { GlobePoint } from "./positions.js";
import { isStoryText } from "./story-text.js";

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** How far under the glass the first depth hangs, and how far apart siblings at one depth spread, in ground units. */
const FIRST_BELOW = 6;
const SPREAD = 6;

export interface SheetHanging {
  /** Where a shelf (a story or capability id) stands on the sheet, or undefined for one not drawn. */
  shelfAt(node: string): { x: number; y: number } | undefined;
  /** The pool's rectangle on the sheet, for notes no shelf reaches. */
  pool: { x: number; y: number; width: number; height: number };
  /** How much deeper each depth hangs than the one above it, in ground units. */
  depthStep: number;
}

/** Every drawn note's place under the sheet, and each stored link (a `links` or `supersedes`) between two of them. */
export function sheetPoints(core: Core, { shelfAt, pool, depthStep }: SheetHanging, notes?: ReadonlyMap<string, RecordEnvelope>): { points: GlobePoint[]; links: [string, string][] } {
  const drawn = (id: string) => {
    const record = notes?.get(id);
    return record === undefined || !isStoryText(record);
  };
  const points: GlobePoint[] = [];
  const siblings = new Map<string, number>();
  for (const placement of [...core.placed.values()].sort((a, b) => compare(a.note, b.note))) {
    if (!drawn(placement.note)) continue;
    const shelf = shelfAt(placement.home);
    if (shelf === undefined) continue;
    const key = `${placement.home} ${placement.depth}`, index = siblings.get(key) ?? 0;
    siblings.set(key, index + 1);
    const r = SPREAD * Math.sqrt(index), a = index * GOLDEN;
    points.push({ id: placement.note, at: { x: shelf.x + r * Math.cos(a), y: shelf.y + r * Math.sin(a), z: -(FIRST_BELOW + placement.depth * depthStep) },
      depth: placement.depth, home: placement.home });
  }
  const loose = core.outside.filter(drawn).sort(compare);
  const columns = Math.max(1, Math.ceil(Math.sqrt(loose.length * pool.width / Math.max(pool.height, 1))));
  const rows = Math.max(1, Math.ceil(loose.length / columns));
  loose.forEach((id, i) => {
    const column = i % columns, row = Math.floor(i / columns);
    points.push({ id, at: { x: pool.x + (column + 0.5) * pool.width / columns, y: pool.y + pool.height - (row + 0.5) * pool.height / rows, z: -FIRST_BELOW },
      depth: undefined, home: undefined });
  });
  const hung = new Set(points.map(point => point.id));
  const links: [string, string][] = [];
  const seen = new Set<string>();
  for (const { id } of points) {
    const record = notes?.get(id);
    if (record === undefined) continue;
    const supersedes = Array.isArray(record.fields.supersedes) ? record.fields.supersedes.filter((v): v is string => typeof v === "string") : [];
    for (const to of [...linksOf(record), ...supersedes]) {
      if (to === id || !hung.has(to)) continue;
      const key = id < to ? `${id} ${to}` : `${to} ${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push([id, to]);
    }
  }
  return { points, links };
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
