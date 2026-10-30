/**
 * Capability 1 · Knowledge under its shelves. Under the glass sheet (ADR-1043 D5, ADR-1063): each note is pulled toward every
 * island its links reach, links counting both ways. A note one island reaches hangs under it, one reached from two or more
 * settles between them, nearer the ones it has more links to, and neighbours at one depth keep room from each other (D1).
 * A note a shelf reaches hangs at its computed depth; one no shelf reaches but which links to hung knowledge, one step below
 * the deepest note it links to (D2). Notes with no links, or linked only among themselves, lie on one floor below the
 * deepest hanging note, spread across the islands' footprint, each linked group together (D3). There is no pool.
 * The links between drawn notes are returned too, to be drawn as lines.
 * Positions are in the sheet's own frame: x east, y north, z up from the glass, so a hung note's z is below zero.
 */
import type { RecordEnvelope } from "@storytree/library";
import { linksOf } from "../ghosts/ghosts.js";
import type { Core } from "./shelves.js";
import type { GlobePoint } from "./positions.js";

/** How far under the glass the first depth hangs, and the room neighbours at one depth keep, in ground units. */
const FIRST_BELOW = 6;
const ROOM = 6;
/** The relaxation's fixed number of rounds, and how hard a note is drawn each round toward its islands and its linked neighbours. */
const ROUNDS = 80;
const ISLAND_PULL = 0.15;
const LINK_PULL = 0.04;
/** The most a note is drawn toward its islands in one round. */
const MOST_PULL = 1;
/** Linked notes draw together only when further apart than this, in ground units, so links gather without crushing. */
const LINK_SLACK = 3 * ROOM;

interface Area { x: number; y: number; width: number; height: number }
interface Flat { x: number; y: number }

export interface SheetHanging {
  /** Where a shelf (a story or capability id) stands on the sheet, or undefined for one not drawn. */
  shelfAt(node: string): Flat | undefined;
  /** The islands' footprint on the sheet, which the sea floor spreads across (D3). */
  floor: Area;
  /** How much deeper each depth hangs than the one above it, in ground units. */
  depthStep: number;
}

/** A note's place under the sheet, and the shelves pulling it, strongest first: none for a note on the sea floor. */
export interface SheetPoint extends GlobePoint { toward: string[] }

/** The sheet as laid out: every drawn note's place, each stored link between two drawn notes, and the sea floor. */
export interface SheetLayout { points: SheetPoint[]; links: [string, string][]; floor: Area & { z: number; notes: number } }

/**
 * A sheet that lays out again only when what it lays out changed (Live updates never freeze the globe): read again with the
 * same notes, links, shelves and floor, however fresh the objects handed it, it returns its last layout without relaxing.
 */
export function sheetLayout(): (core: Core, hanging: SheetHanging, notes?: ReadonlyMap<string, RecordEnvelope>) => SheetLayout {
  let last: { key: string; layout: SheetLayout } | undefined;
  return (core, hanging, notes) => {
    const key = layoutKey(core, hanging, notes);
    if (last?.key !== key) last = { key, layout: sheetPoints(core, hanging, notes) };
    return last.layout;
  };
}

/** Everything sheetPoints reads, written out: each note's shelves and where they stand, its depth and links, and the floor. */
function layoutKey(core: Core, { shelfAt, floor, depthStep }: SheetHanging, notes?: ReadonlyMap<string, RecordEnvelope>): string {
  const ids = [...core.placed.keys(), ...core.outside].sort(compare);
  const where = (shelf: string) => { const at = shelfAt(shelf); return at === undefined ? "-" : `${at.x},${at.y}`; };
  const parts = ids.map(id => {
    const placement = core.placed.get(id);
    const record = notes?.get(id);
    const shelves = placement === undefined ? "" : `${placement.depth}:${placement.entrances.map(shelf => `${shelf}@${where(shelf)}`).join(";")}`;
    return `${id}|${shelves}|${record === undefined ? "" : storedLinks(record).join(";")}`;
  });
  return `${floor.x},${floor.y},${floor.width},${floor.height},${depthStep}\n${parts.join("\n")}`;
}

