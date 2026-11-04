/** Round 13 (k-room): round 12's layer, with links into one territory sharing one entrance gate when the arrangement's
 * prices say so (`shareEntrance`; a shared gate opens like a road, listing what enters by it), a small price on road near
 * the coast (`edge`), the increments lined up by each wrench (QUEUE), and the crowding measured at rest (`crowding`).
 * Round 12's header follows. */
/** Round 10's layer on the real island (the territories laid out by their links and shrunk off the coast, as round 9,
 * territories-shim.ts), laid in the island's plate so it turns and tilts with it. The map's island, territories, colours,
 * borders, names, claim flags and the selection's lanes over the sea stay as the map draws them; the open land round the
 * island and at the mouth is the island's own bare ground. It adds:
 * - a SETTLEMENT in each territory that has links: round 9's quiet cartographer's mark beside its name, graded by how many
 *   links meet there (1-2, 3-5, 6 or more);
 * - ONE SHARED ROAD NETWORK (network.ts) in the selection lanes' style: links that go the same way travel one road until
 *   they part, each segment drawn once and a step wider where it carries more; the arrivals come ashore at the open mouth
 *   on a trunk that branches inland toward the interfaces it serves; the way out to Keys takes its own short road;
 * - a GATE wherever a road crosses a border (one for every link a shared road carries through it), and each link's own
 *   entrance gate where it enters the territory it calls, its click target; no arrowheads (the panel says which way);
 * - a picked link lit in gold along its whole way over the shared roads; a picked shared road lists what it carries;
 * - 6C's wrench, upright and constant on screen like a claim flag, at the entrance gate its work changes. */
import { GLYPHS, kindOf } from "../kinds.mjs";
import { BufferGeometry, CanvasTexture, CircleGeometry, Color, PlaneGeometry, SRGBColorSpace, DoubleSide, Float32BufferAttribute, FrontSide, Group, Matrix4, Mesh, MeshBasicMaterial,
  Raycaster, Vector2, Vector3, type Camera, type BufferAttribute, type LineSegments } from "three";
import type { RootState } from "@react-three/fiber";
import type { TerritoryMap } from "../../../../../packages/forest/src/territories/territories.js";
import { SEA, seaLayer, type Sea } from "./sea.js";
import { capabilityPlates } from "../../../../../packages/forest/src/view/nameplates.js";
import { network, type NetLink } from "./network.js";

export type P = { x: number; z: number };
export type Picked = { kind: "territory"; id: string } | { kind: "link"; id: string } | { kind: "road"; id: string } | { kind: "wrench"; id: string };
/** One link, as the panel tells it: `inside` between two of this story's capabilities, `down` other stories calling one of
 * them (one line carries every such link to it), `up` one of them calling another story's. */
export type LinkInfo = { key: string; from: string; to: string; fromTitle: string; toTitle: string; fromStory: string; toStory: string; dir: "inside" | "down" | "up";
  carries?: { from: string; fromTitle: string; fromStory: string; to: string; toTitle: string; toStory: string }[] };

/** The palette (README.md lists it). Line colours are the selection lanes' own (packages/forest-world/src/planet/lanes.ts);
 * the wrench's ink and paper are round 6C's. */
export const PALETTE = {
  line: "#6a5fee", out: "#0d8fb0", casing: "#141a20", lit: "#ffd34d", post: "#1b2024",
  ink: "#2a2723", paper: "#f3efe4",
} as const;
export const WRENCH = "M5.6-9.6a5.4 5.4 0 0 0-6.7 6.9L-9.4 5.6a2.1 2.1 0 1 0 3 3L2.1-0.9a5.4 5.4 0 0 0 6.9-6.7L5.7-4.3 3.2-4.9 2.6-7.4z";

/** Round 11's road styles, the swatches' (pieces/roads-tools/roads.mjs) by the same keys, chosen by `?road=<key>`: layers drawn
 * in order, each one colour mixed into the land under it by `alpha` (so the road stays opaque and joins do not darken),
 * with a width per load class (1, 2-3, 4-7, 8+ links); `border` quietens the map's white borders. `r10` is round 10's. */
type RoadStyle = { layers: { colour: string; alpha: number; widths: number[] }[]; border?: { colour: string; alpha: number } };
const ROAD_STYLES: Record<string, RoadStyle> = {
  r10: { layers: [{ colour: "#141a20", alpha: 0.88, widths: [1.54, 1.79, 2.09, 2.44] }, { colour: "#6a5fee", alpha: 1, widths: [0.7, 0.95, 1.25, 1.6] }] },
  hair: { layers: [{ colour: "#8a80ff", alpha: 0.8, widths: [0.25, 0.35, 0.5, 0.7] }] },
  worn: { layers: [{ colour: "#000000", alpha: 0.16, widths: [0.6, 0.8, 1.1, 1.5] }] },
  "worn-soft": { layers: [{ colour: "#000000", alpha: 0.07, widths: [1.3, 1.7, 2.2, 2.9] }, { colour: "#000000", alpha: 0.14, widths: [0.45, 0.6, 0.85, 1.15] }] },
  pencil: { layers: [{ colour: "#2a2723", alpha: 0.4, widths: [0.3, 0.4, 0.55, 0.75] }] },
  pale: { layers: [{ colour: "#f6f1e3", alpha: 0.5, widths: [0.4, 0.55, 0.75, 1.0] }] },
  "pale-faint": { border: { colour: "#f4f7f8", alpha: 0.4 }, layers: [{ colour: "#f6f1e3", alpha: 0.6, widths: [0.4, 0.55, 0.75, 1.0] }] },
  "pale-dark": { border: { colour: "#1b2024", alpha: 0.28 }, layers: [{ colour: "#f6f1e3", alpha: 0.6, widths: [0.4, 0.55, 0.75, 1.0] }] },
  "sand-faint": { border: { colour: "#f4f7f8", alpha: 0.4 }, layers: [{ colour: "#e2d3aa", alpha: 0.7, widths: [0.5, 0.7, 0.95, 1.3] }] },
  "worn-faint": { border: { colour: "#f4f7f8", alpha: 0.4 }, layers: [{ colour: "#000000", alpha: 0.16, widths: [0.6, 0.8, 1.1, 1.5] }] },
};
const QUERY = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
/** Mick's pick, 2026-11-03: "17 sandy track" (the swatches' 17); `?road=<key>` shows another. */
const ROAD_KEY = QUERY.get("road") ?? "sand-faint";
const ROAD = ROAD_STYLES[ROAD_KEY] ?? ROAD_STYLES.r10!;
/** The road's top colour, and the open land's, for the legend. */
export const ROAD_HEX = ROAD.layers.at(-1)!.colour;
/** Round 11's relief (Mick's pick: the relief pieces' 4, bevel and standing posts, with 5's ramps only where open land meets
 * a territory): every territory a plateau `height` above the open land, all at one height, with walls where it stands above
 * the open land or the coast and a soft shadow on the open land; a ramp where a road climbs from the open land into a
 * territory; a bevel rim inside each border, light where it faces the light and dark where it faces away, broken at each
 * gate; the gate posts standing up. `?relief=0` draws round 10's flat land and flat posts. Values from the pieces'
 * relief-tools/relief.ts, the height raised for the island's smaller scale. */
const RELIEF = QUERY.get("relief") === "0" ? undefined : {
  height: 1.3,
  wall: { lit: 0.84, away: 0.56 },
  shadow: { alpha: 0.3, reach: 1.0, feather: 0.9 },
  ramp: { width: 3.4, depth: 3.2 },
  rim: { width: 0.9, light: 0.45, dark: 0.36, hold: 0.45 },
  post: { side: 1.2, entrance: 1.4, height: 1.0, entranceHeight: 1.2, faceRatio: 0.62, body: "#9aa2a8", shadow: 0.22, reach: 0.8 },
};
/** Round 12's settlements: `symbols` (the default) draws each as its kind's symbol, `disc` round 11's disc. A symbol's box is
 * `size` ground units across by grade (1-2, 3-5, 6+ roads meeting), a step larger than round 11's discs (2.1, 2.8, 3.5), its
 * ink `width` in the symbol's 24-unit box, its casing's opacity (the pieces' style 1, pieces-tools/icons.mjs). */
const ICONS = QUERY.get("icons") === "disc" ? "disc" : "symbols";
const SYMBOL = { size: [3.4, 4.0, 4.7], width: 2.1, casing: 0.55 };
/** Round 13's queue by the wrench: each tab `w` x `h` pixels, `step` apart, from (`x`, `y`) beside the plate; at most `most`. */
const QUEUE = { x: 13.5, y: -31, w: 4.6, h: 8, step: 6.2, most: 4 };
/** Polish round 1: a wrench stands at an entrance whose plate keeps clear of the names (`?wrenchClear=0`: the nearest, as before). */
const WRENCH_CLEAR = (typeof location === "undefined" ? null : new URLSearchParams(location.search).get("wrenchClear")) !== "0";
/** Round 13's knot: Library API and the small territories round it (the brief's list). */
const KNOT = ["7 · Library API", "21 · Links", "23 · Catalogue", "24 · Graduation", "26 · Rounds", "25 · Lapsed questions", "22 · Decision log"];
/** The island's bare ground as it shows on the page (round 11's still), under the see-through territory fills. */
export const GROUND_HEX = "#686d70";

/** Sizes in ground units (about 2.6 pixels each at rest). */
const SIZE = { line: 0.75, casing: 0.42, lift: 0.35, trunk: 1.0, clear: 1.5, apart: 3.2,
  /** A settlement: its disc's radius, by how many roads meet there (1-2, 3-5, 6 or more), its ink ring, and its dot. */
  town: [1.05, 1.4, 1.75], townRing: 0.36, townDot: 0.42,
  /** A gate: the opening cut in the border, and a post each side of it (an ink square with a paper face). */
  opening: 3.0, post: 1.45, face: 0.9, entrancePost: 1.8, entranceFace: 1.15, entranceApart: 3.8, road: 6.5,
  /** A road's width by the links it carries: 1, 2-3, 4-7, 8 or more. */
  width: [0.7, 0.95, 1.25, 1.6] };

