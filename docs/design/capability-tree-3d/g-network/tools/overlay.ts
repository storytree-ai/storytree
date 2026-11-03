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
import { BufferGeometry, CircleGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial,
  Raycaster, Vector2, Vector3, type Camera, type BufferAttribute, type LineSegments } from "three";
import type { RootState } from "@react-three/fiber";
import type { TerritoryMap } from "../../../../../packages/forest/src/territories/territories.js";
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

/** Sizes in ground units (about 2.6 pixels each at rest). */
const SIZE = { line: 0.75, casing: 0.42, lift: 0.35, trunk: 1.0, clear: 1.5, apart: 3.2,
  /** A settlement: its disc's radius, by how many roads meet there (1-2, 3-5, 6 or more), its ink ring, and its dot. */
  town: [1.05, 1.4, 1.75], townRing: 0.36, townDot: 0.42,
  /** A gate: the opening cut in the border, and a post each side of it (an ink square with a paper face). */
  opening: 3.0, post: 1.45, face: 0.9, entrancePost: 1.8, entranceFace: 1.15, entranceApart: 3.8, road: 6.5,
  /** A road's width by the links it carries: 1, 2-3, 4-7, 8 or more. */
  width: [0.7, 0.95, 1.25, 1.6] };

type Capability = { id: string; title: string; dependsOn: { id: string; title: string; story: string; storyId: string }[] };
type Data = { story: { id: string; title: string }; capabilities: Capability[]; openWork: { capabilities: string[] }[]; map: { tree: { stories: { id: string; title: string; capabilities: { id: string; title: string }[] }[] } } };
type Layout = { harbour: { dock: P; sea: P }; keys: { dock: P; sea: P }; open: { band: number; mouth: number }; landings: { capability: string; at: P; links: number }[] };
export type Gate = { at: P; along: P; links: string[]; entranceOf?: string; coast: boolean; open?: boolean };
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
/** A flat ribbon `width` wide along `points`. */
function ribbon(points: P[], width: number, y: (p: P) => number): BufferGeometry {
  const positions: number[] = [], index: number[] = [];
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)]!, b = points[Math.min(points.length - 1, i + 1)]!;
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l * width / 2, nz = dx / l * width / 2;
    positions.push(p.x + nx, y(p), p.z + nz, p.x - nx, y(p), p.z - nz);
    if (i > 0) { const k = 2 * i; index.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
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
  const underName = (p: P, pad: number) => { const q = project(lift(p)).page; return nameBoxes.some(b => q.x > b.l - pad && q.x < b.r + pad && q.y > b.t - pad && q.y < b.b + pad); };

  // ── The sea: the selection's lanes stop at the coast, where the roads ashore take over ─────────────────────────────
  const inverse = new Matrix4().copy(root.matrixWorld).invert();
  const nearCoast = (p: P) => onLand(p);
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
  cutLanes();

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
  const spot = (territory: string, toward: P): P => {
    const nm = anchorOf(territory), want = sub(toward, nm);
    let best: P | undefined, score = Infinity;
    for (let a = 0; a < 360; a += 6) {
      const u = { x: Math.cos(a * Math.PI / 180), z: Math.sin(a * Math.PI / 180) };
      let r = 1.5;
      while (r < 30 && underName({ x: nm.x + u.x * r, z: nm.z + u.z * r }, 6)) r += 0.5;
      for (const extra of [0.8, 1.8, 3, 4.5]) {
        const p = { x: nm.x + u.x * (r + extra), z: nm.z + u.z * (r + extra) };
        if (territoryAt(p) !== territory || clearance(p) < SIZE.clear + 0.8 || underName(p, 7)) continue;
        const s = angleBetween(u, want) * 6 + dist(p, nm) * 0.35;
        if (s < score) { score = s; best = p; }
        break;
      }
    }
    return best ?? nm;
  };
  const internal = [...links.values()].filter(l => l.dir === "inside");
  const landingOf = new Map(layout.landings.map(l => [l.capability, l]));
  /** Each territory's settlement, toward the middle of what its roads reach: its partners' names and its landing. */
  const towns = new Map<string, P>();
  for (const id of own) {
    const toward = [...internal.filter(l => l.from === id).map(l => anchorOf(l.to)), ...internal.filter(l => l.to === id).map(l => anchorOf(l.from)), ...(landingOf.has(id) ? [landingOf.get(id)!.at] : [])];
    if (!toward.length) continue;
    towns.set(id, spot(id, { x: toward.reduce((s, p) => s + p.x, 0) / toward.length, z: toward.reduce((s, p) => s + p.z, 0) / toward.length }));
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
  for (const s of segments) for (const c of crossingsOf(s.pts)) gates.push({ at: c.p, along: c.along, links: [...s.links], coast: false, open: c.pair?.includes("open") ?? false });
  // Each link's own entrance: the gate where its way last enters the territory it calls (the way out: where it leaves).
  for (const w of ways) {
    const entering = w.to === "sea" ? w.crossings.find(c => c.pair?.includes(w.from)) : [...w.crossings].reverse().find(c => c.pair?.includes(w.to));
    if (!entering) continue;
    const g = gates.filter(x => !x.entranceOf).reduce<Gate | undefined>((b, x) => dist(x.at, entering.p) < (b ? dist(b.at, entering.p) : 1) ? x : b, undefined);
    if (g) g.entranceOf = w.key;
  }
  const entranceGate = new Map(gates.filter(g => g.entranceOf).map(g => [g.entranceOf!, g]));

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
    lines.userData.cutFor = lines.geometry.uuid;
    state.invalidate();
  };
  cutBorders();

  // ── Draw ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  const group = new Group(); group.name = "mock-overlay-lines"; root.add(group);
  const y = (up: number) => (p: P) => heightAt(p) + SIZE.lift + up;
  const mat = (colour: string, opacity = 1) => new MeshBasicMaterial({ color: colour, transparent: true, opacity, side: DoubleSide, depthWrite: false, depthTest: false, fog: false });
  const casingMat = mat(PALETTE.casing, 0.88);
  const add = (geometry: BufferGeometry, m: MeshBasicMaterial, order: number) => { const o = new Mesh(geometry, m); o.renderOrder = order; o.raycast = () => {}; group.add(o); return o; };
  const disc = (p: P, r: number, m: MeshBasicMaterial, order: number, up: number) => { const g = new CircleGeometry(r, 20); g.rotateX(-Math.PI / 2); const o = add(g, m, order); o.position.copy(lift(p, SIZE.lift + up)); return o; };
  const coreMats = new Map<string, MeshBasicMaterial[]>();
  const keep = (key: string, m: MeshBasicMaterial) => { m.userData.colour ??= `#${m.color.getHexString()}`; coreMats.set(key, [...(coreMats.get(key) ?? []), m]); return m; };
  /** A road's width, by how many links it carries: a quiet step at 2, 4 and 8. */
  const widthOf = (n: number) => SIZE.width[n >= 8 ? 3 : n >= 4 ? 2 : n >= 2 ? 1 : 0]!;
  const roadMat = mat(PALETTE.line), outMat = mat(PALETTE.out);
  for (const s of segments) {
    const w = widthOf(s.links.length);
    add(ribbon(s.pts, w + SIZE.casing * 2, y(0)), casingMat, 10);
    keep(`road:${s.id}`, add(ribbon(s.pts, w, y(0.02)), s.out ? outMat.clone() : roadMat.clone(), 11).material as MeshBasicMaterial);
  }
  // Junctions: a disc as wide as the widest road meeting there, so the joins read as one road.
  const ends = new Map<string, { at: P; w: number; out: boolean }>();
  for (const s of segments) for (const e of [s.pts[0]!, s.pts.at(-1)!]) {
    const k = `${e.x.toFixed(2)},${e.z.toFixed(2)}`, was = ends.get(k), w = widthOf(s.links.length);
    ends.set(k, { at: e, w: Math.max(was?.w ?? 0, w), out: (was?.out ?? true) && s.out });
  }
  for (const { at, w, out } of ends.values()) { disc(at, w / 2 + SIZE.casing, casingMat, 10, -0.01); disc(at, w / 2, out ? outMat : roadMat, 11, 0.01); }
  // A lit link: its whole way, in gold, over the shared roads it travels (hidden until it is picked).
  const litMat = mat(PALETTE.lit);
  const litWay = new Map<string, Mesh>();
  for (const w of ways) { const o = add(ribbon(w.pts, SIZE.line, y(0.05)), litMat, 13); o.visible = false; litWay.set(w.key, o); }
  // The settlements, over the roads that meet there: a paper disc ringed in ink, graded by how many roads meet.
  const inkTown = mat(PALETTE.ink), paperTown = mat(PALETTE.paper);
  for (const [id, at] of towns) {
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
  for (const g of gates) {
    const m = mat(PALETTE.paper);
    const [outer, face] = g.entranceOf ? [SIZE.entrancePost, SIZE.entranceFace] : [SIZE.post, SIZE.face];
    const opening = Math.max(SIZE.opening, widthOf(g.links.length) + 2);
    for (const side of [-1, 1]) {
      const c = { x: g.at.x + g.along.x * (opening / 2 + outer / 2) * side, z: g.at.z + g.along.z * (opening / 2 + outer / 2) * side };
      square(c, g.along, outer, inkMat, 17, 0.12);
      square(c, g.along, face, m, 18, 0.14);
    }
    if (g.entranceOf) keep(g.entranceOf, m);
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
    const [via, g] = ins[0] ?? outs[0] ?? [];
    if (!via || !g) continue;
    const el = document.createElement("div");
    el.className = "mock-wrench"; el.dataset.capability = id;
    el.innerHTML = `<svg viewBox="-13 -40 26 42" width="26" height="42" aria-hidden="true">
      <ellipse cx="0" cy="0" rx="4.5" ry="1.6" fill="#080b0e" fill-opacity="0.55"/>
      <path d="M0 0V-17" stroke="${PALETTE.ink}" stroke-width="1.6"/>
      <circle class="plate" cx="0" cy="-27" r="11" fill="${PALETTE.paper}" stroke="${PALETTE.ink}" stroke-width="1.2"/>
      <g transform="translate(0 -27) scale(0.66)"><path class="glyph" d="${WRENCH}" fill="${PALETTE.ink}"/></g>
    </svg>`;
    overlay.appendChild(el);
    const s = { el, at: lift(g.at, SIZE.lift), via };
    spots.push(s); wrenches.set(id, s);
  }
  let frame = 0;
  const follow = () => {
    for (const s of spots) { const at = project(s.at); s.el.style.transform = `translate(${at.x}px, ${at.y}px)`; s.el.style.visibility = at.front ? "" : "hidden"; }
    frame = requestAnimationFrame(follow);
  };
  follow();
  state.invalidate();

  // ── Picking: a wrench, then an entrance gate, then a settlement (its territory), then a road, then the territory below ─
  const raycaster = new Raycaster();
  const gateAt = (x: number, yy: number) => {
    let best: string | undefined, d = 10;
    for (const [key, g] of entranceGate) { const q = project(lift(g.at, SIZE.lift)).page, dd = Math.hypot(q.x - x, q.y - yy); if (dd < d) { d = dd; best = key; } }
    return best;
  };
  /** The road segment under a point on the page. */
  const lineAt = (x: number, yy: number) => {
    let best: (typeof segments)[number] | undefined, d = 6;
    for (const s of segments) {
      const pts = s.pts.map(p => project(lift(p, SIZE.lift)).page);
      for (let i = 0; i + 1 < pts.length; i++) { const dd = toSegment({ x, z: yy }, { x: pts[i]!.x, z: pts[i]!.y }, { x: pts[i + 1]!.x, z: pts[i + 1]!.y }); if (dd < d) { d = dd; best = s; } }
    }
    return best;
  };
  const pick = (x: number, yy: number): Picked | undefined => {
    for (const [id, w] of wrenches) {
      const box = w.el.querySelector(".plate")!.getBoundingClientRect();
      if (x >= box.left - 3 && x <= box.right + 3 && yy >= box.top - 3 && yy <= box.bottom + 3) return { kind: "wrench", id };
    }
    const gate = gateAt(x, yy);
    if (gate) return { kind: "link", id: gate };
    for (const [id, at] of towns) { const q = project(lift(at, SIZE.lift)).page; if (Math.hypot(q.x - x, q.y - yy) < 7) return { kind: "territory", id }; }
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
    if (kind === "road") return segments.some(s => String(s.id) === id) ? { kind, id } : undefined;
    return undefined;
  };
  // A picked link lights its whole way along the shared roads, and its entrance gate, in gold; a picked road lights
  // itself. Nothing is hidden or dimmed.
  const highlight = (picked: Picked | undefined) => {
    for (const list of coreMats.values()) for (const m of list) m.color.set(m.userData.colour as string);
    for (const o of litWay.values()) o.visible = false;
    for (const w of wrenches.values()) w.el.classList.remove("lit");
    const keys = picked?.kind === "link" ? [picked.id] : picked?.kind === "wrench" ? [wrenches.get(picked.id)!.via] : picked?.kind === "road" ? [`road:${picked.id}`] : [];
    for (const k of keys) { for (const m of coreMats.get(k) ?? []) m.color.set(PALETTE.lit); const o = litWay.get(k); if (o) o.visible = true; }
    if (picked?.kind === "wrench") wrenches.get(picked.id)!.el.classList.add("lit");
    state.invalidate();
  };
  /** Where a mark stands on the page: a link by its entrance gate, a territory by a clear point in it. */
  const point = (kind: string, id: string) => {
    if (kind === "wrench") { const w = wrenches.get(id); if (!w) return undefined; const b = w.el.querySelector(".plate")!.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }
    if (kind === "gate") { const g = entranceGate.get(id); return g ? project(lift(g.at, SIZE.lift)).page : undefined; }
    if (kind === "town") { const t = towns.get(id); return t ? project(lift(t, SIZE.lift)).page : undefined; }
    if (kind === "mouth") return project(lift(layout.harbour.dock, SIZE.lift)).page;
    if (kind === "road") {
      const s = segments.find(x => String(x.id) === id);
      if (!s) return undefined;
      for (const t of [0.5, 0.4, 0.6, 0.3, 0.7]) { const q = project(lift(s.pts[Math.round(t * (s.pts.length - 1))]!, SIZE.lift)).page, hit = pick(q.x, q.y); if (hit?.kind === "road" && hit.id === id) return q; }
      return undefined;
    }
    if (kind === "territory") {
      const nm = anchorOf(id);
      for (let r = 3; r < 30; r += 1) for (let a = 0; a < 360; a += 20) {
        const p = { x: nm.x + r * Math.cos(a * Math.PI / 180), z: nm.z + r * Math.sin(a * Math.PI / 180) }, q = project(lift(p)).page;
        if (territoryAt(p) === id && !underName(p, 4) && clearance(p) > 1.5 && !lineAt(q.x, q.y) && !gateAt(q.x, q.y) && pick(q.x, q.y)?.kind === "territory") return q;
      }
      return undefined;
    }
    const g = entranceGate.get(id);
    if (g) { const q = project(lift(g.at, SIZE.lift)).page, hit = pick(q.x, q.y); if (hit?.kind === "link" && hit.id === id) return q; }
    return undefined;
  };

  const fills = [...new Map(data.capabilities.map(c => {
    const word = (c as unknown as { parked: boolean; word: string }).parked ? "parked" : (c as unknown as { word: string }).word, shape = fillOf.get(c.id);
    return [word, { word, colour: shape ? `#${new Color(shape.colour).getHexString()}` : "#97c459" }] as const;
  })).values()];
  const insideWays = ways.filter(w => links.get(w.key)?.dir === "inside");
  const stats = {
    links: links.size, inside: internal.length, ways: ways.length, gates: gates.length, entranceGates: entranceGate.size,
    passGates: gates.filter(g => !g.entranceOf).length, sharedOpenings: gates.filter(g => g.links.length > 1).length,
    insideBorders: insideWays.map(w => w.crossings.filter(c => !c.coast).length),
    overThird: insideWays.filter(w => w.crossings.filter(c => !c.coast).length > 1).map(w => `${links.get(w.key)!.fromTitle} -> ${links.get(w.key)!.toTitle}: ${w.crossings.length} borders`),
    landings: layout.landings.length, segments: segments.length, junctions: net.junctions.length,
    roadDrawn: Math.round(segments.reduce((sum, r) => sum + r.pts.reduce((s, p, i) => i ? s + dist(r.pts[i - 1]!, p) : 0, 0), 0)),
    waysPerSegment: { mean: +(segments.reduce((s, x) => s + x.links.length, 0) / segments.length).toFixed(2), most: Math.max(...segments.map(x => x.links.length)) },
    shared: segments.filter(s => s.links.length > 1).map(s => ({ id: s.id, links: s.links.length })).sort((a, b) => b.links - a.links).slice(0, 8),
    towns: [...towns.keys()].map(id => ({ capability: byId.get(id)?.title, roads: degree.get(id) ?? 0 })),
    gatesOnOpenLand: gates.filter(g => g.open).length,
    noEntrance: ways.filter(w => !entranceGate.has(w.key)).map(w => w.key),
    wrenches: [...wrenches].map(([id, w]) => ({ capability: byId.get(id)?.title, via: w.via })),
  };
  return {
    pick, find, highlight, point, links, fills, stats, roads: new Map(segments.map(s => [String(s.id), s.links])),
    wrenches: new Map([...wrenches].map(([id, w]) => [id, { at: w.via }])),
    keep: () => { cutLanes(); cutBorders(); },
    dispose() { cancelAnimationFrame(frame); overlay.remove(); root.remove(group); },
  };
}
