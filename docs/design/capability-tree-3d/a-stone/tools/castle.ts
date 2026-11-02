/** Round 4's layer on the real island, laid in the island's own plate so it turns and tilts with it. The map's island, its
 * territories (their shape, size, colour and thin white borders), its coast, glass and camera all stay as the map draws them;
 * the plan (town.ts) adds, in the claim flags' 2.5D inked manner (packages/forest/src/view/claim-flag.ts):
 * - a walled town inside each territory, inset by the same distance everywhere: an upright, flat-drawn cut-out with a pale
 *   band, crenellations and a thin ink outline, a small tower where the wall turns, unlit and untextured;
 * - no wall on a small territory, only its gate marks on open ground;
 * - one gate per link, in the called capability's wall: an opening between two small towers;
 * - the roads, dashed, along the borders between the towns and from the docks where other islands' roads land;
 * - a wrench, a flat ink icon standing upright and constant on screen as a flag does, at the gate its work changes;
 * - each capability's name at its town's middle. */
import { BoxGeometry, BufferGeometry, CanvasTexture, Color, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Matrix4, Mesh,
  MeshBasicMaterial, Object3D, Raycaster, RepeatWrapping, SRGBColorSpace, Vector2, Vector3, type Camera } from "three";
import type { RootState } from "@react-three/fiber";
import type { TerritoryMap } from "../../../../../packages/forest/src/territories/territories.js";
import { SAMPLE } from "./panel.js";
import { along, townPlan, type LinkEnd, type P } from "./town.js";

export type Picked =
  | { kind: "territory"; id: string }
  | { kind: "link"; id: string }
  | { kind: "road"; id: string; links: string[] }
  | { kind: "gate"; id: string }
  | { kind: "wrench"; id: string; capability: string; sample: boolean };
/** One link, as the panel tells it. */
export type LinkInfo = { key: string; from: string; to: string; fromTitle: string; toTitle: string; fromStory: string; toStory: string; gate?: string; dock?: number };
export type GateInfo = { key: string; town: string; links: string[]; walled: boolean };
export type Layer = {
  pick(x: number, y: number): Picked | undefined;
  find(kind: string, id: string): Picked | undefined;
  showSample(on: boolean): void;
  highlight(picked: Picked | undefined): void;
  /** Where a mark is on the page, in CSS pixels, for a capture to click. */
  point(kind: string, id: string): { x: number; y: number } | undefined;
  links: Map<string, LinkInfo>; gates: Map<string, GateInfo>; docks: { label: string; links: string[] }[];
  /** Every drawn road (a run of stretches carrying the same links), by id. */
  roads: { id: string; links: string[] }[];
  /** Each health the territories are filled with, and the map's colour for it. */
  fills: { word: string; colour: string }[];
  /** What was laid, counted: `mock.layer.stats` in the console. */
  stats: Record<string, unknown>;
  /** The island's box on the page, in CSS pixels: the rest view is framed on it. */
  extent(): { left: number; right: number; top: number; bottom: number };
  keepHidden(): void;
  dispose(): void;
};
type Capability = { id: string; title: string; lines: number; word: string; parked: boolean; dependsOn: { id: string; title: string; story: string; storyId: string }[] };
type Data = { story: { id: string; title: string }; capabilities: Capability[]; openWork: { capabilities: string[] }[]; map: { tree: { stories: { id: string; title: string; capabilities: { id: string; title: string }[] }[] } } };

/** The ink map's palette (README.md lists it). */
export const PALETTE = {
  ink: "#1b1814", wall: "#ece4d0", path: "#6e5236", lit: "#ffd34d",
  wrench: "#1b1814", wrenchEdge: "#ece4d0", wrenchSample: "#d6bdf0", shadow: "#080b0e",
} as const;
/** How far each town's wall stands in from its territory's edge, in the island's ground units (README: round 4). */
export const INSET = Number(new URLSearchParams(location.search).get("inset") ?? 5);
/** A territory whose deepest point is nearer its edge than this gets no wall, only its gate marks. */
export const WALL_CUT = Number(new URLSearchParams(location.search).get("cut") ?? 8.5);

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
const nameOf = (title: string) => title.replace(/^\d+ · /, "");

/** Triangles and an outline for a flat cut-out standing upright on the ground from `a` to `b`: the wall's band `h` high with
 * crenellations `m` higher, `merlon` wide, in the vertical plane through a and b. */
