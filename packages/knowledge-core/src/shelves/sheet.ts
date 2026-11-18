// Capability 1 · Knowledge under its shelves
import type { RecordEnvelope } from "@storytree/library";
import { linksOf } from "../ghosts/ghosts.js";
import type { Core } from "./shelves.js";
import type { GlobePoint } from "./positions.js";

const FIRST_BELOW = 6;
const ROOM = 6;
const ROUNDS = 80;
const ISLAND_PULL = 0.15;
const LINK_PULL = 0.04;
const MOST_PULL = 1;
const LINK_SLACK = 3 * ROOM;

interface Area { x: number; y: number; width: number; height: number }
interface Flat { x: number; y: number }

export interface SheetHanging {
  shelfAt(node: string): Flat | undefined;
  floor: Area;
  depthStep: number;
}

export interface SheetPoint extends GlobePoint { toward: string[] }

export interface SheetLayout { points: SheetPoint[]; links: [string, string][]; floor: Area & { z: number; notes: number } }

export function sheetLayout(): (core: Core, hanging: SheetHanging, notes?: ReadonlyMap<string, RecordEnvelope>) => Generator<void, SheetLayout, void> {
  let last: { key: string; layout: SheetLayout } | undefined;
  return function* (core, hanging, notes) {
    const key = layoutKey(core, hanging, notes);
    if (last?.key !== key) last = { key, layout: yield* sheetSteps(core, hanging, notes) };
    return last.layout;
  };
}

export function whole<T>(steps: Generator<void, T, void>): T {
  for (;;) { const at = steps.next(); if (at.done) return at.value; }
}

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

function storedLinks(record: RecordEnvelope): string[] {
  const supersedes = Array.isArray(record.fields.supersedes) ? record.fields.supersedes.filter((v): v is string => typeof v === "string") : [];
  return [...linksOf(record), ...supersedes];
}

export function sheetPoints(core: Core, hanging: SheetHanging, notes?: ReadonlyMap<string, RecordEnvelope>): SheetLayout {
  return whole(sheetSteps(core, hanging, notes));
}

export function* sheetSteps(core: Core, { shelfAt, floor, depthStep }: SheetHanging, notes?: ReadonlyMap<string, RecordEnvelope>): Generator<void, SheetLayout, void> {
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
      const key = id < to ? `${id} ${to}` : `${to} ${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push([id, to]);
      near.get(id)!.set(to, 1 + (near.get(id)!.get(to) ?? 0));
      near.get(to)!.set(id, 1 + (near.get(to)!.get(id) ?? 0));
    }
  }

  const pulls = new Map<string, Map<string, number>>();
  const depths = new Map<string, number>();
  for (const id of ids) {
    const placement = core.placed.get(id);
    const shelves = placement?.entrances.filter(shelf => shelfAt(shelf) !== undefined) ?? [];
    if (placement === undefined || shelves.length === 0) continue;
    const weights = new Map(shelves.map(shelf => [shelf, 1 + [...near.get(id)!].reduce((sum, [other, count]) => sum + (core.placed.get(other)?.entrances.includes(shelf) ? count : 0), 0)]));
    pulls.set(id, normalised(weights));
    depths.set(id, placement.depth);
  }
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

  const target = new Map<string, Flat>();
  for (const [id, weights] of pulls) {
    let x = 0, y = 0;
    for (const [shelf, weight] of weights) { const at = shelfAt(shelf)!; x += weight * at.x; y += weight * at.y; }
    target.set(id, { x, y });
  }
  yield;
  for (const [members, at] of yield* floorGroups(sea, near, floor)) for (const id of members) target.set(id, at);

  const layer = (id: string) => (pulls.has(id) ? depths.get(id)! : deepest + 1);
  const at = yield* relax(ids, target, layer, near);
  const inside = (p: Flat) => ({ x: clamp(p.x, floor.x, floor.x + floor.width), y: clamp(p.y, floor.y, floor.y + floor.height) });
  const points = ids.map((id): SheetPoint => {
    const weights = pulls.get(id);
    const toward = weights === undefined ? [] : [...weights].sort(([a, wa], [b, wb]) => wb - wa || compare(a, b)).map(([shelf]) => shelf);
    const p = weights === undefined ? inside(at.get(id)!) : at.get(id)!;
    return { id, at: { x: p.x, y: p.y, z: weights === undefined ? seaZ : below(depths.get(id)!) }, depth: depths.get(id), home: toward[0], toward };
  });
  return { points, links, floor: { ...floor, z: seaZ, notes: sea.length } };
}

export function sheetLit(points: readonly Pick<SheetPoint, "id" | "toward">[], selected: string, storyOf: (node: string) => string | undefined): Set<string> {
  return new Set(points.filter(point => point.toward.some(shelf => storyOf(shelf) === selected)).map(point => point.id));
}

export function sheetRoots(points: readonly Pick<SheetPoint, "id" | "at">[], notes: ReadonlySet<string> | undefined): [GlobePoint["at"], GlobePoint["at"]][] {
  return notes === undefined ? [] : points.filter(({ id }) => notes.has(id)).map(({ at }) => [at, { x: at.x, y: at.y, z: 0 }]);
}

function* floorGroups(sea: readonly string[], near: ReadonlyMap<string, ReadonlyMap<string, number>>, floor: Area): Generator<void, [string[], Flat][], void> {
  const grouped = new Set<string>(), groups: string[][] = [];
  for (const id of sea) {
    if (grouped.has(id)) continue;
    const members = [id];
    grouped.add(id);
    for (let i = 0; i < members.length; i++) for (const other of near.get(members[i]!)!.keys()) if (!grouped.has(other)) { grouped.add(other); members.push(other); }
    groups.push(members.sort(compare));
  }
  if (groups.length === 0) return [];
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
    yield;
  }
  return groups.map((members, i) => [members, centre.get(i)!]);
}

function* relax(ids: readonly string[], target: ReadonlyMap<string, Flat>, layer: (id: string) => number, near: ReadonlyMap<string, ReadonlyMap<string, number>>): Generator<void, Map<string, Flat>, void> {
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
    yield;
  }
  return at;
}

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

function normalised(weights: ReadonlyMap<string, number>): Map<string, number> {
  const total = [...weights.values()].reduce((sum, w) => sum + w, 0);
  return new Map([...weights].map(([key, w]) => [key, w / total]));
}

function seeded(id: string, salt: number): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