type Capability = { id: string; title: string; dependsOn: { id: string; title: string; story: string; storyId: string }[] };
type Data = { story: { id: string; title: string }; capabilities: Capability[]; openWork: { capabilities: string[]; status: string; parked?: string | null }[]; map: { tree: { stories: { id: string; title: string; capabilities: { id: string; title: string }[] }[] } } };
type Layout = { harbour: { dock: P; sea: P }; keys: { dock: P; sea: P }; open: { band: number; mouth: number }; landings: { capability: string; at: P; links: number }[]; net?: Record<string, number> };
/** A gate; `entranceOf` is the first link that enters through it, `entrances` all of them (round 13: links into one
 * territory may share one entrance). */
export type Gate = { at: P; along: P; links: string[]; entranceOf?: string; entrances: string[]; coast: boolean; open?: boolean; pair?: [string, string] };
export type Layer = {
  pick(x: number, y: number): Picked | undefined;
  find(kind: string, id: string): Picked | undefined;
  highlight(picked: Picked | undefined): void;
  point(kind: string, id: string): { x: number; y: number } | undefined;
  links: Map<string, LinkInfo>;
  /** Each road segment's links, by its id. */
  roads: Map<string, string[]>;
  wrenches: Map<string, { at: string }>;
  fills: { word: string; colour: string }[];
  stats: Record<string, unknown>;
  /** The crowding on the page as it stands now (round 13). */
  crowding(knot?: readonly string[]): unknown;
  keep(): void;
  dispose(): void;
};

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
const sub = (a: P, b: P): P => ({ x: a.x - b.x, z: a.z - b.z });
const norm = (a: P): P => { const l = Math.hypot(a.x, a.z) || 1; return { x: a.x / l, z: a.z / l }; };
const inPolygon = (p: P, poly: readonly P[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
};
const toSegment = (p: P, a: P, b: P) => {
  const dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
};
const angleBetween = (a: P, b: P) => Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.z * b.z) / ((Math.hypot(a.x, a.z) || 1) * (Math.hypot(b.x, b.z) || 1)))));
function segCross(a: P, b: P, c: P, d: P): { p: P; t: number; u: number } | undefined {
  const r = sub(b, a), s = sub(d, c), den = r.x * s.z - r.z * s.x;
  if (Math.abs(den) < 1e-12) return undefined;
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / den, u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { p: { x: a.x + t * r.x, z: a.z + t * r.z }, t, u } : undefined;
}
/** A smooth way through `pts` (Catmull-Rom), passing through every one of them, a point every unit or so. */
function smooth(pts: P[]): P[] {
  if (pts.length < 3) { const [s, e] = [pts[0]!, pts.at(-1)!], n = Math.max(2, Math.ceil(dist(s, e))); return Array.from({ length: n + 1 }, (_, i) => ({ x: s.x + (e.x - s.x) * i / n, z: s.z + (e.z - s.z) * i / n })); }
  const out: P[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(pts.length - 1, i + 2)]!, n = Math.max(4, Math.ceil(dist(p1, p2)));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t, f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  out.push(pts.at(-1)!);
  return out;
}
/** A flat ribbon `width` wide along `points`, coloured per point when `colourAt` is given. */
function ribbon(points: P[], width: number, y: (p: P) => number, colourAt?: (p: P) => Color): BufferGeometry {
  const positions: number[] = [], index: number[] = [], colours: number[] = [];
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)]!, b = points[Math.min(points.length - 1, i + 1)]!;
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l * width / 2, nz = dx / l * width / 2;
    positions.push(p.x + nx, y(p), p.z + nz, p.x - nx, y(p), p.z - nz);
    if (colourAt) { const a = colourAt({ x: p.x + nx, z: p.z + nz }), b = colourAt({ x: p.x - nx, z: p.z - nz }); colours.push(a.r, a.g, a.b, b.r, b.g, b.b); }
    if (i > 0) { const k = 2 * i; index.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  if (colourAt) geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setIndex(index);
  return geometry;
}
/** A flat bar from `a` to `b`, `wide` across. */
function bar(a: P, b: P, wide: number, y: (p: P) => number): BufferGeometry { return ribbon([a, b], wide, y); }