function cutOut(a: P, b: P, h: number, m: number, merlon: number, y: (p: P) => number) {
  const l = dist(a, b), tris: number[] = [], lines: number[] = [];
  const at = (u: number, up: number) => { const p = along(a, b, u / l); return [p.x, y(p) + up, p.z]; };
  const quad = (u0: number, u1: number, v0: number, v1: number) => tris.push(...at(u0, v0), ...at(u1, v0), ...at(u1, v1), ...at(u0, v0), ...at(u1, v1), ...at(u0, v1));
  const line = (u0: number, v0: number, u1: number, v1: number) => lines.push(...at(u0, v0), ...at(u1, v1));
  if (l < 1e-6) return { tris, lines };
  quad(0, l, 0, h);
  // A short run is a plain band: crenellations on it would be a few broken ticks.
  if (l < merlon * 4) {
    line(0, 0, l, 0); line(0, 0, 0, h); line(0, h, l, h); line(l, h, l, 0);
    return { tris, lines };
  }
  const count = Math.max(2, Math.round((l / merlon + 1) / 2)), step = (l - merlon) / (count - 1);
  let u = 0;
  line(0, 0, l, 0); line(0, 0, 0, h + m);
  for (let k = 0; k < count; k++) {
    const u0 = k * step, u1 = Math.min(l, u0 + merlon);
    quad(u0, u1, h, h + m);
    if (k > 0) { line(u, h, u0, h); line(u0, h, u0, h + m); }
    line(u0, h + m, u1, h + m);
    if (k < count - 1) line(u1, h + m, u1, h);
    u = u1;
  }
  line(l, 0, l, h + m);
  return { tris, lines };
}

/** A dash drawn once, repeated along every road. */
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

/** A polyline with its corners rounded by `r`, so a road turns as a drawn line does. */
function rounded(points: P[], r: number): P[] {
  const pts = points.filter((p, i) => i === 0 || dist(p, points[i - 1]!) > 1e-6);
  if (pts.length < 3) return pts;
  const out: P[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!, b = pts[i]!, c = pts[i + 1]!, la = dist(a, b), lc = dist(b, c);
    const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    if (Math.abs(cross) < 1e-3 * la * lc) { out.push(b); continue; }
    const k = Math.min(r, la / 2, lc / 2), p = along(b, a, k / la), q = along(b, c, k / lc);
    for (let t = 0; t <= 1.001; t += 0.25) { const u = along(p, b, t), w = along(b, q, t); out.push(along(u, w, t)); }
  }
  out.push(pts.at(-1)!);
  return out;
}

/** The wrench: a flat ink icon, an open-ended spanner standing upright, in the claim flag's manner. */
function wrenchSvg(fill: string): string {
  return `<svg viewBox="-10 -36 20 38" width="18" height="34" aria-hidden="true">
    <ellipse cx="0" cy="0.5" rx="5.5" ry="2" fill="${PALETTE.shadow}" fill-opacity="0.55"/>
    <path d="${WRENCH}" fill="${fill}" stroke="${fill === PALETTE.wrench ? PALETTE.wrenchEdge : PALETTE.ink}" stroke-width="1.3" stroke-linejoin="round"/>
  </svg>`;
}
/** The spanner's outline: a straight handle up to a round head with an open jaw at its top. */
export const WRENCH = "M -2 0 L -2 -17.25 A 8 8 0 0 1 -3 -32.42 L -3 -26 A 3 3 0 0 0 3 -26 L 3 -32.42 A 8 8 0 0 1 2 -17.25 L 2 0 Z";

