/** The mock's layer on the real island, round 3, laid in the island's own plate so it turns and tilts with it.
 *
 * The map's island, coast, colours, glass and camera stay. Its territories are cut by its own code, on its own cells and
 * coast, with each capability's share of cells as the map gives it; only the cells' owners change, so that linked capabilities
 * lie side by side (territory-plan.ts). The map's own `territoryLand()` draws those shapes, in the map's colours. On them, as
 * an inked map in 2.5D, in the claim flags' manner (packages/forest/src/view/claim-flag.ts):
 * - a low castle wall along each border between two territories, one wall shared by both, where the map draws its white
 *   border line: an upright, flat-drawn cut-out with a pale band, crenellations and a thin ink outline, unlit;
 * - where a corridor runs, a wall each side of a narrow strip of open ground, and the path down its middle;
 * - a link between neighbours is a gate in their shared wall: an opening between two small square towers;
 * - a corridor's path enters each territory through a gate, never crosses one, and paths that share a stretch share it;
 * - the road off the coast toward Keys, through a corridor to the coast and on to a dot and its name;
 * - a wrench, a flat ink icon standing upright and constant on screen as a flag does, on each territory open work names;
 * - each territory's name, on it, as the map names a territory. */
import { BoxGeometry, BufferGeometry, CanvasTexture, Color, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Matrix4, Mesh,
  MeshBasicMaterial, Object3D, Raycaster, RepeatWrapping, SRGBColorSpace, Vector2, Vector3, type Camera } from "three";
import type { RootState } from "@react-three/fiber";
import type { Island } from "@storytree/forest-world/scene";
import { onIslandSurface, PLATE_CLEARANCE } from "@storytree/forest-world/planet";
import { islandCoast } from "../../../../../packages/forest-world/src/planet/pathways.js";
import { islandTerritories, onLand as onCoastLand } from "../../../../../packages/forest/src/territories/territories.js";
import { insideOf, territoryLand, type DrawnLand } from "../../../../../packages/forest/src/view/territory-land.js";
import { SAMPLE } from "./panel.js";
import { plan, sidesOf, type P } from "./territory-plan.js";

export type Link = { from: string; to: string };
export type Picked =
  | { kind: "territory"; id: string }
  | { kind: "path"; id: string; from: string; to: string; shared?: string[] }
  | { kind: "gate"; id: string; links: Link[] }
  | { kind: "road"; id: string; from: string; to: string }
  | { kind: "wrench"; id: string; capability: string; sample: boolean };
export type Layer = {
  pick(x: number, y: number): Picked | undefined;
  find(kind: string, id: string): Picked | undefined;
  showSample(on: boolean): void;
  highlight(picked: Picked | undefined): void;
  /** Where a mark is on the page, in CSS pixels, for a capture to click. */
  point(kind: string, id: string): { x: number; y: number } | undefined;
  /** Each health the territories are filled with, and the map's colour for it. */
  fills: { word: string; colour: string }[];
  /** What was laid, counted: `mock.layer.stats` in the console. */
  stats: Record<string, unknown>;
  /** The island's box on the page, in CSS pixels: the rest view is framed on it. */
  extent(): { left: number; right: number; top: number; bottom: number };
  /** Keeps the map's own territory cut on this island hidden, should the map redraw it. */
  keepHidden(): void;
  dispose(): void;
};
type Capability = { id: string; title: string; lines: number; word: string; parked: boolean; dependsOn: { id: string; title: string; story: string; storyId: string }[] };
type Data = { story: { id: string }; capabilities: Capability[]; openWork: { capabilities: string[] }[]; seeds?: Record<string, P> };

/** The ink map's palette (README.md lists it). */
export const PALETTE = {
  ink: "#1b1814", wall: "#ece4d0", ground: "#d9d1b9", path: "#6e5236", lit: "#ffd34d",
  wrench: "#1b1814", wrenchEdge: "#ece4d0", wrenchSample: "#d6bdf0", shadow: "#080b0e",
} as const;
/** The map lifts its territories this far off the land (planet-view.tsx's TERRITORY_LIFT). */
const TERRITORY_LIFT = 0.05;

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
const along = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
const nameOf = (title: string) => title.replace(/^\d+ · /, "");
const pkey = (p: P) => `${Math.round(p.x * 1e3)},${Math.round(p.z * 1e3)}`;

/** Triangles and an outline for a flat cut-out standing upright on the ground from `a` to `b`: the wall's band `h` high with
 * crenellations `m` higher, `merlon` wide, in the vertical plane through a and b. */
function cutOut(a: P, b: P, h: number, m: number, merlon: number, y: (p: P) => number) {
  const l = dist(a, b), tris: number[] = [], lines: number[] = [];
  const at = (u: number, up: number) => { const p = along(a, b, u / l); return [p.x, y(p) + up, p.z]; };
  const quad = (u0: number, u1: number, v0: number, v1: number) => tris.push(...at(u0, v0), ...at(u1, v0), ...at(u1, v1), ...at(u0, v0), ...at(u1, v1), ...at(u0, v1));
  const line = (u0: number, v0: number, u1: number, v1: number) => lines.push(...at(u0, v0), ...at(u1, v1));
  quad(0, l, 0, h);
  // A short run is a plain band: crenellations on it would be a few broken ticks.
  if (l < merlon * 4 && merlon < h) {
    lines.push(...at(0, 0), ...at(l, 0), ...at(0, 0), ...at(0, h), ...at(0, h), ...at(l, h), ...at(l, h), ...at(l, 0));
    return { tris, lines };
  }
  // Merlons and crenels of equal width, a merlon at each end, the spacing stretched to fit.
  const count = Math.max(1, Math.round((l / merlon + 1) / 2)), step = count > 1 ? (l - merlon) / (count - 1) : 0;
  let u = 0;
  line(0, 0, l, 0);
  line(0, 0, 0, count > 1 ? h + m : h);
  for (let k = 0; k < count; k++) {
    const u0 = count > 1 ? k * step : (l - merlon) / 2, u1 = Math.min(l, u0 + merlon);
    if (count === 1) { line(0, h, u0, h); }
    quad(u0, u1, h, h + m);
    if (k > 0 || count === 1) { line(u, h, u0, h); line(u0, h, u0, h + m); }
    line(u0, h + m, u1, h + m);
    if (k < count - 1 || count === 1) line(u1, h + m, u1, h);
    u = u1;
  }
  if (count === 1) line(u, h, l, h);
  line(l, 0, l, count > 1 ? h + m : h);
  return { tris, lines };
}