/** A note's stored links: its `links` and what it `supersedes`. */
function storedLinks(record: RecordEnvelope): string[] {
  const supersedes = Array.isArray(record.fields.supersedes) ? record.fields.supersedes.filter((v): v is string => typeof v === "string") : [];
  return [...linksOf(record), ...supersedes];
}

/** Every drawn note's place under the sheet, the sea floor's plane and how many notes lie on it, and each stored link (a `links` or `supersedes`) between two drawn notes. */
export function sheetPoints(core: Core, { shelfAt, floor, depthStep }: SheetHanging, notes?: ReadonlyMap<string, RecordEnvelope>): SheetLayout {
  const ids = [...core.placed.keys(), ...core.outside].sort(compare);
  const drawn = new Set(ids);
  const links: [string, string][] = [];
  const near = new Map<string, Map<string, number>>(ids.map(id => [id, new Map()]));
  const seen = new Set<string>();
  for (const id of ids) {
    const record = notes?.get(id);
    if (record === undefined) continue;
    for (const to of storedLinks(record)) {
      if (to === id || !drawn.has(to)) continue;
      // Links count both ways (D1), and each stored link once, however many times it is stored.
      const key = id < to ? `${id} ${to}` : `${to} ${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push([id, to]);
      near.get(id)!.set(to, 1 + (near.get(id)!.get(to) ?? 0));
      near.get(to)!.set(id, 1 + (near.get(to)!.get(id) ?? 0));
    }
  }

  // Each hung note's pulls, shelf to weight, summing to one, and its depth.
  const pulls = new Map<string, Map<string, number>>();
  const depths = new Map<string, number>();
  for (const id of ids) {
    const placement = core.placed.get(id);
    const shelves = placement?.entrances.filter(shelf => shelfAt(shelf) !== undefined) ?? [];
    if (placement === undefined || shelves.length === 0) continue;
    // A shelf pulls one, and once more for each link to a note that shelf also reaches.
    const weights = new Map(shelves.map(shelf => [shelf, 1 + [...near.get(id)!].reduce((sum, [other, count]) => sum + (core.placed.get(other)?.entrances.includes(shelf) ? count : 0), 0)]));
    pulls.set(id, normalised(weights));
    depths.set(id, placement.depth);
  }
  // Out from the hung notes, one ring of links at a time: a note no shelf reaches takes the pulls of the hung notes it links
  // to, each link carrying its neighbour's, and hangs one step below the deepest of them (D2).
  for (let ring = ids.filter(id => !pulls.has(id) && [...near.get(id)!.keys()].some(other => pulls.has(other))); ring.length > 0;
    ring = ids.filter(id => !pulls.has(id) && [...near.get(id)!.keys()].some(other => pulls.has(other)))) {
    const taken = ring.map(id => {
      const weights = new Map<string, number>();
      let deepest = 0;
      for (const [other, count] of near.get(id)!) {
        const theirs = pulls.get(other);
        if (theirs === undefined) continue;
        for (const [shelf, weight] of theirs) weights.set(shelf, (weights.get(shelf) ?? 0) + count * weight);
        deepest = Math.max(deepest, depths.get(other)!);
      }
      return [id, normalised(weights), deepest + 1] as const;
    });
    for (const [id, weights, depth] of taken) { pulls.set(id, weights); depths.set(id, depth); }
  }

  const deepest = Math.max(0, ...depths.values());
  const below = (depth: number) => -(FIRST_BELOW + depth * depthStep);
  const seaZ = below(deepest + 1);
  const sea = ids.filter(id => !pulls.has(id));

  // Where each note is drawn toward: the weighted middle of its shelves, or its group's place on the floor.
  const target = new Map<string, Flat>();
  for (const [id, weights] of pulls) {
    let x = 0, y = 0;
    for (const [shelf, weight] of weights) { const at = shelfAt(shelf)!; x += weight * at.x; y += weight * at.y; }
    target.set(id, { x, y });
  }
  for (const [members, at] of floorGroups(sea, near, floor)) for (const id of members) target.set(id, at);

  const layer = (id: string) => (pulls.has(id) ? depths.get(id)! : deepest + 1);
  const at = relax(ids, target, layer, near);
  const inside = (p: Flat) => ({ x: clamp(p.x, floor.x, floor.x + floor.width), y: clamp(p.y, floor.y, floor.y + floor.height) });
  const points = ids.map((id): SheetPoint => {
    const weights = pulls.get(id);
    const toward = weights === undefined ? [] : [...weights].sort(([a, wa], [b, wb]) => wb - wa || compare(a, b)).map(([shelf]) => shelf);
    const p = weights === undefined ? inside(at.get(id)!) : at.get(id)!;
    return { id, at: { x: p.x, y: p.y, z: weights === undefined ? seaZ : below(depths.get(id)!) }, depth: depths.get(id), home: toward[0], toward };
  });
  return { points, links, floor: { ...floor, z: seaZ, notes: sea.length } };
}

/** The notes lit when a story is selected (D4): every note pulled toward any of its shelves, wherever it sits. */
export function sheetLit(points: readonly Pick<SheetPoint, "id" | "toward">[], selected: string, storyOf: (node: string) => string | undefined): Set<string> {
  return new Set(points.filter(point => point.toward.some(shelf => storyOf(shelf) === selected)).map(point => point.id));
}

/** The links drawn under the sheet (ADR-1061 D3): none at rest, and with a story selected exactly those touching its `notes`. */
export function selectedLinks<Link extends readonly [string, string]>(links: readonly Link[], notes: ReadonlySet<string> | undefined): Link[] {
  return notes === undefined ? [] : links.filter(([a, b]) => notes.has(a) || notes.has(b));
}

/**
 * The sea floor's linked groups, each with its place on the floor: scattered over the footprint by note id, then pushed
 * apart until each keeps an even share of the floor, so the floor reads as a scatter, not a grid, and never piles at an edge.
 */
function floorGroups(sea: readonly string[], near: ReadonlyMap<string, ReadonlyMap<string, number>>, floor: Area): [string[], Flat][] {
  const grouped = new Set<string>(), groups: string[][] = [];
  for (const id of sea) {
    if (grouped.has(id)) continue;
    const members = [id];
    grouped.add(id);
    for (let i = 0; i < members.length; i++) for (const other of near.get(members[i]!)!.keys()) if (!grouped.has(other)) { grouped.add(other); members.push(other); }
    groups.push(members.sort(compare));
  }
  if (groups.length === 0) return [];
  // Each group's own room, as wide as its members need, and an even share of the floor between groups.
  const share = Math.sqrt(floor.width * floor.height / groups.length) * 0.8;
  const room = (members: readonly string[]) => ROOM * Math.sqrt(members.length) / 2;
  const centre = new Map(groups.map((members, i) => [i, { x: floor.x + floor.width * seeded(members[0]!, 1), y: floor.y + floor.height * seeded(members[0]!, 2) }]));
  const keys = groups.map((_, i) => i);
  const reach = Math.max(share, 2 * Math.max(...groups.map(room)) + ROOM);
  for (let round = 0; round < ROUNDS; round++) {
    const push = apart(keys, centre, () => 0, (a, b) => Math.max(share, room(groups[a]!) + room(groups[b]!) + ROOM), i => groups[i]![0]!, reach);
    for (const i of keys) {
      const p = centre.get(i)!, by = push.get(i)!;
      centre.set(i, { x: clamp(p.x + by.x, floor.x, floor.x + floor.width), y: clamp(p.y + by.y, floor.y, floor.y + floor.height) });
    }
  }
  return groups.map((members, i) => [members, centre.get(i)!]);
}

/**
 * The fixed, seeded relaxation (D1): each note starts scattered by its id across a disc round its target as wide as the crowd
 * sharing that target needs; then for a fixed number of rounds it is pushed out of any neighbour's room at its depth, drawn
 * back toward its target only once outside that disc, and toward its linked neighbours only once they are far apart. With no
 * pull inside the disc a crowd spreads instead of being crushed. Every round moves all notes at once, so the order notes are
 * met in never matters, and one note added moves only those it crowds. (Measured: started from where the last reading drew
 * them, the same rounds moved notes more than a cold seeded start does, so every reading starts cold.)
 */
function relax(ids: readonly string[], target: ReadonlyMap<string, Flat>, layer: (id: string) => number, near: ReadonlyMap<string, ReadonlyMap<string, number>>): Map<string, Flat> {
  const crowd = new Map<string, number>();
  const spot = (id: string) => { const t = target.get(id)!; return `${Math.round(t.x)} ${Math.round(t.y)} ${layer(id)}`; };
  for (const id of ids) crowd.set(spot(id), (crowd.get(spot(id)) ?? 0) + 1);
  const disc = (id: string) => ROOM * Math.max(1, 0.6 * Math.sqrt(crowd.get(spot(id))!));
  const at = new Map(ids.map(id => {
    const t = target.get(id)!, r = disc(id) * Math.sqrt(seeded(id, 3)), a = 2 * Math.PI * seeded(id, 4);
    return [id, { x: t.x + r * Math.cos(a), y: t.y + r * Math.sin(a) }] as const;
  }));
  for (let round = 0; round < ROUNDS; round++) {
    const push = apart(ids, at, layer, () => ROOM, id => id, ROOM);
    const next = new Map<string, Flat>();
    for (const id of ids) {
      const p = at.get(id)!, t = target.get(id)!, by = push.get(id)!;
      let dx = by.x, dy = by.y;
      const off = Math.hypot(t.x - p.x, t.y - p.y), out = off - disc(id);
      if (out > 0) { const pull = Math.min(MOST_PULL, ISLAND_PULL * out); dx += pull * (t.x - p.x) / off; dy += pull * (t.y - p.y) / off; }
      let lx = 0, ly = 0, count = 0;
      for (const [other, links] of near.get(id)!) { const q = at.get(other)!; lx += links * (q.x - p.x); ly += links * (q.y - p.y); count += links; }
      const apartBy = count === 0 ? 0 : Math.hypot(lx, ly) / count;
      if (apartBy > LINK_SLACK) { const pull = LINK_PULL * (apartBy - LINK_SLACK) / apartBy / count; dx += pull * lx; dy += pull * ly; }
      next.set(id, { x: p.x + dx, y: p.y + dy });
    }
    for (const [id, p] of next) at.set(id, p);
  }
  return at;
}

/**
 * How far each item is pushed this round out of its neighbours' room: half the overlap each, for every pair on one layer
 * nearer than `room` asks. Pairs are found through a grid of cells `reach` wide, the largest room asked, so the work grows with the
 * notes, not their square. Two items at one place part along a direction seeded by their ids.
 */
function apart<K>(keys: readonly K[], at: ReadonlyMap<K, Flat>, layer: (key: K) => number, room: (a: K, b: K) => number, name: (key: K) => string, cell: number): Map<K, Flat> {
  const push = new Map(keys.map(key => [key, { x: 0, y: 0 }]));
  if (keys.length < 2) return push;
  const cells = new Map<string, K[]>();
  const cellOf = (p: Flat, key: K) => `${layer(key)} ${Math.floor(p.x / cell)} ${Math.floor(p.y / cell)}`;
  for (const key of keys) { const c = cellOf(at.get(key)!, key); cells.set(c, [...(cells.get(c) ?? []), key]); }
  for (const a of keys) {
    const p = at.get(a)!, cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const b of cells.get(`${layer(a)} ${cx + i} ${cy + j}`) ?? []) {
      if (b === a) continue;
      const q = at.get(b)!, want = room(a, b);
      let dx = p.x - q.x, dy = p.y - q.y;
      const d = Math.hypot(dx, dy);
      if (d >= want) continue;
      if (d < 1e-9) {
        const angle = 2 * Math.PI * seeded(name(a) < name(b) ? `${name(a)} ${name(b)}` : `${name(b)} ${name(a)}`, 5) + (name(a) < name(b) ? 0 : Math.PI);
        dx = Math.cos(angle); dy = Math.sin(angle);
      } else { dx /= d; dy /= d; }
      const by = push.get(a)!;
      by.x += dx * (want - d) / 2; by.y += dy * (want - d) / 2;
    }
  }
  return push;
}

/** Weights scaled to sum to one. */
function normalised(weights: ReadonlyMap<string, number>): Map<string, number> {
  const total = [...weights.values()].reduce((sum, w) => sum + w, 0);
  return new Map([...weights].map(([key, w]) => [key, w / total]));
}

/** A number in [0, 1) fixed by `id` and `salt` (FNV-1a, then mixed), so the same note scatters the same way every time. */
function seeded(id: string, salt: number): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