export function overlayLayer(state: RootState, story: string, data: Data, host: HTMLElement, map: TerritoryMap, coast: readonly (readonly P[])[], layout: Layout): Layer {
  const plate = state.scene.getObjectByName(`planet:${story}`)!;
  const land = plate.getObjectByName("territory-land")!, root = land.parent!;
  root.updateMatrixWorld(true);
  const own = new Set(data.capabilities.map(({ id }) => id));
  const byId = new Map(data.capabilities.map(c => [c.id, c]));
  const elsewhere = new Map(data.map.tree.stories.flatMap(s => s.capabilities.map(c => [c.id, { title: c.title, story: s.title, storyId: s.id }] as const)));

  // The ground's height: the plate is a shallow dome, fitted from the territories' own corners.
  const heights: [number, number][] = [];
  const fillOf = new Map<string, { colour: string; mesh: Mesh }>();
  land.traverse(object => {
    if (!object.name.startsWith("territory:")) return;
    const mesh = object as Mesh, at = mesh.geometry.getAttribute("position");
    for (let i = 0; i < at.count; i += 7) heights.push([at.getX(i) ** 2 + at.getZ(i) ** 2, at.getY(i)]);
    fillOf.set(object.name.slice("territory:".length), { colour: `#${(mesh.material as MeshBasicMaterial).color.getHexString()}`, mesh });
  });
  let n = 0, sr = 0, sy = 0, srr = 0, sry = 0;
  for (const [r2, y] of heights) { n++; sr += r2; sy += y; srr += r2 * r2; sry += r2 * y; }
  const slope = n * srr - sr * sr === 0 ? 0 : (n * sry - sr * sy) / (n * srr - sr * sr), base = (sy - slope * sr) / n;
  const heightAt = (p: P) => base + slope * Math.min(p.x * p.x + p.z * p.z, 125 * 125);
  const lift = (p: P, up = 0) => new Vector3(p.x, heightAt(p) + up, p.z);

  const onLand = (p: P) => coast.reduce((inside, loop) => inPolygon(p, loop) ? !inside : inside, false);
  const coastEdges = coast.flatMap(loop => loop.map((a, i) => [a, loop[(i + 1) % loop.length]!] as [P, P]));
  /** The territory under a point: its capability, "open" on the open land, undefined off the island. */
  const territoryAt = (p: P): string | undefined => {
    if (!onLand(p)) return undefined;
    const cell = map.cells.find(c => inPolygon(p, c.polygon));
    return cell === undefined ? undefined : map.territories[cell.territory]?.capability ?? "open";
  };
  const ownerOfCell = (c: number) => map.territories[map.cells[c]!.territory]?.capability ?? "open";
  // The borders, as the map draws them (cut to the coast), with the two territories each parts.
  const borderSegs: { a: P; b: P; pair: [string, string] }[] = [];
  for (const b of map.borders) {
    const pair = [ownerOfCell(b.between[0]), ownerOfCell(b.between[1])] as [string, string];
    // Cut to the land, as the map cuts them.
    const mid = { x: (b.from.x + b.to.x) / 2, z: (b.from.z + b.to.z) / 2 };
    if (onLand(b.from) && onLand(b.to)) borderSegs.push({ a: b.from, b: b.to, pair });
    else if (onLand(mid)) borderSegs.push({ a: onLand(b.from) ? b.from : mid, b: onLand(b.to) ? b.to : mid, pair });
  }
  const between = (x: string, y: string) => borderSegs.filter(s => (s.pair[0] === x && s.pair[1] === y) || (s.pair[0] === y && s.pair[1] === x));
  const edges: [P, P][] = [...borderSegs.map(s => [s.a, s.b] as [P, P]), ...coastEdges];
  const clearance = (p: P) => Math.min(...edges.map(([a, b]) => toSegment(p, a, b)));

  // Where things are on the page: the map's own nameplates, measured as they stand now (the rest view).
  const project = (v: Vector3) => {
    const rect = state.gl.domElement.getBoundingClientRect(), hostRect = host.getBoundingClientRect();
    const w = v.clone().applyMatrix4(root.matrixWorld).project(state.camera as Camera);
    return { x: rect.left - hostRect.left + (w.x + 1) / 2 * rect.width, y: rect.top - hostRect.top + (1 - w.y) / 2 * rect.height, page: { x: rect.left + (w.x + 1) / 2 * rect.width, y: rect.top + (1 - w.y) / 2 * rect.height }, front: w.z < 1 };
  };
  state.camera.updateMatrixWorld();
  const plates = new Map(capabilityPlates(map).map(p => [p.capability, p]));
  const nameBoxes = [...host.querySelectorAll<HTMLElement>(".planet-nameplate.capability")].map(el => {
    const r = el.getBoundingClientRect();
    return { id: el.dataset.capabilityId!, l: r.left, r: r.right, t: r.top, b: r.bottom };
  });
  const underName = (p: P, pad: number, up = 0) => { const q = project(lift(p, up)).page; return nameBoxes.some(b => q.x > b.l - pad && q.x < b.r + pad && q.y > b.t - pad && q.y < b.b + pad); };

  // ── The sea: the selection's lanes stop at the coast, where the roads ashore take over ─────────────────────────────
  const inverse = new Matrix4().copy(root.matrixWorld).invert();
  // Round 11: with no coast band a lane that rounds the island lies along its very edge, so a lane is cut a little offshore
  // too, except where the sea roads come ashore (the mouth and the way out to Keys).
  const SHORE = 1.4, ashoreAt = [layout.harbour.dock, layout.keys.dock];
  const nearCoast = (p: P) => onLand(p) || (ashoreAt.every(d => dist(p, d) > 4 * SHORE) &&
    Array.from({ length: 8 }, (_, k) => ({ x: p.x + SHORE * Math.cos(k * Math.PI / 4), z: p.z + SHORE * Math.sin(k * Math.PI / 4) })).some(onLand));
  const cutLanes = () => {
    const v = new Vector3();
    state.scene.getObjectByName("pathways:selection-lanes")?.traverse(o => {
      if (o.name.startsWith("lane-entrance:")) {
        if (!Object.getOwnPropertyDescriptor(o, "visible")?.get) Object.defineProperty(o, "visible", { get: () => false, set: () => {}, configurable: true });
        return;
      }
      if (!o.name.startsWith("lane:") && !o.name.startsWith("lane-glow:")) return;
      const mesh = o as Mesh, at = mesh.geometry.getAttribute("position") as BufferAttribute;
      if (mesh.userData.cut === mesh.geometry.uuid) return;
      mesh.updateMatrixWorld(true);
      const local = (i: number) => v.set(at.getX(i), at.getY(i), at.getZ(i)).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
      const ashore: boolean[] = [];
      for (let i = 0; i < at.count / 2; i++) { const a = local(2 * i).clone(), b = local(2 * i + 1); ashore.push(nearCoast({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 })); }
      const index = mesh.geometry.getIndex()!, keep: number[] = [];
      for (let t = 0; t < index.count; t += 3) { const tri = [index.getX(t), index.getX(t + 1), index.getX(t + 2)]; if (!tri.every(i => ashore[Math.floor(i / 2)])) keep.push(...tri); }
      mesh.geometry.setIndex(keep);
      mesh.userData.cut = mesh.geometry.uuid;
    });
    state.invalidate();
  };
  if (SEA === "map") cutLanes();

  // ── Every link, by key ─────────────────────────────────────────────────────────────────────────────────────────────
  const links = new Map<string, LinkInfo>();
  for (const c of data.capabilities) for (const d of c.dependsOn) if (own.has(d.id))
    links.set(`${c.id}->${d.id}`, { key: `${c.id}->${d.id}`, from: c.id, to: d.id, fromTitle: c.title, toTitle: byId.get(d.id)!.title, fromStory: data.story.title, toStory: data.story.title, dir: "inside" });
  // The links between islands, from the map's own lanes as the selection lights them (their userData names each end).
  const lanes: { from: string; to: string; dir: "up" | "down" }[] = [];
  state.scene.getObjectByName("pathways:selection-lanes")?.traverse(o => { if (o.name.startsWith("lane:") && !lanes.some(l => l.from === o.userData.from && l.to === o.userData.to)) lanes.push({ from: o.userData.from, to: o.userData.to, dir: o.userData.dir }); });
  const name = (id: string) => elsewhere.get(id) ?? { title: id, story: "?", storyId: "" };
  for (const landing of layout.landings) {
    const id = landing.capability, out = lanes.filter(l => l.dir === "up" && l.from === id), ins = lanes.filter(l => l.dir === "down" && l.to === id);
    const carry = (l: { from: string; to: string }) => ({ from: l.from, fromTitle: name(l.from).title, fromStory: name(l.from).story, to: l.to, toTitle: name(l.to).title, toStory: name(l.to).story });
    if (ins.length) {
      const stories = [...new Set(ins.map(l => name(l.from).story))];
      links.set(`arrive->${id}`, { key: `arrive->${id}`, from: "sea", to: id, fromTitle: ins.length === 1 ? name(ins[0]!.from).title : `${ins.length} links`, toTitle: byId.get(id)!.title, fromStory: stories.length === 1 ? stories[0]! : `${stories.length} stories`, toStory: data.story.title, dir: "down", carries: ins.map(carry) });
    }
    if (out.length) links.set(`${id}->leave`, { key: `${id}->leave`, from: id, to: "sea", fromTitle: byId.get(id)!.title, toTitle: out.length === 1 ? name(out[0]!.to).title : `${out.length} links`, fromStory: data.story.title, toStory: [...new Set(out.map(l => name(l.to).story))].join(", "), dir: "up", carries: out.map(carry) });
  }

  // ── Settlements: one clear spot in each territory with roads, beside its name, toward the roads it meets ────────────
  const anchorOf = (id: string): P => { const p = plates.get(id); return p ? { x: p.x, z: p.z } : { x: 0, z: 0 }; };
  // Polish round 1: the whole symbol is kept clear of every name, not only its middle (it is SYMBOL.size across, by how many
  // roads meet it), so a name no longer sits on its own settlement.
  const SYMBOL_CLEAR = Number(QUERY.get("symbolClear") ?? 4);
  /** Polish round 2: what a gate under a name or beside a settlement costs the road more (`?gateClear=0`, as before). */
  const GATE_CLEAR = Number(QUERY.get("gateClear") ?? 8);
  /** Polish round 2: a fresh climb off the open land costs more and an arrival's trunk over a third territory less, so the
   * arrivals climb together by one ramp and part on the plateau (`?ramp=0`, as before: each by its own gate). */
  /** And two links' entrances stand a whole gate apart, posts and all (the opening and two entrance posts, about 6.6 units),
   * not 3.8, where two posts touched (`?net={"entranceApart":3.8}`, as before). */
  const ROUND2_NET = { entranceApart: 6, ...(QUERY.get("ramp") === "0" ? {} : { openGate: 30, thirdArrival: 0.5 }) };
  /** And the symbol's edge stands this far (ground units) from any border, so the gates on it do not touch the symbol. */
  const SYMBOL_EDGE = Number(QUERY.get("symbolEdge") ?? 1.5);
  const clearOfNames = (p: P, half: number) => !underName(p, 7) && (SYMBOL_CLEAR < 0 || [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([a, b]) => !underName({ x: p.x + a! * half, z: p.z + b! * half }, SYMBOL_CLEAR, (RELIEF?.height ?? 0) + SIZE.lift)));
  const spot = (territory: string, toward: P, half: number): P => {
    const nm = anchorOf(territory), want = sub(toward, nm);
    let best: P | undefined, score = Infinity;
    for (let a = 0; a < 360; a += 6) {
      const u = { x: Math.cos(a * Math.PI / 180), z: Math.sin(a * Math.PI / 180) };
      let r = 1.5;
      while (r < 30 && underName({ x: nm.x + u.x * r, z: nm.z + u.z * r }, 6)) r += 0.5;
      for (const extra of [0.8, 1.8, 3, 4.5]) {
        const p = { x: nm.x + u.x * (r + extra), z: nm.z + u.z * (r + extra) };
        if (territoryAt(p) !== territory || clearance(p) < Math.max(SIZE.clear + 0.8, half + SYMBOL_EDGE) || !clearOfNames(p, half)) continue;
        const s = angleBetween(u, want) * 6 + dist(p, nm) * 0.35;
        if (s < score) { score = s; best = p; }
        break;
      }
    }
    if (!best) unplaced.push(byId.get(territory)?.title ?? territory);
    return best ?? nm;
  };
  const unplaced: string[] = [];
  const internal = [...links.values()].filter(l => l.dir === "inside");
  const landingOf = new Map(layout.landings.map(l => [l.capability, l]));
  /** Each territory's settlement, toward the middle of what its roads reach: its partners' names and its landing. */
  const towns = new Map<string, P>();
  for (const id of own) {
    const toward = [...internal.filter(l => l.from === id).map(l => anchorOf(l.to)), ...internal.filter(l => l.to === id).map(l => anchorOf(l.from)), ...(landingOf.has(id) ? [landingOf.get(id)!.at] : [])];
    if (!toward.length) continue;
    const n = toward.length, half = SYMBOL.size[n >= 6 ? 2 : n >= 3 ? 1 : 0]! / 2;
    towns.set(id, spot(id, { x: toward.reduce((s, p) => s + p.x, 0) / toward.length, z: toward.reduce((s, p) => s + p.z, 0) / toward.length }, half));
  }

  // ── The roads: one shared network (network.ts), routed between the settlements and from the mouth ────────────────
  const netLinks: NetLink[] = [];
  for (const l of internal) netLinks.push({ key: l.key, kind: "inside", from: towns.get(l.from)!, to: towns.get(l.to)!, fromT: l.from, toT: l.to, links: 1 });
  for (const landing of layout.landings) {
    const id = landing.capability;
    if (links.has(`arrive->${id}`)) netLinks.push({ key: `arrive->${id}`, kind: "arrival", from: layout.harbour.dock, to: towns.get(id)!, fromT: "sea", toT: id, links: links.get(`arrive->${id}`)!.carries!.length });
    if (links.has(`${id}->leave`)) netLinks.push({ key: `${id}->leave`, kind: "out", from: towns.get(id)!, to: layout.keys.dock, fromT: id, toT: "sea", links: links.get(`${id}->leave`)!.carries!.length });
  }
  const toCoast = (p: P) => Math.min(...coastEdges.map(([a, b]) => toSegment(p, a, b)));
  const net = network({
    tAt: territoryAt, toCoast, borders: borderSegs, links: netLinks, mouth: layout.harbour.dock, band: layout.open.band, mouthReach: layout.open.mouth,
    towns: [...towns].map(([territory, at]) => ({ territory, at })),
    // A road keeps out from under the names where it can.
    extra: p => underName(p, 2) ? 2.5 : 0,
    // Polish round 2: and its gates, posts and all, keep out from under the names and off the settlements' symbols.
    // A gate with its posts is about 6 units along its border, which runs any way, so a ring round its middle is tested.
    gateExtra: p => !GATE_CLEAR ? 0 : [p, ...Array.from({ length: 8 }, (_, k) => ({ x: p.x + 3.2 * Math.cos(k * Math.PI / 4), z: p.z + 3.2 * Math.sin(k * Math.PI / 4) }))]
      .some(q => underName(q, 3, (RELIEF?.post.height ?? 0) + SIZE.lift)) || [...towns.values()].some(t => dist(t, p) < 5.5) ? GATE_CLEAR : 0,
    // Round 13: the arrangement's own prices (layout.json's `net`, as the layout tool routed it), and any the query sets
    // (`?net={"edge":0}`).
    cost: { ...layout.net, ...ROUND2_NET, ...JSON.parse(QUERY.get("net") ?? "{}") },
  });
  type Way = { key: string; pts: P[]; from: string; to: string; crossings: { p: P; along: P; coast: boolean; pair?: [string, string] }[] };
  /** Every border a line crosses (and the coast): where, and the border's direction there, in order along it. */
  const crossingsOf = (pts: P[]) => {
    const out: Way["crossings"] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const here: Way["crossings"] = [];
      for (const seg of borderSegs) { const x = segCross(pts[i]!, pts[i + 1]!, seg.a, seg.b); if (x && !out.some(o => dist(o.p, x.p) < 0.3) && !here.some(o => dist(o.p, x.p) < 0.3)) here.push({ p: x.p, along: norm(sub(seg.b, seg.a)), coast: false, pair: seg.pair }); }
      out.push(...here.sort((a, b) => dist(pts[i]!, a.p) - dist(pts[i]!, b.p)));
    }
    return out;
  };
  const ways: Way[] = netLinks.map(l => { const pts = net.ways.get(l.key)!; return { key: l.key, pts, from: l.kind === "arrival" ? "sea" : l.fromT, to: l.kind === "out" ? "sea" : l.toT, crossings: crossingsOf(pts) }; });
  const segments = net.segments.map(s => ({ ...s, out: s.links.every(k => k.endsWith("->leave")) }));
  /** How many links meet at each settlement, in and out (its grade, as round 9's): shared roads carry several. */
  const degree = new Map<string, number>();
  for (const w of ways) for (const id of [w.from, w.to]) if (towns.has(id)) degree.set(id, (degree.get(id) ?? 0) + 1);

  // ── Gates: where a road crosses a border; one gate for every link a shared road carries through it ───────────────
  const gates: Gate[] = [];
  for (const s of segments) for (const c of crossingsOf(s.pts)) gates.push({ at: c.p, along: c.along, links: [...s.links], entrances: [], coast: false, open: c.pair?.includes("open") ?? false, ...(c.pair ? { pair: c.pair } : {}) });
  // Each link's own entrance: the gate where its way last enters the territory it calls (the way out: where it leaves).
  for (const w of ways) {
    const entering = w.to === "sea" ? w.crossings.find(c => c.pair?.includes(w.from)) : [...w.crossings].reverse().find(c => c.pair?.includes(w.to));
    if (!entering) continue;
    const g = gates.reduce<Gate | undefined>((b, x) => dist(x.at, entering.p) < (b ? dist(b.at, entering.p) : 1) ? x : b, undefined);
    if (g && (!g.entranceOf || net.cost.shareEntrance)) { g.entranceOf ??= w.key; g.entrances.push(w.key); }
  }
  const entranceGate = new Map(gates.flatMap(g => g.entrances.map(k => [k, g] as const)));
  /** A gate several links enter by: picked, it opens like a road, listing them. */
  const sharedGates = gates.filter(g => g.entrances.length > 1);

  // Cut each opening out of the map's own border line (and redo it when the map redraws the island).
  const cutBorders = () => {
    const lines = land.parent?.getObjectByName("territory-borders") as LineSegments | undefined;
    if (!lines || lines.userData.cutFor === lines.geometry.uuid) return;
    const pos = lines.geometry.getAttribute("position") as BufferAttribute, ground = lines.userData.ground as number[];
    const out: number[] = [];
    for (let s = 0; s * 4 < ground.length; s++) {
      const a = { x: ground[4 * s]!, z: ground[4 * s + 1]! }, b = { x: ground[4 * s + 2]!, z: ground[4 * s + 3]! }, l = dist(a, b);
      const A = new Vector3(pos.getX(2 * s), pos.getY(2 * s), pos.getZ(2 * s)), B = new Vector3(pos.getX(2 * s + 1), pos.getY(2 * s + 1), pos.getZ(2 * s + 1));
      // The openings on this segment, as stretches of it.
      const holes = gates.filter(g => !g.coast && toSegment(g.at, a, b) < 0.05).map(g => { const t = ((g.at.x - a.x) * (b.x - a.x) + (g.at.z - a.z) * (b.z - a.z)) / (l * l); return [t - SIZE.opening / 2 / l, t + SIZE.opening / 2 / l] as [number, number]; }).sort((x, y) => x[0] - y[0]);
      let from = 0;
      for (const [h0, h1] of [...holes, [1, 1] as [number, number]]) {
        const to = Math.max(from, Math.min(1, h0));
        if (to - from > 1e-3) { const p = A.clone().lerp(B, from), q = A.clone().lerp(B, to); out.push(p.x, p.y, p.z, q.x, q.y, q.z); }
        from = Math.max(from, h1);
      }
    }
    lines.geometry.setAttribute("position", new Float32BufferAttribute(out, 3));
    lines.geometry.computeBoundingSphere();
    if (ROAD.border) { const m = lines.material as MeshBasicMaterial; m.color.set(ROAD.border.colour); m.opacity = ROAD.border.alpha; m.transparent = true; }
    lines.userData.cutFor = lines.geometry.uuid;
    state.invalidate();
  };
  cutBorders();

  // ── Draw ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  const group = new Group(); group.name = "mock-overlay-lines"; root.add(group);
  const H = RELIEF?.height ?? 0;
  const dot = (a: P, b: P) => a.x * b.x + a.z * b.z;
  const perp = (a: P): P => ({ x: -a.z, z: a.x });
  const at = (p: P, d: P, k: number): P => ({ x: p.x + d.x * k, z: p.z + d.z * k });
  // The light, from the upper left of the page at rest, as a direction on the ground (toward the light).
  const L = (() => {
    const o = project(lift({ x: 0, z: 0 })).page, ax = project(lift({ x: 10, z: 0 })).page, az = project(lift({ x: 0, z: 10 })).page;
    const m00 = (ax.x - o.x) / 10, m01 = (az.x - o.x) / 10, m10 = (ax.y - o.y) / 10, m11 = (az.y - o.y) / 10, det = m00 * m11 - m01 * m10 || 1;
    return norm({ x: (m11 * -1 - m01 * -1) / det, z: (-m10 * -1 + m00 * -1) / det });
  })();
  // A ramp at every gate between a territory and the open land, on the open land's side, climbing to the territory.
  type Ramp = { at: P; along: P; out: P; gate: Gate; territory: string };
  const ramps: Ramp[] = [];
  if (RELIEF) for (const g of gates) if (g.open) {
    const n = perp(g.along), out = territoryAt(at(g.at, n, 0.8)) === "open" ? n : { x: -n.x, z: -n.z };
    const territory = territoryAt(at(g.at, out, -0.8));
    if (territory && territory !== "open") ramps.push({ at: g.at, along: g.along, out, gate: g, territory });
  }
  const onRamp = (p: P) => {
    for (const r of ramps) { const d = sub(p, r.at), u = dot(d, r.along), w = dot(d, r.out); if (Math.abs(u) <= RELIEF!.ramp.width / 2 && w >= -0.05 && w <= RELIEF!.ramp.depth) return 1 - Math.max(0, w) / RELIEF!.ramp.depth; }
    return undefined;
  };
  /** How far a point stands above the open land: a territory's plateau, or part way up a ramp. */
  const raise = (p: P) => { if (!RELIEF) return 0; const t = territoryAt(p); if (t && t !== "open") return H; return (onRamp(p) ?? 0) * H; };
  const topAt = (p: P) => heightAt(p) + raise(p);
  const liftTop = (p: P, up = 0) => new Vector3(p.x, topAt(p) + up, p.z);
  const y = (up: number) => (p: P) => topAt(p) + SIZE.lift + up;
  /** A way resampled every half unit, so what it carries follows the ramps. */
  const dense = (pts: P[]) => { const out: P[] = [pts[0]!]; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1]!, b = pts[i]!, n = Math.max(1, Math.ceil(dist(a, b) / 0.5)); for (let k = 1; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n }); } return out; };
  // The map's own territories (fills and borders) lifted onto the plateau; again whenever the map redraws them.
  const raiseLand = () => {
    if (!RELIEF) return;
    for (const o of [land, land.parent?.getObjectByName("territory-borders")]) if (o) { o.userData.baseY ??= o.position.y; o.position.y = (o.userData.baseY as number) + H; }
  };
  raiseLand();
  const GROUND = new Color(GROUND_HEX);
  /** The colour a point shows: its territory's fill over the island's ground, or the bare ground. */
  const under = (p: P) => { const t = territoryAt(p), f = t && t !== "open" ? fillOf.get(t) : undefined; if (!f) return GROUND.clone(); const m = f.mesh.material as MeshBasicMaterial; return GROUND.clone().lerp(new Color(f.colour), m.transparent ? m.opacity : 1); };
  const fillShown = (t: string) => under(at(anchorOf(t), { x: 0, z: 0 }, 0)).clone();
  const mat = (colour: string, opacity = 1) => new MeshBasicMaterial({ color: colour, transparent: true, opacity, side: DoubleSide, depthWrite: false, depthTest: false, fog: false });
  const casingMat = mat(PALETTE.casing, 0.88);
  const add = (geometry: BufferGeometry, m: MeshBasicMaterial, order: number) => { const o = new Mesh(geometry, m); o.renderOrder = order; o.raycast = () => {}; group.add(o); return o; };
  const disc = (p: P, r: number, m: MeshBasicMaterial, order: number, up: number) => { const g = new CircleGeometry(r, 20); g.rotateX(-Math.PI / 2); const o = add(g, m, order); o.position.copy(liftTop(p, SIZE.lift + up)); return o; };
  const coreMats = new Map<string, MeshBasicMaterial[]>();
  const keep = (key: string, m: MeshBasicMaterial) => { m.userData.colour ??= `#${m.color.getHexString()}`; coreMats.set(key, [...(coreMats.get(key) ?? []), m]); return m; };
  /** A road's width, by how many links it carries: a quiet step at 2, 4 and 8. */
  const widthOf = (n: number) => SIZE.width[n >= 8 ? 3 : n >= 4 ? 2 : n >= 2 ? 1 : 0]!;
  const roadMat = mat(PALETTE.line), outMat = mat(PALETTE.out);
  const ends = new Map<string, { at: P; n: number; out: boolean }>();
  for (const s of segments) for (const e of [s.pts[0]!, s.pts.at(-1)!]) {
    const k = `${e.x.toFixed(2)},${e.z.toFixed(2)}`, was = ends.get(k);
    ends.set(k, { at: e, n: Math.max(was?.n ?? 0, s.links.length), out: (was?.out ?? true) && s.out });
  }
  const litRoad = new Map<string, Mesh[]>();
  if (ROAD_KEY === "r10") {
    for (const s of segments) {
      const w = widthOf(s.links.length);
      add(ribbon(s.pts, w + SIZE.casing * 2, y(0)), casingMat, 10);
      keep(`road:${s.id}`, add(ribbon(s.pts, w, y(0.02)), s.out ? outMat.clone() : roadMat.clone(), 11).material as MeshBasicMaterial);
    }
    // Junctions: a disc as wide as the widest road meeting there, so the joins read as one road.
    for (const { at, n, out } of ends.values()) { const w = widthOf(n); disc(at, w / 2 + SIZE.casing, casingMat, 10, -0.01); disc(at, w / 2, out ? outMat : roadMat, 11, 0.01); }
  } else {
    // Round 11: each layer opaque, its colour mixed into the land under each point, so a faint road joins without dark knots.
    const cls = (n: number) => n >= 8 ? 3 : n >= 4 ? 2 : n >= 2 ? 1 : 0;
    ROAD.layers.forEach((layer, li) => {
      const ink = new Color(layer.colour), mix = (p: P) => under(p).lerp(ink, layer.alpha);
      const m = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, side: DoubleSide, depthWrite: false, depthTest: false, fog: false });
      for (const s of segments) add(ribbon(dense(s.pts), layer.widths[cls(s.links.length)]!, y(0.02 * li), mix), m, 10 + li);
      for (const { at, n } of ends.values()) { const g = new CircleGeometry(layer.widths[cls(n)]! / 2, 16); g.rotateX(-Math.PI / 2); const o = add(g, new MeshBasicMaterial({ color: mix(at), transparent: true, opacity: 1, side: DoubleSide, depthWrite: false, depthTest: false, fog: false }), 10 + li); o.position.copy(liftTop(at, SIZE.lift + 0.02 * li + 0.005)); }
    });
    // A picked road lights in gold on a thin dark edge, so it holds on yellow land.
    for (const s of segments) {
      const edge = add(ribbon(dense(s.pts), SIZE.line + 0.6, y(0.04)), mat(PALETTE.casing, 0.75), 12), gold = add(ribbon(dense(s.pts), SIZE.line, y(0.05)), mat(PALETTE.lit), 13);
      edge.visible = gold.visible = false; litRoad.set(`road:${s.id}`, [edge, gold]);
    }
  }
  // A lit link: its whole way, in gold, over the shared roads it travels (hidden until it is picked).
  const litMat = mat(PALETTE.lit);
  const litWay = new Map<string, Mesh>();
  const litEdge = new Map<string, Mesh>();
  for (const w of ways) {
    const o = add(ribbon(dense(w.pts), SIZE.line, y(0.05)), litMat, 13); o.visible = false; litWay.set(w.key, o);
    if (ROAD_KEY !== "r10") { const e = add(ribbon(dense(w.pts), SIZE.line + 0.6, y(0.04)), mat(PALETTE.casing, 0.75), 12); e.visible = false; litEdge.set(w.key, e); }
  }
  // Round 12: each settlement is the architecture-diagram symbol for its capability's kind (../kinds.mjs), its outline in
  // ink on a paper fill over a faint dark casing, laid flat on the plateau and graded by how many roads meet there, as round
  // 11's discs are. Drawn once per kind into a canvas and laid as a texture. `?icons=disc` draws round 11's discs.
  const symbolTexture = new Map<string, CanvasTexture>();
  const symbolOf = (kind: string) => {
    if (symbolTexture.has(kind)) return symbolTexture.get(kind)!;
    const px = 256, canvas = document.createElement("canvas"); canvas.width = canvas.height = px;
    const g = canvas.getContext("2d")!, glyph = GLYPHS[kind as keyof typeof GLYPHS];
    g.translate(px / 2, px / 2); g.scale(px / 28, px / 28); g.lineJoin = "round"; g.lineCap = "round";
    const all = [...glyph.parts, ...glyph.lines].map(d => new Path2D(d));
    g.strokeStyle = `rgba(20,26,32,${SYMBOL.casing})`; g.lineWidth = SYMBOL.width + 2.2; for (const p of all) g.stroke(p);
    for (const d of glyph.parts) { const p = new Path2D(d); g.fillStyle = PALETTE.paper; g.fill(p); g.strokeStyle = PALETTE.ink; g.lineWidth = SYMBOL.width; g.stroke(p); }
    for (const d of glyph.lines) { g.strokeStyle = PALETTE.ink; g.lineWidth = SYMBOL.width; g.stroke(new Path2D(d)); }
    const texture = new CanvasTexture(canvas); texture.anisotropy = 4; texture.colorSpace = SRGBColorSpace;
    symbolTexture.set(kind, texture);
    return texture;
  };
  const kinds = new Map<string, number>();
  if (ICONS === "symbols") for (const [id, at] of towns) {
    const n = degree.get(id) ?? 0, grade = n >= 6 ? 2 : n >= 3 ? 1 : 0, size = SYMBOL.size[grade]! * 28 / 24, kind = kindOf(byId.get(id)!.title);
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    const geometry = new PlaneGeometry(size, size); geometry.rotateX(-Math.PI / 2);
    const o = add(geometry, new MeshBasicMaterial({ map: symbolOf(kind), transparent: true, depthWrite: false, depthTest: false, fog: false }), 16);
    o.position.copy(liftTop(at, SIZE.lift + 0.12));
  }
  // Round 11's settlements: a paper disc ringed in ink, graded by how many roads meet.
  const inkTown = mat(PALETTE.ink), paperTown = mat(PALETTE.paper);
  if (ICONS === "disc") for (const [id, at] of towns) {
    const n = degree.get(id) ?? 0, grade = n >= 6 ? 2 : n >= 3 ? 1 : 0, r = SIZE.town[grade]!;
    disc(at, r + SIZE.casing * 0.6, casingMat, 15, 0.08);
    disc(at, r, inkTown, 16, 0.1);
    disc(at, r - SIZE.townRing, paperTown, 17, 0.12);
    if (grade === 2) { disc(at, r - SIZE.townRing * 2.1, inkTown, 18, 0.14); disc(at, r - SIZE.townRing * 2.9, paperTown, 19, 0.16); }
    if (grade >= 1) disc(at, SIZE.townDot, inkTown, 20, 0.18);
  }
  // The gates' posts: a small square each side of the opening, standing on the border, ink edged with a paper face.
  const square = (c: P, along: P, side: number, m: MeshBasicMaterial, order: number, up: number) => {
    const h = side / 2, a = { x: c.x - along.x * h, z: c.z - along.z * h }, b = { x: c.x + along.x * h, z: c.z + along.z * h };
    return add(bar(a, b, side, y(up)), m, order);
  };
  const inkMat = mat(PALETTE.post);
  /** Coloured triangles: `tri(a, b, c, colour)` with points in the root's frame; one mesh per call of `solid`. */
  const solid = (order: number, opts: { depth?: boolean; front?: boolean } = {}) => {
    const pos: number[] = [], col: number[] = [];
    const tri = (a: Vector3, b: Vector3, c: Vector3, ca: Color, cb = ca, cc = ca) => { pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); col.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b); };
    /** A quad a-b-c-d; with `facing`, wound so its front faces that way on the ground (a vertical face seen from outside). */
    const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3, ca: Color, cb = ca, cc = cb, cd = ca, facing?: P) => {
      if (facing) { const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)); if (n.x * facing.x + n.z * facing.z < 0) { tri(a, c, b, ca, cc, cb); tri(a, d, c, ca, cd, cc); return; } }
      tri(a, b, c, ca, cb, cc); tri(a, c, d, ca, cc, cd);
    };
    const done = () => {
      const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(pos, 3)); g.setAttribute("color", new Float32BufferAttribute(col, 3));
      return add(g, new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, side: opts.front ? FrontSide : DoubleSide, depthWrite: !!opts.depth, depthTest: !!opts.depth, fog: false }), order);
    };
    return { tri, quad, done };
  };
  const shade = (c: Color, facing: P) => { const k = (dot(norm(facing), L) + 1) / 2; return c.clone().multiplyScalar(RELIEF ? RELIEF.wall.away + (RELIEF.wall.lit - RELIEF.wall.away) * k : 1); };
  const openingOf = (g: Gate) => Math.max(SIZE.opening, (ROAD_KEY === "r10" ? widthOf(g.links.length) : ROAD.layers.at(-1)!.widths[g.links.length >= 8 ? 3 : g.links.length >= 4 ? 2 : g.links.length >= 2 ? 1 : 0]!) + 2);
  const postSolid = RELIEF ? solid(17, { depth: true }) : undefined, postShadow = RELIEF ? solid(16) : undefined;
  for (const g of gates) {
    const m = mat(PALETTE.paper);
    const opening = openingOf(g), ramp = ramps.find(r => r.gate === g);
    if (!RELIEF) {
      const [outer, face] = g.entranceOf ? [SIZE.entrancePost, SIZE.entranceFace] : [SIZE.post, SIZE.face];
      for (const side of [-1, 1]) {
        const c = { x: g.at.x + g.along.x * (opening / 2 + outer / 2) * side, z: g.at.z + g.along.z * (opening / 2 + outer / 2) * side };
        square(c, g.along, outer, inkMat, 17, 0.12);
        square(c, g.along, face, m, 18, 0.14);
      }
    } else {
      // Standing posts: an ink-edged top with a paper face, slate sides shaded by the light, a soft shadow away from it.
      const P = RELIEF.post, side = g.entranceOf ? P.entrance : P.side, tall = g.entranceOf ? P.entranceHeight : P.height;
      const gap = ramp ? Math.max(opening, RELIEF.ramp.width) : opening, nrm = perp(g.along);
      for (const sgn of [-1, 1]) {
        let c = at(g.at, g.along, (gap / 2 + side / 2) * sgn);
        if (ramp) c = at(c, ramp.out, -(side / 2 + 0.15));
        const base = heightAt(c) + (RELIEF ? Math.max(raise(at(c, nrm, 0.3)), raise(at(c, nrm, -0.3))) : 0), h = side / 2;
        const foot = [at(at(c, g.along, -h), nrm, -h), at(at(c, g.along, h), nrm, -h), at(at(c, g.along, h), nrm, h), at(at(c, g.along, -h), nrm, h)];
        const v = (q: P, up: number) => new Vector3(q.x, base + up, q.z), body = new Color(P.body);
        for (let i = 0; i < 4; i++) { const a = foot[i]!, b = foot[(i + 1) % 4]!, out = sub(at(a, sub(b, a), 0.5), c); postSolid!.quad(v(a, 0), v(b, 0), v(b, tall), v(a, tall), shade(body, out), undefined, undefined, undefined, out); }
        const ink = new Color(PALETTE.post);
        postSolid!.quad(v(foot[0]!, tall), v(foot[1]!, tall), v(foot[2]!, tall), v(foot[3]!, tall), ink);
        const f = side * P.faceRatio / 2, faceAt = [at(at(c, g.along, -f), nrm, -f), at(at(c, g.along, f), nrm, -f), at(at(c, g.along, f), nrm, f), at(at(c, g.along, -f), nrm, f)];
        const faceGeom = new BufferGeometry(); faceGeom.setAttribute("position", new Float32BufferAttribute(faceAt.flatMap(q => [q.x, base + tall + 0.02, q.z]), 3)); faceGeom.setIndex([0, 1, 2, 0, 2, 3]);
        const faceMat = new MeshBasicMaterial({ color: PALETTE.paper, transparent: true, opacity: 1, side: DoubleSide, depthWrite: true, depthTest: true, fog: false });
        add(faceGeom, faceMat, 18); for (const k of g.entrances) keep(k, faceMat);
        // The shadow: the footprint swept away from the light, flat on the ground beside it.
        const away = { x: -L.x * tall * P.reach, z: -L.z * tall * P.reach }, hull = [...foot, ...foot.map(q => ({ x: q.x + away.x, z: q.z + away.z }))];
        const mid = { x: hull.reduce((a, q) => a + q.x, 0) / hull.length, z: hull.reduce((a, q) => a + q.z, 0) / hull.length };
        hull.sort((a, b) => Math.atan2(a.z - mid.z, a.x - mid.x) - Math.atan2(b.z - mid.z, b.x - mid.x));
        for (let i = 0; i < hull.length; i++) { const a = hull[i]!, b = hull[(i + 1) % hull.length]!; postShadow!.tri(v(mid, 0.04), v(a, 0.04), v(b, 0.04), under(mid).lerp(new Color("#000"), P.shadow)); }
      }
    }
    if (!RELIEF) for (const k of g.entrances) keep(k, m);
  }
  postSolid?.done(); postShadow?.done();

  // ── The relief: walls and shadows round the plateaus, ramps, and the bevel rims inside the borders ─────────────────
  const reliefStats = { walls: 0, ramps: ramps.length, rims: 0 };
  if (RELIEF) {
    const R = RELIEF, black = new Color("#000"), white = new Color("#fff");
    /** The stretches of a-b (as [from, to] fractions) left once `holes` (each a centre and a half-width along it) are cut. */
    const keepOf = (a: P, b: P, holes: { at: P; half: number }[]) => {
      const l = dist(a, b) || 1, u = { x: (b.x - a.x) / l, z: (b.z - a.z) / l }, cut = holes.filter(h => toSegment(h.at, a, b) < 0.6).map(h => { const t = dot(sub(h.at, a), u) / l; return [t - h.half / l, t + h.half / l] as [number, number]; }).sort((x, y2) => x[0] - y2[0]);
      const out: [number, number][] = []; let from = 0;
      for (const [h0, h1] of [...cut, [1, 1] as [number, number]]) { const to = Math.max(from, Math.min(1, h0)); if (to - from > 1e-3) out.push([from, to]); from = Math.max(from, h1); }
      return out;
    };
    const lerpP = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    const rampHoles = ramps.map(r => ({ at: r.at, half: R.ramp.width / 2 }));
    // Walls: every edge of a territory's fill that no other territory shares (onto the open land, or the coast).
    const walls = solid(9, { front: true }), shadows = solid(8);
    const edges = new Map<string, { a: P; b: P; c: P; t: string; n: number }>();
    for (const [t, f] of fillOf) {
      const g = f.mesh.geometry, pos = g.getAttribute("position"), idx = g.getIndex(), count = (idx ? idx.count : pos.count) / 3;
      for (let k = 0; k < count; k++) {
        const ps = [0, 1, 2].map(j => { const i = idx ? idx.getX(3 * k + j) : 3 * k + j; return { x: pos.getX(i), z: pos.getZ(i) }; });
        for (let e = 0; e < 3; e++) {
          const a = ps[e]!, b = ps[(e + 1) % 3]!, key = [a, b].map(q => `${q.x.toFixed(3)},${q.z.toFixed(3)}`).sort().join("|");
          const was = edges.get(key);
          if (was) was.n++; else edges.set(key, { a, b, c: ps[(e + 2) % 3]!, t, n: 1 });
        }
      }
    }
    for (const e of edges.values()) {
      if (e.n !== 1) continue;
      let n = norm(perp(sub(e.b, e.a))); if (dot(n, sub(e.c, e.a)) > 0) n = { x: -n.x, z: -n.z };
      const mid = lerpP(e.a, e.b, 0.5), beyond = territoryAt(at(mid, n, 0.5));
      if (beyond && beyond !== "open") continue;
      const fill = under(at(mid, n, -0.5)), face = shade(fill, n);
      for (const [t0, t1] of keepOf(e.a, e.b, beyond === "open" ? rampHoles : [])) {
        const a = lerpP(e.a, e.b, t0), b = lerpP(e.a, e.b, t1);
        walls.quad(new Vector3(a.x, heightAt(a) + H, a.z), new Vector3(b.x, heightAt(b) + H, b.z), new Vector3(b.x, heightAt(b) - 0.05, b.z), new Vector3(a.x, heightAt(a) - 0.05, a.z), face, face, face, face, n);
        reliefStats.walls++;
        // Its shadow on the open land, where the wall faces away from the light.
        const k = -dot(n, L);
        if (beyond === "open" && k > 0) {
          const A = R.shadow.alpha * Math.sqrt(k), r1 = R.shadow.reach * Math.sqrt(k), r2 = r1 + R.shadow.feather;
          const g0 = GROUND.clone().lerp(black, A), g1 = GROUND.clone().lerp(black, A * 0.85), g2 = GROUND.clone();
          const v = (q: P) => new Vector3(q.x, heightAt(q) + 0.02, q.z);
          shadows.quad(v(a), v(b), v(at(b, n, r1)), v(at(a, n, r1)), g0, g0, g1, g1);
          shadows.quad(v(at(a, n, r1)), v(at(b, n, r1)), v(at(b, n, r2)), v(at(a, n, r2)), g1, g1, g2, g2);
        }
      }
    }
    walls.done(); shadows.done();
    // Ramps: a slope from the open land up to the plateau, its two cheeks first so the slope covers the far one.
    const cheeks = solid(9.2), slopes = solid(9.4);
    for (const r of ramps) {
      const fill = fillShown(r.territory), w = R.ramp.width / 2, d = R.ramp.depth;
      const e1 = at(r.at, r.along, -w), e2 = at(r.at, r.along, w), f1 = at(e1, r.out, d), f2 = at(e2, r.out, d);
      const top = (q: P) => new Vector3(q.x, heightAt(q) + H, q.z), low = (q: P) => new Vector3(q.x, heightAt(q) + 0.01, q.z);
      cheeks.tri(top(e1), low(e1), low(f1), shade(fill, { x: -r.along.x, z: -r.along.z }));
      cheeks.tri(top(e2), low(e2), low(f2), shade(fill, r.along));
      const slope = fill.clone().multiplyScalar(0.9 + 0.08 * dot(r.out, L));
      slopes.quad(top(e1), top(e2), low(f2), low(f1), fill, fill, slope, slope);
    }
    cheeks.done(); slopes.done();
    // Bevel rims: inside each border, on each territory's side, broken at every gate.
    const rims = solid(9.6), gateHoles = gates.map(g => ({ at: g.at, half: openingOf(g) / 2 + (g.entranceOf ? R.post.entrance : R.post.side) + 0.2 }));
    for (const seg of borderSegs) {
      const n = norm(perp(sub(seg.b, seg.a)));
      for (const sgn of [1, -1]) {
        const into = { x: n.x * sgn, z: n.z * sgn }, mid = lerpP(seg.a, seg.b, 0.5), t = territoryAt(at(mid, into, 0.4));
        if (!t || t === "open") continue;
        const k = dot({ x: -into.x, z: -into.z }, L), fill = under(at(mid, into, 0.4));
        const edge = fill.clone().lerp(k > 0 ? white : black, (k > 0 ? R.rim.light : R.rim.dark) * Math.sqrt(Math.abs(k)));
        const hold = fill.clone().lerp(edge, 0.85);
        for (const [t0, t1] of keepOf(seg.a, seg.b, gateHoles)) {
          const a = lerpP(seg.a, seg.b, t0), b = lerpP(seg.a, seg.b, t1), v = (q: P) => new Vector3(q.x, heightAt(q) + H + 0.06, q.z);
          rims.quad(v(a), v(b), v(at(b, into, R.rim.width * R.rim.hold)), v(at(a, into, R.rim.width * R.rim.hold)), edge, edge, hold, hold);
          rims.quad(v(at(a, into, R.rim.width * R.rim.hold)), v(at(b, into, R.rim.width * R.rim.hold)), v(at(b, into, R.rim.width)), v(at(a, into, R.rim.width)), hold, hold, fill, fill);
          reliefStats.rims++;
        }
      }
    }
    rims.done();
  }

  // ── The wrenches: 6C's rule, at the entrance gate of the link its work changes (its most central entrance) ───────────
  const overlay = document.createElement("div");
  overlay.className = "mock-overlay";
  host.appendChild(overlay);
  type Spot = { el: HTMLElement; at: Vector3 };
  const spots: Spot[] = [];
  const wrenches = new Map<string, Spot & { via: string }>();
  for (const id of new Set(data.openWork.flatMap(w => w.capabilities))) {
    if (!own.has(id)) continue;
    const ins = [...entranceGate].filter(([k]) => ways.find(w => w.key === k)?.to === id).sort((a, b) => dist(a[1].at, anchorOf(id)) - dist(b[1].at, anchorOf(id)));
    const outs = [...entranceGate].filter(([k]) => ways.find(w => w.key === k)?.from === id);
    // Polish round 1: of the entrances on its own border, the nearest whose plate (11 px round, 27 px above the gate, its
    // tabs to the right) stands clear of every name; the nearest, as before, when none does.
    // Where none does, the stem leans (a few pixels either way) until the plate clears.
    const plateClear = ([, gate]: [string, { at: P }], dx = 0) => { const q = project(liftTop(gate.at, SIZE.lift)).page, l = q.x + dx - 13, r = q.x + dx + 13 + (QUEUE.x + QUEUE.step * 2), t = q.y - 40, b = q.y - 14; return !nameBoxes.some(n => l < n.r && r > n.l && t < n.b && b > n.t); };
    const [via, g] = (WRENCH_CLEAR ? (ins.length ? ins : outs).find(e => plateClear(e)) : undefined) ?? ins[0] ?? outs[0] ?? [];
    if (!via || !g) continue;
    const lean = WRENCH_CLEAR && !plateClear([via, g]) ? [-14, 14, -22, 22, -30, 30, -40, 40].find(dx => plateClear([via, g], dx)) ?? 0 : 0;
    const el = document.createElement("div");
    el.className = "mock-wrench"; el.dataset.capability = id;
    // Round 13: the increments lined up on it, beside the plate: a tab each, the one being built (active) inked first, the
    // rest waiting in paper, in the order they were parked; past QUEUE.most, a count.
    const queue = data.openWork.filter(w => w.capabilities.includes(id)).sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1) || String(a.parked ?? "").localeCompare(String(b.parked ?? "")));
    const tabs = queue.slice(0, QUEUE.most).map((w, k) => `<rect x="${QUEUE.x + k * QUEUE.step}" y="${QUEUE.y}" width="${QUEUE.w}" height="${QUEUE.h}" rx="1" fill="${w.status === "active" ? PALETTE.ink : PALETTE.paper}" stroke="${PALETTE.ink}" stroke-width="1"/>`).join("")
      + (queue.length > QUEUE.most ? `<text x="${QUEUE.x + QUEUE.most * QUEUE.step + 1}" y="${QUEUE.y + QUEUE.h - 0.5}" fill="${PALETTE.paper}" font-size="8" font-weight="700" font-family="system-ui, sans-serif" paint-order="stroke" stroke="${PALETTE.casing}" stroke-width="2.4">+${queue.length - QUEUE.most}</text>` : "");
    el.innerHTML = `<svg viewBox="-13 -40 26 42" width="26" height="42" overflow="visible" aria-hidden="true">
      <ellipse cx="0" cy="0" rx="4.5" ry="1.6" fill="#080b0e" fill-opacity="0.55"/>
      <path d="M0 0L${lean * 17 / 27} -17" stroke="${PALETTE.ink}" stroke-width="1.6"/>
      <circle class="plate" cx="${lean}" cy="-27" r="11" fill="${PALETTE.paper}" stroke="${PALETTE.ink}" stroke-width="1.2"/>
      <g transform="translate(${lean} -27) scale(0.66)"><path class="glyph" d="${WRENCH}" fill="${PALETTE.ink}"/></g>
      <g class="queue" data-count="${queue.length}" transform="translate(${lean} 0)">${tabs}</g>
    </svg>`;
    overlay.appendChild(el);
    const s = { el, at: liftTop(g.at, SIZE.lift), via };
    spots.push(s); wrenches.set(id, s);
  }
  let frame = 0;
  const follow = () => {
    for (const s of spots) { const at = project(s.at); s.el.style.transform = `translate(${at.x}px, ${at.y}px)`; s.el.style.visibility = at.front ? "" : "hidden"; }
    frame = requestAnimationFrame(follow);
  };
  follow();
  state.invalidate();

  // ── The sea lane (sea.ts): one pale-blue line per stretch at sea, and a port at the mouth and at Keys ─────────────────
  const sea: Sea = seaLayer({ state, root, story, heightAt: p => topAt(p), light: L,
    docks: [{ at: layout.harbour.dock, sea: layout.harbour.sea, dir: "down" }, { at: layout.keys.dock, sea: layout.keys.sea, dir: "up" }],
    post: { faceRatio: RELIEF?.post.faceRatio ?? 0.62, body: RELIEF?.post.body ?? "#9aa2a8", ink: PALETTE.post, paper: PALETTE.paper,
      shadow: RELIEF?.post.shadow ?? 0.22, reach: RELIEF?.post.reach ?? 0.8, wall: RELIEF?.wall ?? { lit: 0.84, away: 0.56 } } });

  // ── Picking: a wrench, then an entrance gate, then a settlement (its territory), then a road, then the territory below ─
  const raycaster = new Raycaster();
  const gateAt = (x: number, yy: number) => {
    let best: string | undefined, d = 10;
    for (const [key, g] of entranceGate) { const q = project(liftTop(g.at, SIZE.lift)).page, dd = Math.hypot(q.x - x, q.y - yy); if (dd < d) { d = dd; best = key; } }
    return best;
  };
  /** The road segment under a point on the page. */
  const lineAt = (x: number, yy: number) => {
    let best: (typeof segments)[number] | undefined, d = 6;
    for (const s of segments) {
      const pts = s.pts.map(p => project(liftTop(p, SIZE.lift)).page);
      for (let i = 0; i + 1 < pts.length; i++) { const dd = toSegment({ x, z: yy }, { x: pts[i]!.x, z: pts[i]!.y }, { x: pts[i + 1]!.x, z: pts[i + 1]!.y }); if (dd < d) { d = dd; best = s; } }
    }
    return best;
  };
  const pick = (x: number, yy: number): Picked | undefined => {
    for (const [id, w] of wrenches) {
      const box = w.el.querySelector(".plate")!.getBoundingClientRect();
      if (x >= box.left - 3 && x <= box.right + 3 && yy >= box.top - 3 && yy <= box.bottom + 3) return { kind: "wrench", id };
    }
    const gate = gateAt(x, yy), shared = gate ? sharedGates.indexOf(entranceGate.get(gate)!) : -1;
    if (gate) return shared >= 0 ? { kind: "road", id: `gate:${shared}` } : { kind: "link", id: gate };
    for (const [id, at] of towns) { const q = project(liftTop(at, SIZE.lift)).page; if (Math.hypot(q.x - x, q.y - yy) < 7) return { kind: "territory", id }; }
    // A road carrying one link opens that link; a shared road opens the road, with the links it carries.
    const line = lineAt(x, yy);
    if (line) return line.links.length === 1 ? { kind: "link", id: line.links[0]! } : { kind: "road", id: String(line.id) };
    const rect = state.gl.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new Vector2((x - rect.left) / rect.width * 2 - 1, -((yy - rect.top) / rect.height) * 2 + 1), state.camera as Camera);
    const under = raycaster.intersectObjects([...fillOf.values()].map(f => f.mesh), false)[0];
    const id = under?.object.name.slice("territory:".length);
    return id && own.has(id) ? { kind: "territory", id } : undefined;
  };
  const find = (kind: string, id: string): Picked | undefined => {
    if (kind === "territory") return own.has(id) ? { kind, id } : undefined;
    if (kind === "wrench") return wrenches.has(id) ? { kind, id } : undefined;
    if (kind === "link") return ways.some(w => w.key === id) ? { kind, id } : undefined;
    if (kind === "road") return segments.some(s => String(s.id) === id) || sharedGates[Number(id.replace("gate:", ""))] && id.startsWith("gate:") ? { kind, id } : undefined;
    return undefined;
  };
  // A picked link lights its whole way along the shared roads, and its entrance gate, in gold; a picked road lights
  // itself. Nothing is hidden or dimmed.
  const highlight = (picked: Picked | undefined) => {
    for (const list of coreMats.values()) for (const m of list) m.color.set(m.userData.colour as string);
    for (const o of [...litWay.values(), ...litEdge.values(), ...[...litRoad.values()].flat()]) o.visible = false;
    for (const w of wrenches.values()) w.el.classList.remove("lit");
    const keys = picked?.kind === "link" ? [picked.id] : picked?.kind === "wrench" ? [wrenches.get(picked.id)!.via] : picked?.kind === "road" ? (picked.id.startsWith("gate:") ? sharedGates[Number(picked.id.slice(5))]!.entrances : [`road:${picked.id}`]) : [];
    for (const k of keys) { for (const m of coreMats.get(k) ?? []) m.color.set(PALETTE.lit); for (const o of [litWay.get(k), litEdge.get(k), ...(litRoad.get(k) ?? [])]) if (o) o.visible = true; }
    if (picked?.kind === "wrench") wrenches.get(picked.id)!.el.classList.add("lit");
    state.invalidate();
  };
  /** Where a mark stands on the page: a link by its entrance gate, a territory by a clear point in it. */
  const point = (kind: string, id: string) => {
    if (kind === "wrench") { const w = wrenches.get(id); if (!w) return undefined; const b = w.el.querySelector(".plate")!.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }
    if (kind === "gate") { const g = entranceGate.get(id) ?? sharedGates[Number(id.replace("gate:", ""))]; return g ? project(liftTop(g.at, SIZE.lift)).page : undefined; }
    if (kind === "town") { const t = towns.get(id); return t ? project(liftTop(t, SIZE.lift)).page : undefined; }
    if (kind === "keys") return project(liftTop(layout.keys.dock, SIZE.lift)).page;
    if (kind === "mouth") return project(liftTop(layout.harbour.dock, SIZE.lift)).page;
    if (kind === "road") {
      const s = segments.find(x => String(x.id) === id);
      if (!s) return undefined;
      for (const t of [0.5, 0.4, 0.6, 0.3, 0.7]) { const q = project(liftTop(s.pts[Math.round(t * (s.pts.length - 1))]!, SIZE.lift)).page, hit = pick(q.x, q.y); if (hit?.kind === "road" && hit.id === id) return q; }
      return undefined;
    }
    if (kind === "territory") {
      const nm = anchorOf(id);
      for (let r = 3; r < 30; r += 1) for (let a = 0; a < 360; a += 20) {
        const p = { x: nm.x + r * Math.cos(a * Math.PI / 180), z: nm.z + r * Math.sin(a * Math.PI / 180) }, q = project(liftTop(p)).page;
        if (territoryAt(p) === id && !underName(p, 4) && clearance(p) > 1.5 && !lineAt(q.x, q.y) && !gateAt(q.x, q.y) && pick(q.x, q.y)?.kind === "territory") return q;
      }
      return undefined;
    }
    const g = entranceGate.get(id);
    if (g) { const q = project(liftTop(g.at, SIZE.lift)).page, hit = pick(q.x, q.y); if (hit?.kind === "link" && hit.id === id) return q; }
    return undefined;
  };

  const fills = [...new Map(data.capabilities.map(c => {
    const word = (c as unknown as { parked: boolean; word: string }).parked ? "parked" : (c as unknown as { word: string }).word, shape = fillOf.get(c.id);
    return [word, { word, colour: shape ? `#${new Color(shape.colour).getHexString()}` : "#97c459" }] as const;
  })).values()];
  // ── Round 13's crowding, on the page as it stands now: each mark's box (a name as the map lays it out, a settlement's
  // symbol, a gate's opening with its two posts, a wrench's plate), how many pairs of them overlap, and how near the rest
  // stand; for the whole island and for the knot round Library API.
  const crowding = (knot: readonly string[] = KNOT) => {
    type Box = { kind: string; id: string; of: string[]; l: number; r: number; t: number; b: number };
    const boxOf = (kind: string, id: string, of: string[], pts: { x: number; y: number }[]): Box => ({ kind, id, of, l: Math.min(...pts.map(q => q.x)), r: Math.max(...pts.map(q => q.x)), t: Math.min(...pts.map(q => q.y)), b: Math.max(...pts.map(q => q.y)) });
    const ground = (p: P, up = SIZE.lift) => project(liftTop(p, up)).page;
    const boxes: Box[] = [];
    for (const el of host.querySelectorAll<HTMLElement>(".planet-nameplate.capability")) { const r = el.getBoundingClientRect(); if (r.width) boxes.push({ kind: "name", id: el.dataset.capabilityId!, of: [el.dataset.capabilityId!], l: r.left, r: r.right, t: r.top, b: r.bottom }); }
    for (const [id, p] of towns) {
      const n = degree.get(id) ?? 0, half = SYMBOL.size[n >= 6 ? 2 : n >= 3 ? 1 : 0]! / 2;
      boxes.push(boxOf("symbol", id, [id], [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ground({ x: p.x + a! * half, z: p.z + b! * half }))));
    }
    gates.forEach((g, i) => {
      const half = openingOf(g) / 2 + (g.entranceOf ? RELIEF?.post.entrance ?? SIZE.entrancePost : RELIEF?.post.side ?? SIZE.post), up = (RELIEF?.post.height ?? 0) + SIZE.lift;
      boxes.push(boxOf("gate", String(i), (g.pair ?? []).filter(t => t !== "open"), [at(g.at, g.along, -half), at(g.at, g.along, half)].flatMap(q => [ground(q), ground(q, up)])));
    });
    for (const [id, w] of wrenches) { const r = w.el.querySelector(".plate")!.getBoundingClientRect(); boxes.push({ kind: "wrench", id, of: [id], l: r.left, r: r.right, t: r.top, b: r.bottom }); }
    const titleOf = (id: string) => byId.get(id)?.title.replace(/^\d+ · /, "") ?? id;
    const gap = (a: Box, b: Box) => Math.hypot(Math.max(0, a.l - b.r, b.l - a.r), Math.max(0, a.t - b.b, b.t - a.b));
    const measureOf = (list: Box[]) => {
      const overlaps: Record<string, number> = {}, pairs: string[] = [];
      let nearest = Infinity, near = 0;
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!, b = list[j]!, d = gap(a, b), key = [a.kind, b.kind].sort().join("+");
        if (d === 0) { overlaps[key] = (overlaps[key] ?? 0) + 1; pairs.push(`${a.kind}:${titleOf(a.id)} + ${b.kind}:${titleOf(b.id)}`); } else { nearest = Math.min(nearest, d); if (d < 4) near++; }
      }
      // A gate drawn over its own territory's name or symbol is counted too: they are what crowd.
      return { marks: list.length, overlaps: Object.values(overlaps).reduce((x, y) => x + y, 0), byKind: overlaps, pairs, nearestApart: +nearest.toFixed(1), within4px: near };
    };
    const inKnot = new Set(knot.map(t => data.capabilities.find(c => c.title === t)?.id).filter(Boolean));
    return { island: measureOf(boxes), knot: measureOf(boxes.filter(b => b.of.some(t => inKnot.has(t)))) };
  };
  const insideWays = ways.filter(w => links.get(w.key)?.dir === "inside");
  const stats = {
    links: links.size, inside: internal.length, ways: ways.length, gates: gates.length, entranceGates: entranceGate.size,
    passGates: gates.filter(g => !g.entranceOf).length, sharedOpenings: gates.filter(g => g.links.length > 1).length,
    insideBorders: insideWays.map(w => w.crossings.filter(c => !c.coast).length),
    overThird: insideWays.filter(w => w.crossings.filter(c => !c.coast).length > 1).map(w => `${links.get(w.key)!.fromTitle} -> ${links.get(w.key)!.toTitle}: ${w.crossings.length} borders`),
    unplaced, landings: layout.landings.length, segments: segments.length, junctions: net.junctions.length,
    roadDrawn: Math.round(segments.reduce((sum, r) => sum + r.pts.reduce((s, p, i) => i ? s + dist(r.pts[i - 1]!, p) : 0, 0), 0)),
    waysPerSegment: { mean: +(segments.reduce((s, x) => s + x.links.length, 0) / segments.length).toFixed(2), most: Math.max(...segments.map(x => x.links.length)) },
    shared: segments.filter(s => s.links.length > 1).map(s => ({ id: s.id, links: s.links.length })).sort((a, b) => b.links - a.links).slice(0, 8),
    towns: [...towns.keys()].map(id => ({ capability: byId.get(id)?.title, roads: degree.get(id) ?? 0 })),
    gatesOnOpenLand: gates.filter(g => g.open).length, sea: sea.stats, relief: reliefStats, road: ROAD_KEY, icons: ICONS, kinds: Object.fromEntries(kinds),
    noEntrance: ways.filter(w => !entranceGate.has(w.key)).map(w => w.key),
    wrenches: [...wrenches].map(([id, w]) => ({ capability: byId.get(id)?.title, via: w.via })),
    sharedEntrances: sharedGates.map(g => g.entrances.length),
    /** Round 13's note 3: road on a territory's land within 3 units of the coast, outside the mouth. */
    roadOnEdge: Math.round(segments.reduce((sum, r) => { let l = 0; for (let i = 0; i + 1 < r.pts.length; i++) { const a = r.pts[i]!, b = r.pts[i + 1]!, m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, t = territoryAt(m); if (t && t !== "open" && toCoast(m) < 3 && dist(m, layout.harbour.dock) > layout.open.mouth) l += dist(a, b); } return sum + l; }, 0)), net: net.cost, crowding: crowding(),
  };
  return {
    pick, find, highlight, point, links, fills, stats, roads: new Map([...segments.map(s => [String(s.id), s.links] as [string, string[]]), ...sharedGates.map((g, i) => [`gate:${i}`, g.entrances] as [string, string[]])]),
    wrenches: new Map([...wrenches].map(([id, w]) => [id, { at: w.via }])),
    keep: () => { if (SEA === "map") cutLanes(); else sea.keep(); cutBorders(); raiseLand(); }, crowding,
    dispose() { cancelAnimationFrame(frame); overlay.remove(); root.remove(group); },
  };
}