/** A dash drawn once, repeated along every path. */
function dashTexture(colour: string = PALETTE.path, solid = false): CanvasTexture {
  const canvas = document.createElement("canvas"); canvas.width = 8; canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = colour; ctx.fillRect(0, solid ? 2 : 4, 8, solid ? 54 : 34);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping; texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A flat ribbon `width` wide along `points` on the ground; its texture repeats every `repeat` along it. */
function ribbon(points: P[], width: number, y: (p: P) => number, repeat: number): BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], index: number[] = [];
  let run = 0;
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)]!, b = points[Math.min(points.length - 1, i + 1)]!;
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l * width / 2, nz = dx / l * width / 2;
    if (i > 0) run += dist(points[i - 1]!, p);
    positions.push(p.x + nx, y(p), p.z + nz, p.x - nx, y(p), p.z - nz);
    uvs.push(0, run / repeat, 1, run / repeat);
    if (i > 0) { const k = 2 * i; index.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return geometry;
}

/** A polyline with its corners rounded by `r`, so a way turns as a drawn line does. */
function rounded(points: P[], r: number): P[] {
  if (points.length < 3) return points;
  const out: P[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!, b = points[i]!, c = points[i + 1]!, la = dist(a, b), lc = dist(b, c);
    const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    if (la < 1e-9 || lc < 1e-9 || Math.abs(cross) < 1e-9 * la * lc) { out.push(b); continue; }
    const k = Math.min(r, la / 2, lc / 2), p = along(b, a, k / la), q = along(b, c, k / lc);
    for (let t = 0; t <= 1; t += 0.2) { const u = along(p, b, t), w = along(b, q, t); out.push(along(u, w, t)); }
  }
  out.push(points.at(-1)!);
  return out;
}

/** A convex outline whose sides carry a tag, cut to the side of the line through `a` and `b` where `keep` is, `inset` in from
 * it; the new side along the cut carries `tag`. */
type Tagged = { p: P; tag: string }[];
function clipTagged(poly: Tagged, a: P, b: P, keep: P, inset: number, tag: string): Tagged {
  const l = dist(a, b), n = { x: -(b.z - a.z) / l, z: (b.x - a.x) / l };
  const s = (q: P) => (q.x - a.x) * n.x + (q.z - a.z) * n.z;
  const sign = Math.sign(s(keep)) || 1, value = (q: P) => s(q) * sign - inset;
  const out: Tagged = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]!, next = poly[(i + 1) % poly.length]!, vc = value(cur.p), vn = value(next.p);
    if (vc >= 0) out.push(cur);
    if ((vc >= 0) !== (vn >= 0)) {
      const t = vc / (vc - vn), q = along(cur.p, next.p, t);
      // Leaving the kept side, the new side runs along the cut; entering it, the old side goes on.
      out.push({ p: q, tag: vc >= 0 ? tag : cur.tag });
    }
  }
  return out;
}

/** The wrench: a flat ink icon, an open-ended spanner standing upright, in the claim flag's manner (pale fill, ink outline, a
 * shadow at its foot). Drawn as an SVG on the page, constant on screen, its foot on the territory. */
function wrenchSvg(fill: string): string {
  return `<svg viewBox="-10 -36 20 38" width="18" height="34" aria-hidden="true">
    <ellipse cx="0" cy="0.5" rx="5.5" ry="2" fill="${PALETTE.shadow}" fill-opacity="0.55"/>
    <path d="${WRENCH}" fill="${fill}" stroke="${fill === PALETTE.wrench ? PALETTE.wrenchEdge : PALETTE.ink}" stroke-width="1.3" stroke-linejoin="round"/>
  </svg>`;
}
/** The spanner's outline: a straight handle up to a round head with an open jaw at its top. */
export const WRENCH = "M -2 0 L -2 -17.25 A 8 8 0 0 1 -3 -32.42 L -3 -26 A 3 3 0 0 0 3 -26 L 3 -32.42 A 8 8 0 0 1 2 -17.25 L 2 0 Z";