export function castleLayer(state: RootState, story: string, data: Data, host: HTMLElement, map: TerritoryMap, coast: readonly (readonly P[])[]): Layer {
  const plate = state.scene.getObjectByName(`planet:${story}`)!;
  const land = plate.getObjectByName("territory-land")!, root = land.parent!;
  root.updateMatrixWorld(true);
  const own = new Set(data.capabilities.map(({ id }) => id));
  const byId = new Map(data.capabilities.map(c => [c.id, c]));
  const elsewhere = new Map(data.map.tree.stories.flatMap(s => s.capabilities.map(c => [c.id, { title: c.title, story: s.title }] as const)));
  // The map's file dots and claim flags on this island stay out of sight; its territories and borders stay as drawn.
  const hideMap = () => {
    land.traverse(mark => {
      if (mark === land || !/^(file|claim)/.test(mark.name) || Object.getOwnPropertyDescriptor(mark, "visible")?.get) return;
      Object.defineProperty(mark, "visible", { get: () => false, set: () => {}, configurable: true });
    });
    state.invalidate();
  };
  hideMap();
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
  const heightAt = (p: P) => base + slope * (p.x * p.x + p.z * p.z);

  // The docks: where each lit lane from another island comes ashore (the map's own lanes, read before they are hidden).
  const inverse = new Matrix4().copy(root.matrixWorld).invert();
  const lanes: { from: string; to: string; dir: string; dock: P }[] = [];
  state.scene.getObjectByName("pathways:selection-lanes")?.traverse(o => {
    if (!o.name.startsWith("lane:")) return;
    const mesh = o as Mesh, at = mesh.geometry.getAttribute("position"), v = new Vector3();
    mesh.updateMatrixWorld(true);
    const local = (i: number) => v.set(at.getX(i), at.getY(i), at.getZ(i)).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse).clone();
    const up = o.userData.dir === "up", count = at.count;
    // From the end on the island, the last point still on land before the lane drops to the sea.
    let dock: Vector3 | undefined;
    for (let k = 0; k < count; k++) {
      const i = up ? count - 1 - k : k, p = local(i);
      if (p.y < heightAt(p) - 2) break;
      dock = p;
    }
    if (dock) lanes.push({ from: o.userData.from, to: o.userData.to, dir: o.userData.dir, dock: { x: dock.x, z: dock.z } });
  });
  const dockAt: P[] = [];
  const dockOf = (p: P) => { let i = dockAt.findIndex(d => dist(d, p) < INSET * 1.5); if (i < 0) { i = dockAt.length; dockAt.push(p); } return i; };

  // Every link with an end on this island: inside it, and to or from another island by a dock.
  const asked: { key: string; from: LinkEnd; to: LinkEnd; gateGroup?: string }[] = [];
  const links = new Map<string, LinkInfo>();
  const town = (id: string): LinkEnd => ({ kind: "town", id });
  for (const c of data.capabilities) for (const d of c.dependsOn) if (own.has(d.id)) {
    const key = `${c.id}->${d.id}`;
    asked.push({ key, from: town(c.id), to: town(d.id) });
    links.set(key, { key, from: c.id, to: d.id, fromTitle: c.title, toTitle: byId.get(d.id)!.title, fromStory: data.story.title, toStory: data.story.title });
  }
  for (const lane of lanes) {
    const key = `${lane.from}->${lane.to}`, dock = dockOf(lane.dock);
    const other = elsewhere.get(lane.dir === "up" ? lane.to : lane.from);
    if (!other || links.has(key)) continue;
    if (lane.dir === "up") asked.push({ key, from: town(lane.from), to: { kind: "dock", dock } });
    // The links one road brings from other islands into a town come in by one gate.
    else asked.push({ key, from: { kind: "dock", dock }, to: town(lane.to), gateGroup: `dock${dock}:${lane.to}` });
    const mine = byId.get(lane.dir === "up" ? lane.from : lane.to)!;
    links.set(key, lane.dir === "up"
      ? { key, from: lane.from, to: lane.to, fromTitle: mine.title, toTitle: other.title, fromStory: data.story.title, toStory: other.story, dock }
      : { key, from: lane.from, to: lane.to, fromTitle: other.title, toTitle: mine.title, fromStory: other.story, toStory: data.story.title, dock });
  }

  // Sizes, from the inset: the strip between two towns is twice it.
  const Gw = INSET * 2;
  const H = Gw * 0.17, M = H * 0.55, MERLON = H * 1.1;
  const OPEN = Gw * 0.3, TOWER = H * 1.1, TOWER_H = H * 1.35, TOP = H * 0.45, CORNER = H * 0.95;
  const PATH = Gw * 0.05, DASH = Gw * 0.26, TURN = Gw * 0.3;
  const plan = townPlan(map, coast, { inset: INSET, wallCut: WALL_CUT, gateRoom: OPEN + TOWER * 3, corner: INSET * 3, links: asked, docks: dockAt });
  for (const l of plan.links) { const info = links.get(l.key)!; if (l.gate) info.gate = l.gate; }
  const lift = (q: P, up = 0) => new Vector3(q.x, heightAt(q) + up, q.z);
  const ground = (q: P) => heightAt(q) + H * 0.04;

  const group = new Group(); group.name = "mock-castle"; root.add(group);
  const wallFill = new MeshBasicMaterial({ color: PALETTE.wall, fog: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const solid = (tris: number[], lines: number[], fill: MeshBasicMaterial, ink: LineBasicMaterial) => {
    const geometry = new BufferGeometry(); geometry.setAttribute("position", new Float32BufferAttribute(tris, 3));
    const mesh = new Mesh(geometry, fill); mesh.renderOrder = 2; mesh.raycast = () => {};
    const outline = new BufferGeometry(); outline.setAttribute("position", new Float32BufferAttribute(lines, 3));
    const edge = new LineSegments(outline, ink); edge.renderOrder = 3; edge.raycast = () => {};
    return [mesh, edge] as const;
  };
  /** A small square tower at `t`, squared to `dir`: a cut-out on each side, a flat roof, crenellated. */
  const tower = (t: P, dir: P, size: number, height: number, tris: number[], lines: number[]) => {
    const h = size / 2, nrm = { x: -dir.z, z: dir.x };
    const sq = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([u, v]) => ({ x: t.x + dir.x * u! + nrm.x * v!, z: t.z + dir.z * u! + nrm.z * v! }));
    for (let k = 0; k < 4; k++) { const cut = cutOut(sq[k]!, sq[(k + 1) % 4]!, height, M * 0.8, size / 2.6, ground); tris.push(...cut.tris); lines.push(...cut.lines); }
    const top = sq.map(q => [q.x, ground(q) + height - H * 0.01, q.z]);
    tris.push(...top[0]!, ...top[1]!, ...top[2]!, ...top[0]!, ...top[2]!, ...top[3]!);
  };

  // The towns' walls: each run of the simplified outline, opened where a gate stands, a tower at every turn.
  const towns = new Map<string, { band: MeshBasicMaterial; walled: boolean }>();
  const gatesOn = new Map<string, typeof plan.gates extends Map<string, infer G> ? G[] : never>();
  for (const g of plan.gates.values()) gatesOn.set(g.town, [...(gatesOn.get(g.town) ?? []), g]);
  let wallLength = 0, turns = 0;
  for (const t of plan.towns.values()) {
    const band = wallFill.clone();
    towns.set(t.id, { band, walled: t.walled });
    if (!t.walled) continue;
    const tris: number[] = [], lines: number[] = [], ring = t.ring, gates = gatesOn.get(t.id) ?? [];
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length]!, l = dist(a, b);
      // The openings on this run, as distances along it.
      const cuts = gates.map(g => ({ u: (g.at.x - a.x) * (b.x - a.x) / l + (g.at.z - a.z) * (b.z - a.z) / l, off: Math.abs((b.x - a.x) * (a.z - g.at.z) - (a.x - g.at.x) * (b.z - a.z)) / l }))
        .filter(c => c.off < 1e-3 && c.u > 0 && c.u < l).map(c => c.u).sort((p, q) => p - q);
      let from = 0;
      const half = OPEN / 2 + TOWER / 2;
      for (const u of [...cuts, Infinity]) {
        const to = u === Infinity ? l : u - half;
        if (to > from + 1e-6) {
          const cut = cutOut(along(a, b, from / l), along(a, b, to / l), H, M, MERLON, ground);
          tris.push(...cut.tris); lines.push(...cut.lines);
          // The wall's walk: a pale strip along its top, so from above it reads as one band with one ink line.
          const u0 = along(a, b, from / l), u1 = along(a, b, to / l), d = { x: (b.x - a.x) / l * TOP / 2, z: (b.z - a.z) / l * TOP / 2 }, n2 = { x: -d.z, z: d.x };
          const q = [{ x: u0.x + n2.x, z: u0.z + n2.z }, { x: u1.x + n2.x, z: u1.z + n2.z }, { x: u1.x - n2.x, z: u1.z - n2.z }, { x: u0.x - n2.x, z: u0.z - n2.z }].map(r => [r.x, ground(r) + H, r.z]);
          tris.push(...q[0]!, ...q[1]!, ...q[2]!, ...q[0]!, ...q[2]!, ...q[3]!);
          wallLength += to - from;
        }
        from = u + half;
      }
      // The tower where the wall turns, squared to the run that leaves it.
      tower(a, { x: (b.x - a.x) / l, z: (b.z - a.z) / l }, CORNER, H * 1.25, tris, lines);
      turns++;
    });
    const ink = new LineBasicMaterial({ color: PALETTE.ink });
    const walls = new Group(); walls.name = `walls:${t.id}`; walls.add(...solid(tris, lines, band, ink)); group.add(walls);
  }

  // Gates: a small square tower each side of the opening (on open ground, two gateposts), drawn the same way.
  const gateGroups = new Map<string, Group>();
  for (const g of plan.gates.values()) {
    const walled = plan.towns.get(g.town)!.walled;
    const tris: number[] = [], lines: number[] = [], half = OPEN / 2 + TOWER / 2;
    const size = walled ? TOWER : TOWER * 0.8, height = walled ? TOWER_H : TOWER_H * 0.85;
    for (const s of [-1, 1]) tower({ x: g.at.x + g.along.x * half * s, z: g.at.z + g.along.z * half * s }, g.along, size, height, tris, lines);
    const fill = wallFill.clone(), ink = new LineBasicMaterial({ color: PALETTE.ink });
    const gg = new Group(); gg.name = `gate:${g.key}`;
    gg.add(...solid(tris, lines, fill, ink));
    // A box over the gate, unseen, so a click on it is easy to land.
    const top = TOWER_H + M, hit = new Mesh(new BoxGeometry(OPEN + TOWER * 2.4, top, TOWER * 2.4), new MeshBasicMaterial({ visible: false, side: DoubleSide }));
    hit.position.copy(lift(g.at, top / 2)); hit.rotation.y = -Math.atan2(g.along.z, g.along.x);
    gg.add(hit);
    gg.userData = { fill, at: g.at };
    gateGroups.set(g.key, gg); group.add(gg);
  }

  // Roads: every stretch the links walk, drawn once; a stretch is a line of the graph or a spur into a town.
  type Stretch = { pts: P[]; ends: [string, string]; carried: string[] };
  const stretches = new Map<string, Stretch>();
  const nodeKey = (i: number) => `n${i}`, pointKey = (p: P) => `p${Math.round(p.x * 1000)},${Math.round(p.z * 1000)}`;
  const carry = (id: string, pts: P[], ends: [string, string], link: string) => {
    const s = stretches.get(id) ?? { pts, ends, carried: [] };
    if (!s.carried.includes(link)) s.carried.push(link);
    stretches.set(id, s);
  };
  const routeOf = new Map<string, P[]>();
  for (const l of plan.links) {
    for (const i of l.edges) { const e = plan.edges[i]!; carry(`e${i}`, [plan.nodes[e.a]!, plan.nodes[e.b]!], [nodeKey(e.a), nodeKey(e.b)], l.key); }
    if (l.startSpur) carry(`s${pointKey(l.startSpur[0])}>${l.nodes[0]}`, l.startSpur, [pointKey(l.startSpur[0]), nodeKey(l.nodes[0]!)], l.key);
    // A road ends in the gate's opening.
    if (l.endSpur) carry(`s${pointKey(l.endSpur[1])}<${l.nodes.at(-1)}`, l.endSpur, [nodeKey(l.nodes.at(-1)!), pointKey(l.endSpur[1])], l.key);
    routeOf.set(l.key, [...(l.startSpur ? [l.startSpur[0]] : []), ...l.nodes.map(i => plan.nodes[i]!), ...(l.endSpur ? [l.endSpur[1]] : [])]);
  }
  // Chained through the corners where only two stretches with the same load meet, so the dashes run on.
  const degree = new Map<string, number>();
  for (const s of stretches.values()) for (const e of s.ends) degree.set(e, (degree.get(e) ?? 0) + 1);
  const chains: { pts: P[]; carried: string[] }[] = [], seen = new Set<string>();
  const load = (s: Stretch) => [...s.carried].sort().join();
  for (const [id, s] of stretches) {
    if (seen.has(id)) continue;
    seen.add(id);
    let pts = [...s.pts], ends: [string, string] = [...s.ends];
    for (const side of [1, 0]) for (;;) {
      const at = ends[side]!;
      if (degree.get(at) !== 2) break;
      const next = [...stretches].find(([k, o]) => !seen.has(k) && o.ends.includes(at) && load(o) === load(s));
      if (!next) break;
      seen.add(next[0]);
      const o = next[1], fwd = o.ends[0] === at, more = fwd ? o.pts : [...o.pts].reverse(), other = fwd ? o.ends[1] : o.ends[0];
      if (side) { pts = [...pts, ...more.slice(1)]; ends = [ends[0], other]; } else { pts = [...[...more].reverse().slice(0, -1), ...pts]; ends = [other, ends[1]]; }
    }
    chains.push({ pts, carried: s.carried });
  }
  const dashMaterial = new MeshBasicMaterial({ map: dashTexture(), transparent: true, side: DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const roadHits: Mesh[] = [];
  chains.forEach((chain, k) => {
    const pts = rounded(chain.pts, TURN);
    const mesh = new Mesh(ribbon(pts, PATH, ground, DASH), dashMaterial); mesh.renderOrder = 4; mesh.raycast = () => {};
    const hit = new Mesh(ribbon(pts, Gw * 0.4, ground, DASH), new MeshBasicMaterial({ visible: false, side: DoubleSide }));
    hit.name = `road:${k}`; hit.userData = { links: chain.carried, pts };
    group.add(mesh, hit); roadHits.push(hit);
  });

  // The page's own marks over the canvas, constant on screen as the map's names and flags are.
  const overlay = document.createElement("div");
  overlay.className = "mock-overlay";
  host.appendChild(overlay);
  type Spot = { el: HTMLElement; at: Vector3; name?: boolean; x?: number; y?: number };
  const spots: Spot[] = [];
  const names = new Map<string, Spot>();
  for (const t of plan.towns.values()) {
    const el = document.createElement("div");
    el.dataset.capability = t.id;
    el.className = "forest-label planet-nameplate capability mock-name";
    el.textContent = nameOf(byId.get(t.id)?.title ?? t.id);
    overlay.appendChild(el);
    const spot: Spot = { el, at: lift(t.deep), name: true };
    spots.push(spot); names.set(t.id, spot);
  }
  // A wrench stands just inside the gate its work changes (the town's busiest), or in the town's middle when it has none.
  const wrenches = new Map<string, Spot & { sample: boolean }>();
  const named = new Set(data.openWork.flatMap(w => w.capabilities));
  const sampleCapability = data.capabilities.find(c => c.title === SAMPLE.capability)?.id;
  const wrenchAt = (capability: string): P => {
    const g = [...(gatesOn.get(capability) ?? [])].sort((a, b) => b.links.length - a.links.length)[0], t = plan.towns.get(capability)!;
    if (!g) return t.deep;
    const inward = { x: -g.out.x, z: -g.out.z }, step = t.walled ? INSET * 0.75 : INSET * 0.4;
    return { x: g.at.x + inward.x * step + g.along.x * OPEN, z: g.at.z + inward.z * step + g.along.z * OPEN };
  };
  const makeWrench = (capability: string, sample: boolean) => {
    const el = document.createElement("div");
    el.className = `mock-wrench${sample ? " mock-wrench-sample" : ""}`;
    el.innerHTML = wrenchSvg(sample ? PALETTE.wrenchSample : PALETTE.wrench) + (sample ? `<span class="mock-wrench-tag">sample</span>` : "");
    overlay.appendChild(el);
    const spot = { el, at: lift(wrenchAt(capability), H * 0.1), sample };
    spots.push(spot);
    return spot;
  };
  for (const capability of named) if (plan.towns.has(capability)) wrenches.set(capability, makeWrench(capability, false));
  const sampleWrench = sampleCapability === undefined ? undefined : makeWrench(sampleCapability, true);
  if (sampleWrench) sampleWrench.el.hidden = true;
  // Each dock: a dot where the other islands' roads come ashore, and its name.
  const dockInfo = plan.docks.map((d, k) => {
    const carried = [...links.values()].filter(l => l.dock === k).map(l => l.key);
    const stories = new Set([...links.values()].filter(l => l.dock === k).map(l => l.fromStory === data.story.title ? l.toStory : l.fromStory));
    const label = stories.size === 1 ? `road to ${[...stories][0]}` : `roads from ${stories.size} islands`;
    return { at: d.at, label, links: carried };
  });
  dockInfo.forEach(d => {
    if (!d.links.length) return;
    const dot = document.createElement("div"); dot.className = "mock-road-end"; overlay.appendChild(dot);
    spots.push({ el: dot, at: lift(d.at, H * 0.05) });
    const el = document.createElement("div"); el.className = "forest-label planet-nameplate capability mock-road-name"; el.textContent = d.label; overlay.appendChild(el);
    spots.push({ el, at: lift(d.at, H * 0.05), name: true });
  });
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
    for (const w of [...wrenches.values(), ...(sampleWrench && !sampleWrench.el.hidden ? [sampleWrench] : [])]) boxes.push({ l: w.x! - 9, r: w.x! + 9, t: w.y! - 32, b: w.y! + 3 });
    for (const spot of spots.filter(sp => sp.name).sort((a, b) => a.y! - b.y!)) {
      const w = spot.el.offsetWidth, h = spot.el.offsetHeight;
      const box = { l: spot.x! - w / 2, r: spot.x! + w / 2, t: spot.y! - h / 2, b: spot.y! + h / 2 };
      let shift = 0;
      for (let k = 0; k < 8; k++) {
        const hit = boxes.find(o => o.l < box.r - 2 && box.l + 2 < o.r && o.t < box.b + shift - 1 && box.t + shift + 1 < o.b);
        if (!hit) break;
        shift = hit.b - box.t + 1;
      }
      spot.el.style.marginTop = shift ? `${shift}px` : "";
      boxes.push({ ...box, t: box.t + shift, b: box.b + shift });
    }
    frame = requestAnimationFrame(follow);
  };
  follow();
  state.invalidate();

  // Picking: a wrench by its icon on the page, then the gates and the roads in the scene, then the territory below.
  const raycaster = new Raycaster();
  const pick = (x: number, y: number): Picked | undefined => {
    for (const [capability, w] of [...wrenches, ...(sampleWrench && !sampleWrench.el.hidden ? [[sampleCapability!, sampleWrench] as const] : [])]) {
      const box = w.el.querySelector("svg")!.getBoundingClientRect();
      if (x >= box.left - 4 && x <= box.right + 4 && y >= box.top - 4 && y <= box.bottom + 4) return { kind: "wrench", id: capability, capability, sample: w.sample };
    }
    const rect = state.gl.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new Vector2((x - rect.left) / rect.width * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1), state.camera as Camera);
    const gate = raycaster.intersectObjects([...gateGroups.values()], true)[0];
    if (gate) { for (let o: Object3D | null = gate.object; o; o = o.parent) if (o.name.startsWith("gate:")) return { kind: "gate", id: o.name.slice(5) }; }
    const roads = raycaster.intersectObjects(roadHits, false);
    if (roads.length) {
      // Where two roads' click strips overlap, the road whose line runs nearest the point clicked.
      const near = (m: (typeof roads)[number]) => {
        const pts = m.object.userData.pts as P[], q = m.point.clone().applyMatrix4(inverse);
        let best = Infinity;
        for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i]!, b = pts[i + 1]!, dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.z - a.z) * dz) / l)); best = Math.min(best, Math.hypot(q.x - a.x - t * dx, q.z - a.z - t * dz)); }
        return best;
      };
      const hit = [...roads].sort((a, b) => near(a) - near(b))[0]!.object;
      const carried = hit.userData.links as string[];
      return carried.length === 1 ? { kind: "link", id: carried[0]! } : { kind: "road", id: hit.name.slice(5), links: carried };
    }
    const under = raycaster.intersectObjects([...fillOf.values()].map(f => f.mesh), false)[0];
    const id = under?.object.name.slice("territory:".length);
    return id && own.has(id) ? { kind: "territory", id } : undefined;
  };
  const find = (kind: string, id: string): Picked | undefined => {
    if (kind === "territory") return own.has(id) ? { kind, id } : undefined;
    if (kind === "wrench") return id === sampleCapability && !wrenches.has(id) ? { kind, id, capability: id, sample: true } : wrenches.has(id) ? { kind, id, capability: id, sample: false } : undefined;
    if (kind === "gate") return gateGroups.has(id) ? { kind, id } : undefined;
    if (kind === "link") return routeOf.has(id) ? { kind, id } : undefined;
    if (kind === "road") { const hit = roadHits.find(h => h.name === `road:${id}`); return hit ? { kind, id, links: hit.userData.links } : undefined; }
    return undefined;
  };

  // The pick lights in the selection's gold: a town's wall band, a gate's towers, and every road it names drawn over in gold.
  // One solid gold line, wide enough to cover the brown dashes under it: gold over dashes out of step read as orange.
  const litMaterial = new MeshBasicMaterial({ color: PALETTE.lit, transparent: true, fog: false, side: DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  const lit: Mesh[] = [];
  const highlight = (picked: Picked | undefined) => {
    for (const t of towns.values()) t.band.color.set(PALETTE.wall);
    for (const g of gateGroups.values()) (g.userData.fill as MeshBasicMaterial).color.set(PALETTE.wall);
    for (const w of [...wrenches.values(), ...(sampleWrench ? [sampleWrench] : [])]) w.el.classList.remove("lit");
    for (const m of lit.splice(0)) { group.remove(m); m.geometry.dispose(); }
    if (picked?.kind === "territory") towns.get(picked.id)?.band.color.set(PALETTE.lit);
    if (picked?.kind === "wrench") (picked.sample ? sampleWrench : wrenches.get(picked.capability))?.el.classList.add("lit");
    const keys = picked?.kind === "link" ? [picked.id] : picked?.kind === "road" ? picked.links : picked?.kind === "gate" ? plan.gates.get(picked.id)!.links : [];
    if (picked?.kind === "gate") (gateGroups.get(picked.id)!.userData.fill as MeshBasicMaterial).color.set(PALETTE.lit);
    if (picked?.kind === "link") { const g = links.get(picked.id)?.gate; if (g) (gateGroups.get(g)!.userData.fill as MeshBasicMaterial).color.set(PALETTE.lit); }
    for (const k of keys) {
      const pts = routeOf.get(k);
      if (!pts) continue;
      const m = new Mesh(ribbon(rounded(pts, TURN), PATH * 2.4, q => ground(q) + H * 0.01, DASH), litMaterial); m.renderOrder = 5; group.add(m); lit.push(m);
    }
    state.invalidate();
  };

  const point = (kind: string, id: string) => {
    if (kind === "wrench") { const w = id.endsWith(":sample") ? sampleWrench : wrenches.get(id); if (!w) return undefined; const b = w.el.querySelector("svg")!.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height * 0.35 }; }
    if (kind === "gate") { const g = gateGroups.get(id); return g ? project(lift(g.userData.at as P, TOWER_H / 2)).page : undefined; }
    if (kind === "territory") { const t = plan.towns.get(id); return t ? project(lift(along(t.deep, t.ring[0]!, 0.5))).page : undefined; }
    // A link, or a road: the middle of the stretch that carries it with the fewest others.
    const hits = kind === "link" ? roadHits.filter(h => (h.userData.links as string[]).includes(id)).sort((a, b) => a.userData.links.length - b.userData.links.length)
      : roadHits.filter(h => h.name === `road:${id}`);
    const pts = hits[0]?.userData.pts as P[] | undefined;
    if (!pts) return undefined;
    let total = 0; for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1]!, pts[i]!);
    let walked = 0;
    for (let i = 1; i < pts.length; i++) { const l = dist(pts[i - 1]!, pts[i]!); if (walked + l >= total / 2) return project(lift(along(pts[i - 1]!, pts[i]!, (total / 2 - walked) / (l || 1)))).page; walked += l; }
    return undefined;
  };

  const fills = [...new Map(data.capabilities.map(c => {
    const word = c.parked ? "parked" : c.word, shape = fillOf.get(c.id);
    return [word, { word, colour: shape ? `#${new Color(shape.colour).getHexString()}` : "#97c459" }] as const;
  })).values()];
  const gates = new Map([...plan.gates].map(([k, g]) => [k, { key: k, town: g.town, links: g.links, walled: plan.towns.get(g.town)!.walled }]));
  const stats = {
    inset: INSET, wallCut: WALL_CUT, towns: plan.towns.size, walled: [...plan.towns.values()].filter(t => t.walled).length,
    unwalled: [...plan.towns.values()].filter(t => !t.walled).map(t => `${byId.get(t.id)?.title} (${byId.get(t.id)?.lines} lines, ${t.depth.toFixed(1)} deep)`),
    depths: Object.fromEntries([...plan.towns.values()].map(t => [byId.get(t.id)?.title, Math.round(t.depth * 10) / 10])),
    turns, wallLength: Math.round(wallLength), gates: plan.gates.size, links: links.size, routed: plan.links.length,
    unrouted: Object.entries(asked.filter(a => !plan.links.some(l => l.key === a.key)).reduce((m, a) => { const k = a.to.kind === 'town' ? byId.get(a.to.id)?.title ?? '' : 'dock'; m[k] = (m[k] ?? 0) + 1; return m; }, {} as Record<string, number>)),
    inside: asked.filter(a => a.from.kind === "town" && a.to.kind === "town").length, docks: dockInfo.map(d => ({ label: d.label, links: d.links.length })),
    stretches: stretches.size, sharedStretches: [...stretches.values()].filter(s => s.carried.length > 1).length, chains: chains.length,
    wrenches: wrenches.size, borders: map.borders.length,
  };

  return {
    pick, find, highlight, point, fills, stats, keepHidden: hideMap, links, gates, docks: dockInfo.map(d => ({ label: d.label, links: d.links })),
    roads: roadHits.map(h => ({ id: h.name.slice(5), links: h.userData.links as string[] })),
    extent() {
      state.camera.updateMatrixWorld(); root.updateMatrixWorld(true);
      const pts = coast.flat().map(q => project(lift(q)).page);
      return { left: Math.min(...pts.map(c => c.x)), right: Math.max(...pts.map(c => c.x)), top: Math.min(...pts.map(c => c.y)) - 10, bottom: Math.max(...pts.map(c => c.y)) + 10 };
    },
    showSample(on) { if (sampleWrench) sampleWrench.el.hidden = !on; },
    dispose() { cancelAnimationFrame(frame); overlay.remove(); root.remove(group); },
  };
}