export function castleLayer(state: RootState, story: string, data: Data, host: HTMLElement, island: Island): Layer {
  const plate = state.scene.getObjectByName(`planet:${story}`)!;
  const mapLand = plate.getObjectByName("territory-land")!, root = mapLand.parent!;
  // The map's own territory cut of this island is pinned out of sight (the map sets its visibility as it presents the land,
  // so a setter that keeps it hidden is what holds); the mock's cut of the same cells is drawn in its place.
  const hideMap = () => {
    for (const mark of root.children) {
      if (mark.name !== "territory-land" || mark.userData.mock || Object.getOwnPropertyDescriptor(mark, "visible")?.get) continue;
      Object.defineProperty(mark, "visible", { get: () => false, set: () => {}, configurable: true });
    }
    state.invalidate();
  };
  hideMap();

  // The island's surface, as the map lays its territories on it: the sphere's radius is read off the map's own drawn land.
  const radius = (() => {
    let at: Vector3 | undefined;
    mapLand.traverse(o => { if (!at && o.name.startsWith("territory:")) { const g = (o as Mesh).geometry.getAttribute("position"); for (let i = 0; i < g.count; i++) { const v = new Vector3(g.getX(i), g.getY(i), g.getZ(i)); if (!at || Math.hypot(v.x, v.z) > Math.hypot(at.x, at.z)) at = v; } } });
    const y = at!.y - TERRITORY_LIFT, r2 = at!.x ** 2 + at!.z ** 2;
    return -(r2 + y * y) / (2 * y) - PLATE_CLEARANCE;
  })();
  const surface = onIslandSurface(radius, 0), heightAt = (q: P) => surface(q).y;
  const coast = islandCoast(island);
  const map = islandTerritories(island.land!.territories, coast);
  const onLand = (q: P) => onCoastLand(q, coast);
  const own = new Set(data.capabilities.map(({ id }) => id));
  const byId = new Map(data.capabilities.map(c => [c.id, c]));
  const indexOf = new Map(map.territories.map((t, i) => [t.capability!, i]));
  const capOf = (t: number) => map.territories[t]!.capability!;
  const links: [number, number][] = [];
  for (const c of data.capabilities) for (const d of c.dependsOn) if (own.has(d.id) && indexOf.has(c.id) && indexOf.has(d.id)) links.push([indexOf.get(c.id)!, indexOf.get(d.id)!]);
  // Where each road off the coast heads: the other island, in this plate's coordinates.
  const inverse = new Matrix4().copy(root.matrixWorld).invert();
  const elsewhere = new Map<number, { dep: Capability["dependsOn"][number]; there: P }>();
  for (const c of data.capabilities) for (const d of c.dependsOn.filter(d => !own.has(d.id))) {
    const other = state.scene.getObjectByName(`planet:${d.storyId}`);
    if (!other || !indexOf.has(c.id)) continue;
    const v = other.getWorldPosition(new Vector3()).applyMatrix4(inverse);
    elsewhere.set(indexOf.get(c.id)!, { dep: d, there: { x: v.x, z: v.z } });
  }
  // The seeds tools/seed.mjs found (`?seed` looks for them again, at length, as that tool does).
  const looking = new URLSearchParams(location.search).has("seed"), stored = data.seeds;
  const given = !looking && stored && map.territories.every(t => stored[t.capability!]) ? map.territories.map(t => stored[t.capability!]!) : undefined;
  const p = plan(map, links, onLand, { toward: t => elsewhere.get(t)?.there }, given ? { seeds: given } : looking ? { runs: 24, iterations: 3000 } : {});
  const U = p.unit;

  // Sizes, from one cell's width of land.
  const H = U * 0.09, M = H * 0.55, MERLON = H * 1.1;
  const OPEN = U * 0.16, TOWER = H * 1.15, TOWER_H = H * 1.35, TOP = H * 0.45;
  const PATH = U * 0.032, DASH = U * 0.15, TURN = U * 0.18;
  const lift = (q: P, up = 0) => new Vector3(q.x, heightAt(q) + up, q.z);
  const ground = (q: P) => heightAt(q) + TERRITORY_LIFT + H * 0.04;

  // Each cell pulled back from every corridor along its sides, each of its sides tagged with what is across it.
  const sides = sidesOf(map), sideIndex = new Map<string, number>();
  sides.forEach((s, i) => sideIndex.set(`${s.cell}>${s.across}`, i));
  const canonical = (c: number, across: number) => sideIndex.get(c < across ? `${c}>${across}` : `${across}>${c}`)!;
  // What each cut takes off a cell is a convex strip too: together they are the corridors' open ground.
  const strips: P[][] = [];
  const cells: Tagged[] = map.cells.map(cell => {
    let poly: Tagged = sides.filter(s => s.cell === cell.index).map(s => ({ p: s.from, tag: `${s.across}` }));
    for (const s of sides) {
      if (s.cell !== cell.index || s.across < 0 || !p.corridor.has(canonical(s.cell, s.across))) continue;
      const beyond = { x: 2 * (s.from.x + s.to.x) / 2 - cell.site.x, z: 2 * (s.from.z + s.to.z) / 2 - cell.site.z };
      const strip = clipTagged(clipTagged(poly, s.from, s.to, beyond, -p.halfWidth, ""), s.from, s.to, cell.site, 0, "");
      if (strip.length >= 3) strips.push(strip.map(q => q.p));
      poly = clipTagged(poly, s.from, s.to, cell.site, p.halfWidth, `corridor:${canonical(s.cell, s.across)}`);
    }
    return poly;
  });
  const drawn: DrawnLand = { territories: map.territories, cells: cells.map((poly, c) => ({ polygon: poly.map(q => q.p), territory: p.owner[c]! })), borders: [] };
  const land = territoryLand(drawn, onIslandSurface(radius, TERRITORY_LIFT), coast);
  land.userData.mock = true; land.name = "mock-territory-land";
  root.add(land);
  // The corridors' ground: open land, pale as a drawn map's, cut to the coast as the territories are (the map's own cut, its
  // fill recoloured), under the walls and paths.
  const open = territoryLand({ territories: [{ mapped: true }], cells: strips.map(polygon => ({ polygon, territory: 0 })), borders: [] }, onIslandSurface(radius, TERRITORY_LIFT), coast);
  open.name = "mock-corridor-ground"; open.userData.mock = true;
  open.traverse(o => { if (o.name.startsWith("territory:")) { o.name = "corridor-ground"; const m = (o as Mesh).material as MeshBasicMaterial; m.color.set(PALETTE.ground); m.opacity = 1; o.raycast = () => {}; } });
  root.add(open);
  const fillOf = new Map<string, Mesh>();
  land.traverse(o => { if (o.name.startsWith("territory:")) fillOf.set(o.name.slice("territory:".length), o as Mesh); });

  // The walls: one along each border between two territories, where both cells still reach it; one along each side of a
  // corridor; none on the coast, which the island's own cliff edges. Each is cut to the land by the map's own `insideOf`.
  type Wall = { a: P; b: P; side: number; kind: "shared" | "corridor"; territories: number[]; inward: Map<number, P> };
  const walls: Wall[] = [];
  const edgesOf = (c: number) => cells[c]!.map((q, i) => ({ a: q.p, b: cells[c]![(i + 1) % cells[c]!.length]!.p, tag: q.tag }));
  const normalToward = (a: P, b: P, toward: P): P => { const l = dist(a, b), n = { x: -(b.z - a.z) / l, z: (b.x - a.x) / l }; const s = Math.sign((toward.x - a.x) * n.x + (toward.z - a.z) * n.z) || 1; return { x: n.x * s, z: n.z * s }; };
  for (let c = 0; c < cells.length; c++) for (const e of edgesOf(c)) {
    if (dist(e.a, e.b) < 1e-6) continue;
    const site = map.cells[c]!.site, t = p.owner[c]!;
    if (e.tag.startsWith("corridor:")) {
      for (const piece of insideOf(e.a, e.b, coast)) walls.push({ a: piece.from, b: piece.to, side: Number(e.tag.slice(9)), kind: "corridor", territories: [t], inward: new Map([[t, normalToward(e.a, e.b, site)]]) });
      continue;
    }
    const j = Number(e.tag);
    if (j < 0 || j < c || p.owner[j] === t) continue;
    // Where both cells still reach their shared side (a corridor passing its end pulls both back from it).
    const other = edgesOf(j).find(f => f.tag === `${c}`);
    if (!other) continue;
    const l = dist(e.a, e.b), u = (q: P) => ((q.x - e.a.x) * (e.b.x - e.a.x) + (q.z - e.a.z) * (e.b.z - e.a.z)) / (l * l);
    const [t0, t1] = [Math.max(0, Math.min(u(other.a), u(other.b))), Math.min(1, Math.max(u(other.a), u(other.b)))];
    if (t1 - t0 < 1e-6) continue;
    const a = along(e.a, e.b, t0), b = along(e.a, e.b, t1);
    for (const piece of insideOf(a, b, coast)) walls.push({ a: piece.from, b: piece.to, side: canonical(c, j), kind: "shared", territories: [t, p.owner[j]!],
      inward: new Map([[t, normalToward(a, b, site)], [p.owner[j]!, normalToward(a, b, map.cells[j]!.site)]]) });
  }

  // Gates, each on its wall: a neighbours' gate on their shared wall, a corridor's on the wall beside it.
  type GateMark = { key: string; wall: Wall; at: P; links: Link[] };
  const gateMarks = new Map<string, GateMark>();
  const projectOn = (w: Wall, q: P, keep: number) => {
    const l = dist(w.a, w.b), t = ((q.x - w.a.x) * (w.b.x - w.a.x) + (q.z - w.a.z) * (w.b.z - w.a.z)) / (l * l), m = Math.min(0.5, keep / l);
    return along(w.a, w.b, Math.max(m, Math.min(1 - m, t)));
  };
  const wallFor = (g: { territory: number; side: number; at: P }) => {
    const mine = walls.filter(w => g.territory < 0 ? w.kind === "shared" : w.kind === "corridor" && w.territories[0] === g.territory);
    const near = (list: Wall[]) => list.sort((a, b) => dist(projectOn(a, g.at, 0), g.at) - dist(projectOn(b, g.at, 0), g.at) || dist(b.a, b.b) - dist(a.a, a.b))[0];
    // Its own side's wall; where a second corridor at that corner has pulled the territory back past it, the nearest wall it
    // has on a corridor.
    return near(mine.filter(w => w.side === g.side)) ?? (g.territory < 0 ? undefined : near(mine));
  };
  const linkOf = (a: number, b: number): Link => ({ from: capOf(a), to: capOf(b) });
  const addGate = (gateKey: string, link: Link) => {
    const g = p.gates.get(gateKey)!;
    let mark = gateMarks.get(gateKey);
    if (!mark) {
      const wall = wallFor(g);
      if (!wall) return;
      mark = { key: gateKey, wall, at: projectOn(wall, g.at, OPEN / 2 + TOWER), links: [] };
      gateMarks.set(gateKey, mark);
    }
    if (!mark.links.some(l => l.from === link.from && l.to === link.to)) mark.links.push(link);
  };
  for (const [k, gateKey] of p.neighbourGates) { const [a, b] = k.split("->").map(Number); addGate(gateKey, linkOf(a!, b!)); }
  for (const way of p.ways.values()) for (const gateKey of way.gates) addGate(gateKey, linkOf(way.from, way.to));
  const roadOf = new Map<number, Link>();
  for (const [t, road] of p.roads) { const e = elsewhere.get(Number(t))!; const link = { from: capOf(road.from), to: e.dep.id }; roadOf.set(road.from, link); addGate(road.gate, link); }

  const group = new Group(); group.name = "mock-castle"; root.add(group);
  const inkMaterial = () => new LineBasicMaterial({ color: PALETTE.ink });
  const wallFill = new MeshBasicMaterial({ color: PALETTE.wall, fog: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });

  // The walls drawn, each run opened for the gate on it.
  const towerAt = new Map<string, [P, P]>();
  let wallLength = 0;
  {
    const tris: number[] = [], lines: number[] = [];
    for (const w of walls) {
      const runs: [P, P][] = [];
      const gate = [...gateMarks.values()].find(g => g.wall === w);
      if (gate) {
        const l = dist(w.a, w.b), half = Math.min(0.5, (OPEN / 2 + TOWER / 2) / l), t = dist(w.a, gate.at) / l;
        const left = along(w.a, w.b, Math.max(0, t - half)), right = along(w.a, w.b, Math.min(1, t + half));
        runs.push([w.a, left], [right, w.b]);
        towerAt.set(gate.key, [left, right]);
      } else runs.push([w.a, w.b]);
      for (const [u, v] of runs) {
        if (dist(u, v) < H * 0.3) continue;
        const cut = cutOut(u, v, H, M, MERLON, ground);
        tris.push(...cut.tris); lines.push(...cut.lines);
        // The wall's walk: a pale strip along its top, unoutlined, so a wall seen from above reads as one band with one ink line.
        const l = dist(u, v), d = { x: (v.x - u.x) / l * TOP / 2, z: (v.z - u.z) / l * TOP / 2 }, n2 = { x: -d.z, z: d.x };
        const q = [{ x: u.x + n2.x, z: u.z + n2.z }, { x: v.x + n2.x, z: v.z + n2.z }, { x: v.x - n2.x, z: v.z - n2.z }, { x: u.x - n2.x, z: u.z - n2.z }].map(r => [r.x, ground(r) + H, r.z]);
        tris.push(...q[0]!, ...q[1]!, ...q[2]!, ...q[0]!, ...q[2]!, ...q[3]!);
        wallLength += l;
      }
    }
    const geometry = new BufferGeometry(); geometry.setAttribute("position", new Float32BufferAttribute(tris, 3));
    const fill = new Mesh(geometry, wallFill); fill.renderOrder = 2; fill.raycast = () => {};
    const outline = new BufferGeometry(); outline.setAttribute("position", new Float32BufferAttribute(lines, 3));
    const edge = new LineSegments(outline, inkMaterial()); edge.renderOrder = 3; edge.raycast = () => {};
    const wallGroup = new Group(); wallGroup.name = "walls"; wallGroup.add(fill, edge); group.add(wallGroup);
  }

  // Gates: a small square tower each side of the opening, a box drawn flat (pale faces, ink edges, crenellated top).
  const gateGroups = new Map<string, Group>();
  for (const [key, [l, r]] of towerAt) {
    const g = new Group(); g.name = `gate:${key}`;
    const ink = inkMaterial(), towerFill = wallFill.clone();
    const [a, b] = [l, r], dl = dist(a, b) || 1, dir = { x: (b.x - a.x) / dl, z: (b.z - a.z) / dl }, nrm = { x: -dir.z, z: dir.x };
    for (const t of [a, b]) {
      const h = TOWER / 2, sq = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([u, v]) => ({ x: t.x + dir.x * u! + nrm.x * v!, z: t.z + dir.z * u! + nrm.z * v! }));
      const tris: number[] = [], lines: number[] = [];
      for (let k = 0; k < 4; k++) { const cut = cutOut(sq[k]!, sq[(k + 1) % 4]!, TOWER_H, M * 0.8, TOWER / 2.6, ground); tris.push(...cut.tris); lines.push(...cut.lines); }
      // Its roof, a flat square at the top of the band, so from above it reads solid.
      const y = (q: P) => ground(q) + TOWER_H - H * 0.01, top = sq.map(q => [q.x, y(q), q.z]);
      tris.push(...top[0]!, ...top[1]!, ...top[2]!, ...top[0]!, ...top[2]!, ...top[3]!);
      const geometry = new BufferGeometry(); geometry.setAttribute("position", new Float32BufferAttribute(tris, 3));
      const mesh = new Mesh(geometry, towerFill); mesh.renderOrder = 2; mesh.raycast = () => {};
      const outline = new BufferGeometry(); outline.setAttribute("position", new Float32BufferAttribute(lines, 3));
      const edge = new LineSegments(outline, ink); edge.renderOrder = 3; edge.raycast = () => {};
      g.add(mesh, edge);
    }
    // A box over the gate, unseen, so a click on it is easy to land.
    const middle = along(a, b, 0.5), top = TOWER_H + M;
    const hit = new Mesh(new BoxGeometry(dl + TOWER * 1.6, top, TOWER * 2.4), new MeshBasicMaterial({ visible: false, side: DoubleSide }));
    hit.position.copy(lift(middle, top / 2)); hit.rotation.y = -Math.atan2(dir.z, dir.x);
    g.add(hit);
    g.userData = { ink, fill: towerFill, at: middle };
    gateGroups.set(key, g); group.add(g);
  }

  // Paths: each corridor's way from gate to gate, down the middle of its strip of open ground. A stretch two ways walk is
  // drawn once; stretches meeting only each other are chained, so the dashes run on.
  const gateAt = (k: string) => gateMarks.get(k)?.at;
  const wayKey = (w: { from: number; to: number }) => `${capOf(w.from)}->${capOf(w.to)}`;
  const routes: { key: string; points: P[] }[] = [];
  for (const w of p.ways.values()) {
    const a = gateAt(w.gates[0]), b = gateAt(w.gates[1]);
    if (!a || !b) continue;
    routes.push({ key: wayKey(w), points: [a, ...w.points, b] });
  }
  const roadLines = new Map<string, { points: P[]; end: P; label: string; from: string; to: string }>();
  for (const [t, road] of p.roads) {
    const e = elsewhere.get(Number(t))!, a = gateAt(road.gate);
    if (!a) continue;
    const toward = { x: e.there.x - road.coast.x, z: e.there.z - road.coast.z }, l = Math.hypot(toward.x, toward.z);
    const end = { x: road.coast.x + toward.x / l * U * 0.55, z: road.coast.z + toward.z / l * U * 0.55 };
    const key = `${capOf(road.from)}->${e.dep.id}`;
    routes.push({ key: `road:${key}`, points: [a, ...road.points] });
    roadLines.set(key, { points: [a, ...road.points, end], end, label: `to ${e.dep.story} · ${nameOf(e.dep.title)}`, from: capOf(road.from), to: e.dep.id });
  }
  const stretches = new Map<string, { a: P; b: P; load: string[] }>();
  for (const r of routes) for (let i = 0; i + 1 < r.points.length; i++) {
    const a = r.points[i]!, b = r.points[i + 1]!;
    if (dist(a, b) < 1e-6) continue;
    const k = [pkey(a), pkey(b)].sort().join("|"), s = stretches.get(k) ?? { a, b, load: [] };
    if (!s.load.includes(r.key)) s.load.push(r.key);
    stretches.set(k, s);
  }
  const degree = new Map<string, number>();
  for (const s of stretches.values()) for (const q of [s.a, s.b]) degree.set(pkey(q), (degree.get(pkey(q)) ?? 0) + 1);
  const chains: { points: P[]; load: string[] }[] = [], seen = new Set<string>();
  for (const [k0, s0] of stretches) {
    if (seen.has(k0)) continue;
    seen.add(k0);
    const pts = [s0.a, s0.b], load = s0.load.join();
    for (const end of [1, 0]) for (;;) {
      const q = end ? pts.at(-1)! : pts[0]!;
      if (degree.get(pkey(q)) !== 2) break;
      const next = [...stretches].find(([k, s]) => !seen.has(k) && s.load.join() === load && (pkey(s.a) === pkey(q) || pkey(s.b) === pkey(q)));
      if (!next) break;
      seen.add(next[0]);
      const other = pkey(next[1].a) === pkey(q) ? next[1].b : next[1].a;
      if (end) pts.push(other); else pts.unshift(other);
    }
    chains.push({ points: pts, load: s0.load });
  }
  const texture = dashTexture();
  const dashMaterial = new MeshBasicMaterial({ map: texture, transparent: true, side: DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const pathMeshes: Mesh[] = [];
  for (const chain of chains) {
    const pts = rounded(chain.points, TURN);
    const mesh = new Mesh(ribbon(pts, PATH, ground, DASH), dashMaterial);
    mesh.renderOrder = 4; mesh.raycast = () => {};
    // A wider unseen ribbon over it takes the clicks.
    const hit = new Mesh(ribbon(pts, p.halfWidth * 1.6, ground, DASH), new MeshBasicMaterial({ visible: false, side: DoubleSide }));
    const ways = chain.load.filter(k => !k.startsWith("road:"));
    hit.name = ways.length ? `path:${ways.join(",")}` : `road:${chain.load[0]!.slice(5)}`;
    hit.userData.pts = pts;
    group.add(mesh, hit); pathMeshes.push(hit);
  }
  const roadHits = new Map<string, Mesh>();
  for (const [key, road] of roadLines) {
    // Its run off the coast, onto the glass, to its dot.
    const off = road.points.slice(-2), top = heightAt(off[0]!);
    const y = (u: P) => Math.max(heightAt(u), top) + TERRITORY_LIFT + H * 0.04;
    const mesh = new Mesh(ribbon(off, PATH, y, DASH), dashMaterial); mesh.renderOrder = 4; mesh.raycast = () => {};
    const hit = new Mesh(ribbon(off, p.halfWidth * 1.6, y, DASH), new MeshBasicMaterial({ visible: false, side: DoubleSide }));
    hit.name = `road:${key}`;
    group.add(mesh, hit); roadHits.set(key, hit);
  }

  // The page's own marks over the canvas, constant on screen as the map's names and flags are: the territories' names, the
  // wrenches and the road's name.
  const overlay = document.createElement("div");
  overlay.className = "mock-overlay";
  host.appendChild(overlay);
  type Spot = { el: HTMLElement; at: Vector3; name?: boolean; below?: boolean; x?: number; y?: number };
  const spots: Spot[] = [];
  // Each territory's own spot: its cell nearest the middle of its land, so a name stands on its territory.
  const anchors = new Map<string, P>();
  map.territories.forEach((terr, t) => {
    const mine = map.cells.filter((_, c) => p.owner[c] === t);
    const pieces = mine.map(c => { const poly = cells[c.index]!.map(q => q.p); let a = 0, x = 0, z = 0; for (let i = 0; i < poly.length; i++) { const u = poly[i]!, v = poly[(i + 1) % poly.length]!, k = u.x * v.z - v.x * u.z; a += k; x += (u.x + v.x) * k; z += (u.z + v.z) * k; } return { c, a: a / 2, at: a ? { x: x / (3 * a), z: z / (3 * a) } : c.site }; }).filter(q => onLand(q.at));
    const total = pieces.reduce((s, q) => s + q.a, 0) || 1, centre = { x: pieces.reduce((s, q) => s + q.at.x * q.a, 0) / total, z: pieces.reduce((s, q) => s + q.at.z * q.a, 0) / total };
    const best = pieces.sort((a, b) => dist(a.at, centre) - dist(b.at, centre))[0];
    anchors.set(terr.capability!, best ? best.at : mine[0]!.site);
  });
  const names = new Map<string, Spot>();
  for (const terr of map.territories) {
    const id = terr.capability!, el = document.createElement("div");
    el.dataset.capability = id;
    el.className = "forest-label planet-nameplate capability mock-name";
    el.textContent = nameOf(byId.get(id)!.title);
    overlay.appendChild(el);
    const spot: Spot = { el, at: lift(anchors.get(id)!), name: true };
    spots.push(spot); names.set(id, spot);
  }
  const wrenches = new Map<string, Spot & { sample: boolean }>();
  const named = new Set(data.openWork.flatMap(w => w.capabilities));
  const sampleCapability = data.capabilities.find(c => c.title === SAMPLE.capability)?.id;
  const makeWrench = (capability: string, sample: boolean) => {
    const el = document.createElement("div");
    el.className = `mock-wrench${sample ? " mock-wrench-sample" : ""}`;
    el.innerHTML = wrenchSvg(sample ? PALETTE.wrenchSample : PALETTE.wrench) + (sample ? `<span class="mock-wrench-tag">sample</span>` : "");
    overlay.appendChild(el);
    // It stands at its territory's spot, and the name hangs just below its foot, as a claimed territory's does.
    const spot = { el, at: lift(anchors.get(capability)!, H * 0.1), sample };
    spots.push(spot);
    return spot;
  };
  for (const capability of named) if (own.has(capability)) { wrenches.set(capability, makeWrench(capability, false)); names.get(capability)!.below = true; }
  const sampleWrench = sampleCapability === undefined ? undefined : makeWrench(sampleCapability, true);
  if (sampleWrench) sampleWrench.el.hidden = true;
  for (const [, road] of roadLines) {
    const dot = document.createElement("div"); dot.className = "mock-road-end"; overlay.appendChild(dot);
    spots.push({ el: dot, at: lift(road.end, H * 0.05) });
    const el = document.createElement("div"); el.className = "forest-label planet-nameplate capability mock-road-name mock-name-above"; el.textContent = road.label; overlay.appendChild(el);
    // Its name stands on the land, by the coast it leaves by.
    const coastAt = road.points.at(-2)!, inland = road.points.at(-3) ?? coastAt;
    spots.push({ el, at: lift(along(coastAt, inland, Math.min(1, U * 0.8 / Math.max(1e-6, dist(coastAt, inland)))), H * 0.05), name: true });
  }
  const project = (v: Vector3) => {
    const rect = state.gl.domElement.getBoundingClientRect(), hostRect = host.getBoundingClientRect();
    const w = v.clone().applyMatrix4(root.matrixWorld).project(state.camera as Camera);
    return { x: rect.left - hostRect.left + (w.x + 1) / 2 * rect.width, y: rect.top - hostRect.top + (1 - w.y) / 2 * rect.height, page: { x: rect.left + (w.x + 1) / 2 * rect.width, y: rect.top + (1 - w.y) / 2 * rect.height }, front: w.z < 1 };
  };
  let frame = 0;
  const follow = () => {
    for (const spot of spots) {
      const at = project(spot.at);
      spot.el.style.transform = `translate(${at.x}px, ${at.y}px)`;
      spot.el.style.visibility = at.front ? "" : "hidden";
      spot.y = at.y; spot.x = at.x;
    }
    // Names never hide one another: taken from the top of the page down, a name that would meet one already placed moves down
    // just clear of it.
    const boxes: { l: number; r: number; t: number; b: number }[] = [];
    // The wrenches stand where they stand; names keep clear of them too.
    for (const w of [...wrenches.values(), ...(sampleWrench && !sampleWrench.el.hidden ? [sampleWrench] : [])]) boxes.push({ l: w.x! - 9, r: w.x! + 9, t: w.y! - 32, b: w.y! + 3 });
    for (const spot of spots.filter(sp => sp.name).sort((a, b) => a.y! - b.y!)) {
      const wrenched = spot.below || (sampleWrench && !sampleWrench.el.hidden && spot.el.dataset.capability === sampleCapability);
      spot.el.classList.toggle("mock-name-below", !!wrenched);
      const w = spot.el.offsetWidth, h = spot.el.offsetHeight, above = spot.el.classList.contains("mock-name-above");
      const box = { l: spot.x! - w / 2, r: spot.x! + w / 2, t: spot.y! + (wrenched ? 5 : above ? -h - 5 : -h / 2), b: 0 };
      box.b = box.t + h;
      let shift = 0;
      for (let k = 0; k < 8; k++) {
        const hit = boxes.find(o => o.l < box.r - 2 && box.l + 2 < o.r && o.t < box.b + shift - 1 && box.t + shift + 1 < o.b);
        if (!hit) break;
        shift = above ? hit.t - box.b - 1 : hit.b - box.t + 1;
      }
      spot.el.style.marginTop = shift ? `${shift}px` : "";
      boxes.push({ ...box, t: box.t + shift, b: box.b + shift });
    }
    frame = requestAnimationFrame(follow);
  };
  follow();
  state.invalidate();

  // Picking: a wrench by its icon on the page, then the gates, the road and the paths in the scene, then the territory below.
  const raycaster = new Raycaster();
  const hitOf = (object: Object3D | null): Picked | undefined => {
    for (let o = object; o; o = o.parent) {
      const [kind, ...rest] = o.name.split(":"), id = rest.join(":");
      if (kind === "gate") return find("gate", id);
      if (kind === "road") { const [from, to2] = id.split("->"); return { kind: "road", id, from: from!, to: to2! }; }
      if (kind === "path") { const [first, ...others] = id.split(","); const [from, to2] = first!.split("->"); return { kind: "path", id: first!, from: from!, to: to2!, ...(others.length ? { shared: others } : {}) }; }
      if (kind === "territory" && own.has(id)) return { kind: "territory", id };
    }
    return undefined;
  };
  const pick = (x: number, y: number): Picked | undefined => {
    for (const [capability, w] of [...wrenches, ...(sampleWrench && !sampleWrench.el.hidden ? [[sampleCapability!, sampleWrench] as const] : [])]) {
      const box = w.el.querySelector("svg")!.getBoundingClientRect();
      if (x >= box.left - 4 && x <= box.right + 4 && y >= box.top - 4 && y <= box.bottom + 4) return { kind: "wrench", id: capability, capability, sample: w.sample };
    }
    const rect = state.gl.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new Vector2((x - rect.left) / rect.width * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1), state.camera as Camera);
    // A gate stands over the paths meeting it, so it is asked first; then the road, then the paths.
    for (const set of [[...gateGroups.values()], [...roadHits.values()], pathMeshes]) {
      const marks = raycaster.intersectObjects(set, true);
      if (!marks.length) continue;
      // Where two paths' click strips overlap, the path whose line runs nearest the point clicked.
      const near = (m: (typeof marks)[number]) => {
        const pts = m.object.userData.pts as P[] | undefined, q = new Vector3().copy(m.point).applyMatrix4(new Matrix4().copy(root.matrixWorld).invert());
        if (!pts) return 0;
        let best = Infinity;
        for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i]!, b = pts[i + 1]!, dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.z - a.z) * dz) / l)); best = Math.min(best, Math.hypot(q.x - a.x - t * dx, q.z - a.z - t * dz)); }
        return best;
      };
      return hitOf([...marks].sort((a, b) => near(a) - near(b))[0]!.object);
    }
    const under = raycaster.intersectObjects([...fillOf.values()], false);
    return under.length ? hitOf(under[0]!.object) : undefined;
  };
  const neighbourGateOf = (from: string, to: string) => {
    const a = indexOf.get(from), b = indexOf.get(to);
    return p.neighbourGates.get(`${a}->${b}`) ?? p.neighbourGates.get(`${b}->${a}`);
  };
  const find = (kind: string, id: string): Picked | undefined => {
    if (kind === "territory") return own.has(id) ? { kind, id } : undefined;
    if (kind === "wrench") return id === sampleCapability && !wrenches.has(id) ? { kind, id, capability: id, sample: true } : wrenches.has(id) ? { kind, id, capability: id, sample: false } : undefined;
    if (kind === "gate") { const g = gateMarks.get(id); return g && gateGroups.has(id) ? { kind, id, links: g.links } : undefined; }
    const [from, to2] = id.split("->");
    if (kind === "path") {
      const callsIt = byId.get(from!)?.dependsOn.some(d => d.id === to2);
      const [f, t] = callsIt ? [from!, to2!] : [to2!, from!];
      // A link between neighbours draws no path: its gate is the link.
      const gate = neighbourGateOf(f, t);
      if (gate) return find("gate", gate);
      const key = routes.some(r => r.key === `${f}->${t}`) ? `${f}->${t}` : undefined;
      return key ? { kind, id: key, from: f, to: t } : undefined;
    }
    if (kind === "road" && roadLines.has(id)) return { kind, id, from: from!, to: to2! };
    return undefined;
  };

  // The pick lights in the selection's gold: a territory's walls lined in gold on its side, a gate's towers, a way or the
  // road drawn over in gold.
  const litMaterial = new MeshBasicMaterial({ map: dashTexture(PALETTE.lit, true), alphaTest: 0.5, fog: false, side: DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  let lit: Mesh[] = [];
  const highlight = (picked: Picked | undefined) => {
    for (const g of gateGroups.values()) (g.userData.fill as MeshBasicMaterial).color.set(PALETTE.wall);
    for (const w of [...wrenches.values(), ...(sampleWrench ? [sampleWrench] : [])]) w.el.classList.remove("lit");
    for (const m of lit) { group.remove(m); m.geometry.dispose(); }
    lit = [];
    const draw = (line: P[], width: number) => { const m = new Mesh(ribbon(line, width, q => ground(q) + H * 0.01, DASH), litMaterial); m.renderOrder = 5; group.add(m); lit.push(m); };
    if (picked?.kind === "territory") {
      // A gold line along the foot of its walls, on its own side.
      const t = indexOf.get(picked.id)!;
      for (const w of walls) {
        const n = w.inward.get(t);
        if (!n) continue;
        const off = H * 0.9;
        draw([{ x: w.a.x + n.x * off, z: w.a.z + n.z * off }, { x: w.b.x + n.x * off, z: w.b.z + n.z * off }], PATH * 1.6);
      }
    }
    if (picked?.kind === "gate") (gateGroups.get(picked.id)!.userData.fill as MeshBasicMaterial).color.set(PALETTE.lit);
    if (picked?.kind === "wrench") (picked.sample ? sampleWrench : wrenches.get(picked.capability))?.el.classList.add("lit");
    const line = picked?.kind === "path" ? routes.find(r => r.key === picked.id)?.points : picked?.kind === "road" ? roadLines.get(picked.id)?.points : undefined;
    if (line) draw(rounded(line, TURN), PATH * 2);
    state.invalidate();
  };

  const point = (kind: string, id: string) => {
    if (kind === "wrench") { const w = id.endsWith(":sample") ? sampleWrench : wrenches.get(id); if (!w) return undefined; const b = w.el.querySelector("svg")!.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height * 0.35 }; }
    if (kind === "gate") { const g = gateGroups.get(id); return g ? project(lift(g.userData.at as P, TOWER_H / 2)).page : undefined; }
    if (kind === "territory") {
      // A point on its land away from its name: the middle of its largest cell other than the name's, or beside the name.
      const t = indexOf.get(id); if (t === undefined) return undefined;
      const a = anchors.get(id)!, mine = map.cells.filter((_, c) => p.owner[c] === t).map(c => c.site).filter(s => dist(s, a) > U * 0.4 && onLand(s));
      const at = mine.sort((u, v) => dist(v, a) - dist(u, a))[0] ?? { x: a.x, z: a.z - U * 0.25 };
      return project(lift(at)).page;
    }
    if (kind === "road") { const r = roadLines.get(id); return r ? project(lift(along(r.points.at(-2)!, r.points.at(-1)!, 0.4))).page : undefined; }
    if (kind === "path") {
      // The middle of the longest stretch only this way walks, else of its longest stretch.
      const route = routes.find(r => r.key === id); if (!route) return undefined;
      const inner = route.points.length > 3 ? route.points.slice(1, -1) : route.points;
      const parts = inner.map((q, i, all) => i + 1 < all.length ? [q, all[i + 1]!] as const : undefined).filter((x): x is readonly [P, P] => !!x);
      const loadOf = (a: P, b: P) => stretches.get([pkey(a), pkey(b)].sort().join("|"))?.load.length ?? 9;
      const best = [...parts].sort((u, v) => loadOf(...u) - loadOf(...v) || dist(...v) - dist(...u))[0];
      return best ? project(lift(along(best[0], best[1], 0.5))).page : undefined;
    }
    return undefined;
  };

  const fills = [...new Map(data.capabilities.map(c => {
    const word = c.parked ? "parked" : c.word, mesh = fillOf.get(c.id);
    return [word, { word, colour: mesh ? `#${new Color((mesh.material as MeshBasicMaterial).color).getHexString()}` : "#97c459" }] as const;
  })).values()];
  const stats = { ...p.stats, gates: gateGroups.size, neighbourGates: p.neighbourGates.size, paths: routes.length - roadLines.size, roads: roadLines.size,
    chains: chains.length, sharedStretches: [...stretches.values()].filter(s => s.load.length > 1).length, walls: walls.length, wallLength: Math.round(wallLength),
    unlinked: links.filter(([a, b]) => !p.neighbourGates.has(`${a}->${b}`) && !routes.some(r => r.key === `${capOf(a)}->${capOf(b)}`)).map(([a, b]) => `${byId.get(capOf(a))!.title} -> ${byId.get(capOf(b))!.title}: ${(p.ways.get(`${a}->${b}`)?.gates ?? []).map(g => `${g} ${p.gates.get(g)?.territory} ${gateMarks.has(g)}`).join("; ")}`),
    seeds: Object.fromEntries(p.seeds.map((q, t) => [capOf(t), { x: Math.round(q.x * 1e4) / 1e4, z: Math.round(q.z * 1e4) / 1e4 }])), seeded: given ? "stored" : looking ? "searched" : "default",
    wrenches: wrenches.size, radius: Math.round(radius * 100) / 100,
    corridorLinks_: [...p.ways.values()].map(w => `${byId.get(capOf(w.from))!.title} -> ${byId.get(capOf(w.to))!.title}`) };

  return {
    pick, find, highlight, point, fills, stats, keepHidden: hideMap,
    extent() {
      state.camera.updateMatrixWorld(); root.updateMatrixWorld(true);
      const rim = coast.flat().filter((_, i) => i % 4 === 0).map(q => project(lift(q)).page);
      const boxes = [...names.values()].map(n => { const c = project(n.at).page, w = n.el.offsetWidth / 2, h = n.el.offsetHeight / 2; return { left: c.x - w, right: c.x + w, top: c.y - h, bottom: c.y + h }; });
      for (const r of roadLines.values()) { const e = project(lift(r.end)).page; boxes.push({ left: e.x - 90, right: e.x + 90, top: e.y - 6, bottom: e.y + 24 }); }
      return { left: Math.min(...rim.map(c => c.x), ...boxes.map(b => b.left)), right: Math.max(...rim.map(c => c.x), ...boxes.map(b => b.right)),
        top: Math.min(...rim.map(c => c.y), ...boxes.map(b => b.top)), bottom: Math.max(...rim.map(c => c.y), ...boxes.map(b => b.bottom)) };
    },
    showSample(on) { if (sampleWrench) sampleWrench.el.hidden = !on; },
    dispose() { cancelAnimationFrame(frame); overlay.remove(); root.remove(group); root.remove(land); root.remove(open); },
  };
}
