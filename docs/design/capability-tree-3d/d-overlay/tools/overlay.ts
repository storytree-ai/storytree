/** Round 7's layer on the real island, laid in the island's own plate so it turns and tilts with it. The map's island, its
 * territories, borders, names, claim flags and the selection's lanes over the sea all stay as the map draws them. It adds:
 * - each link between The library's capabilities as one overlay line, in the selection lanes' style, laid above the land with
 *   a thin dark casing, gently curved, crossing whatever territories lie between;
 * - an arrowhead where each line enters the territory it calls, near that territory's name, and a dot where it leaves its
 *   caller; a line only passing over a territory marks nothing there;
 * - the selection's lanes cut at the coast (they no longer follow the borders inland), and from each dock either a small
 *   landing of open ground that fans out to the capabilities it serves, or, when it serves one, a line straight in;
 * - 6C's wrench, upright and constant on screen like a claim flag, at the entrance its work changes. */
import { BufferGeometry, CircleGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial,
  Raycaster, RingGeometry, Vector2, Vector3, type Camera, type BufferAttribute } from "three";
import type { RootState } from "@react-three/fiber";
import type { TerritoryMap } from "../../../../../packages/forest/src/territories/territories.js";
import { capabilityPlates } from "../../../../../packages/forest/src/view/nameplates.js";

export type P = { x: number; z: number };
export type Picked =
  | { kind: "territory"; id: string }
  | { kind: "link"; id: string }
  | { kind: "landing"; id: string }
  | { kind: "wrench"; id: string };
/** One link, as the panel tells it: `inside` between two of this story's capabilities, `down` another story calling one of
 * them, `up` one of them calling another story's. */
export type LinkInfo = { key: string; from: string; to: string; fromTitle: string; toTitle: string; fromStory: string; toStory: string; dir: "inside" | "down" | "up"; arrival?: string;
  /** A fan line from a landing or dock: the links between islands it stands for, all calling (or called by) one capability. */
  carries?: string[] };
/** Where one road from other islands comes ashore. */
export type ArrivalInfo = { key: string; kind: "landing" | "direct"; stories: string[]; capabilities: string[]; links: string[] };

/** The palette (README.md lists it). The line colours are the selection lanes' own (packages/forest-world/src/planet/lanes.ts,
 * LANE_COLOUR); the wrench's ink and paper are round 6C's. */
export const PALETTE = {
  line: "#6a5fee", out: "#0d8fb0", casing: "#141a20", lit: "#ffd34d",
  landing: "#e4dcc4", landingEdge: "#f4f7f8", ink: "#2a2723", paper: "#f3efe4",
} as const;
/** 6C's wrench (docs/design/capability-tree-3d/c-cartographer/index.html), drawn in a 24-unit box about its middle. */
export const WRENCH = "M5.6-9.6a5.4 5.4 0 0 0-6.7 6.9L-9.4 5.6a2.1 2.1 0 1 0 3 3L2.1-0.9a5.4 5.4 0 0 0 6.9-6.7L5.7-4.3 3.2-4.9 2.6-7.4z";

/** Sizes in ground units (about 2.6 pixels each at rest). */
const SIZE = { line: 0.85, casing: 0.5, lift: 0.35, arrow: 3.4, arrowHalf: 1.55, dot: 0.95, landing: 7.5, clear: 1.6, apart: 3.6, bend: 0.12 };
const params = new URLSearchParams(location.search);
const BEND = Number(params.get("bend") ?? SIZE.bend);

type Capability = { id: string; title: string; dependsOn: { id: string; title: string; story: string; storyId: string }[] };
type Data = { story: { id: string; title: string }; capabilities: Capability[]; openWork: { capabilities: string[] }[]; map: { tree: { stories: { id: string; title: string; capabilities: { id: string; title: string }[] }[] } } };
export type Layer = {
  pick(x: number, y: number): Picked | undefined;
  find(kind: string, id: string): Picked | undefined;
  highlight(picked: Picked | undefined): void;
  point(kind: string, id: string): { x: number; y: number } | undefined;
  links: Map<string, LinkInfo>; arrivals: Map<string, ArrivalInfo>;
  /** For each wrench, the link whose entrance it stands at, or the capability's own start when nothing calls it. */
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

/** A gentle curve from `s` to `e`, bent to the left of its way by `bend` of its length. */
function curve(s: P, e: P, bend: number): P[] {
  const d = sub(e, s), l = Math.hypot(d.x, d.z), c = { x: (s.x + e.x) / 2 - d.z * bend, z: (s.z + e.z) / 2 + d.x * bend };
  const n = Math.max(8, Math.ceil(l / 1.5));
  return Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return { x: u * u * s.x + 2 * u * t * c.x + t * t * e.x, z: u * u * s.z + 2 * u * t * c.z + t * t * e.z }; });
}

/** A flat ribbon `width` wide along `points`, at height `y`. */
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

/** A flat triangle with its tip at `tip`, pointing along `dir`. */
function arrow(tip: P, dir: P, length: number, half: number, y: (p: P) => number): BufferGeometry {
  const d = norm(dir), side = { x: -d.z, z: d.x }, back = { x: tip.x - d.x * length, z: tip.z - d.z * length };
  const notch = { x: tip.x - d.x * length * 0.78, z: tip.z - d.z * length * 0.78 };
  const l = { x: back.x + side.x * half, z: back.z + side.z * half }, r = { x: back.x - side.x * half, z: back.z - side.z * half };
  const pts = [tip, l, notch, tip, notch, r];
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(pts.flatMap(p => [p.x, y(p), p.z]), 3));
  return geometry;
}

export function overlayLayer(state: RootState, story: string, data: Data, host: HTMLElement, map: TerritoryMap, coast: readonly (readonly P[])[]): Layer {
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
  const heightAt = (p: P) => base + slope * (p.x * p.x + p.z * p.z);
  const lift = (p: P, up = 0) => new Vector3(p.x, heightAt(p) + up, p.z);

  const onLand = (p: P) => coast.reduce((inside, loop) => inPolygon(p, loop) ? !inside : inside, false);
  const coastEdges = coast.flatMap(loop => loop.map((a, i) => [a, loop[(i + 1) % loop.length]!] as [P, P]));
  /** On land, or on the coastline itself (a lane walking along the coast is ashore). */
  const ashoreAt = (p: P) => onLand(p) || coastEdges.some(([a, b]) => toSegment(p, a, b) < 0.6);
  const territoryAt = (p: P): string | undefined => {
    if (!onLand(p)) return undefined;
    const cell = map.cells.find(c => inPolygon(p, c.polygon));
    return cell === undefined ? undefined : map.territories[cell.territory]?.capability;
  };
  const edges: [P, P][] = [...map.borders.map(b => [b.from, b.to] as [P, P]), ...coast.flatMap(loop => loop.map((a, i) => [a, loop[(i + 1) % loop.length]!] as [P, P]))];
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

  // The selection's lanes: read where each comes ashore, then cut away what runs on inland along the borders.
  const inverse = new Matrix4().copy(root.matrixWorld).invert();
  const lanes: { from: string; to: string; dir: "up" | "down"; dock: P; sea: P }[] = [];
  const cutLanes = () => {
    const v = new Vector3();
    state.scene.getObjectByName("pathways:selection-lanes")?.traverse(o => {
      if (o.name.startsWith("lane-entrance:")) {
        o.updateMatrixWorld(true); const p = o.getWorldPosition(new Vector3()).applyMatrix4(inverse);
        if (onLand({ x: p.x, z: p.z }) && !Object.getOwnPropertyDescriptor(o, "visible")?.get) { Object.defineProperty(o, "visible", { get: () => false, set: () => {}, configurable: true }); }
        return;
      }
      if (!o.name.startsWith("lane:") && !o.name.startsWith("lane-glow:")) return;
      const mesh = o as Mesh, at = mesh.geometry.getAttribute("position") as BufferAttribute;
      if (mesh.userData.cut === mesh.geometry.uuid) return;
      mesh.updateMatrixWorld(true);
      const local = (i: number) => v.set(at.getX(i), at.getY(i), at.getZ(i)).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
      const count = at.count / 2;
      const ashore: boolean[] = [];
      for (let i = 0; i < count; i++) { const a = local(2 * i).clone(), b = local(2 * i + 1); ashore.push(ashoreAt({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 })); }
      if (o.name.startsWith("lane:") && !lanes.some(l => l.from === o.userData.from && l.to === o.userData.to)) {
        // The dock: the first point on land coming in from the sea, on whichever end is this island's.
        const mine = ashore[0] ? 0 : count - 1, step = mine === 0 ? 1 : -1;
        let k = mine;
        while (k + step >= 0 && k + step < count && ashore[k]) k += step;
        const mid = (i: number): P => { const a = local(2 * i).clone(), b = local(2 * i + 1); return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }; };
        const dock = mid(k - step);
        // A point some way out over the sea along the lane, which tells one road from another where they touch the coast together.
        let j = k, sea = dock;
        while (j >= 0 && j < count && dist(sea = mid(j), dock) < 14) j += step;
        if (ashore[mine]) lanes.push({ from: o.userData.from, to: o.userData.to, dir: o.userData.dir, dock, sea });
      }
      const index = mesh.geometry.getIndex()!, keep: number[] = [];
      for (let t = 0; t < index.count; t += 3) {
        const tri = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
        if (tri.every(i => ashore[Math.floor(i / 2)])) continue;
        keep.push(...tri);
      }
      mesh.geometry.setIndex(keep);
      mesh.userData.cut = mesh.geometry.uuid;
    });
    state.invalidate();
  };
  cutLanes();

  // Group the docks: lanes coming ashore within a few units of each other, off the same road over the sea, arrive by one road.
  const docks: { at: P; sea: P; lanes: typeof lanes }[] = [];
  for (const lane of lanes) {
    const d = docks.find(k => dist(k.at, lane.dock) < 6 && dist(k.sea, lane.sea) < 3);
    if (d) d.lanes.push(lane); else docks.push({ at: lane.dock, sea: lane.sea, lanes: [lane] });
  }

  // Every link, by key.
  const links = new Map<string, LinkInfo>();
  for (const c of data.capabilities) for (const d of c.dependsOn) if (own.has(d.id))
    links.set(`${c.id}->${d.id}`, { key: `${c.id}->${d.id}`, from: c.id, to: d.id, fromTitle: c.title, toTitle: byId.get(d.id)!.title, fromStory: data.story.title, toStory: data.story.title, dir: "inside" });
  const arrivals = new Map<string, ArrivalInfo>();
  docks.forEach((dock, k) => {
    const caps = [...new Set(dock.lanes.map(l => l.dir === "up" ? l.from : l.to))].filter(id => own.has(id));
    const stories = [...new Set(dock.lanes.map(l => elsewhere.get(l.dir === "up" ? l.to : l.from)?.story ?? "?"))];
    const key = `arrival${k}`;
    arrivals.set(key, { key, kind: caps.length > 1 ? "landing" : "direct", stories, capabilities: caps, links: dock.lanes.map(l => `${l.from}->${l.to}`) });
    for (const l of dock.lanes) {
      const other = elsewhere.get(l.dir === "up" ? l.to : l.from)!, mine = byId.get(l.dir === "up" ? l.from : l.to)!;
      links.set(`${l.from}->${l.to}`, l.dir === "up"
        ? { key: `${l.from}->${l.to}`, from: l.from, to: l.to, fromTitle: mine.title, toTitle: other.title, fromStory: data.story.title, toStory: other.story, dir: "up", arrival: key }
        : { key: `${l.from}->${l.to}`, from: l.from, to: l.to, fromTitle: other.title, toTitle: mine.title, fromStory: other.story, toStory: data.story.title, dir: "down", arrival: key });
    }
  });

  // The landings: a little open ground cut from the coast, just inland of the dock, for a road that serves several capabilities.
  const centre = { x: 0, z: 0 };
  const landingAt = new Map<string, P>();
  docks.forEach((dock, k) => {
    if (arrivals.get(`arrival${k}`)!.kind !== "landing") return;
    const inward = norm(sub(centre, dock.at));
    landingAt.set(`arrival${k}`, { x: dock.at.x + inward.x * SIZE.landing * 0.35, z: dock.at.z + inward.z * SIZE.landing * 0.35 });
  });
  const inLanding = (p: P, pad = 0) => [...landingAt.values()].some(c => dist(p, c) < SIZE.landing + pad);

  // Each line's ends. Where a line leaves from or arrives at: a capability's name, a landing, or a dock.
  const anchorOf = (id: string): P => { const p = plates.get(id); return p ? { x: p.x, z: p.z } : centre; };
  const placed = new Map<string, P[]>();
  /** A clear point in `territory`, near its name and toward `toward`: off every name, clear of its borders and other marks. */
  const spot = (territory: string, toward: P): P => {
    const n = anchorOf(territory), want = sub(toward, n), taken = placed.get(territory) ?? [];
    let best: P | undefined, score = Infinity;
    for (let a = 0; a < 360; a += 6) {
      const u = { x: Math.cos(a * Math.PI / 180), z: Math.sin(a * Math.PI / 180) };
      let r = 1.5;
      while (r < 30 && underName({ x: n.x + u.x * r, z: n.z + u.z * r }, 7)) r += 0.5;
      for (const extra of [0.6, 1.6, 3, 4.5]) {
        const p = { x: n.x + u.x * (r + extra), z: n.z + u.z * (r + extra) };
        if (territoryAt(p) !== territory || clearance(p) < SIZE.clear || underName(p, 7) || inLanding(p, 1.5)) continue;
        if (taken.some(q => dist(p, q) < SIZE.apart)) continue;
        const s = angleBetween(u, want) * 6 + dist(p, n) * 0.35;
        if (s < score) { score = s; best = p; }
        break;
      }
    }
    // A territory too small for its marks keeps them at its name's edge.
    best ??= n;
    placed.set(territory, [...taken, best]);
    return best;
  };

  type Line = { key: string; s: P; e: P; pts: P[]; colour: string; tip: boolean; meshes: Mesh[]; start?: string };
  const lines: Line[] = [];
  const entranceOf = new Map<string, P>();
  const startOf = new Map<string, P>();
  // Arrivals first: a link called from inside the island, or from a landing or dock, enters its called territory.
  const internal = [...links.values()].filter(l => l.dir === "inside");
  for (const l of internal) entranceOf.set(l.key, spot(l.to, anchorOf(l.from)));
  const fanFrom = (a: ArrivalInfo): P => landingAt.get(a.key) ?? docks[Number(a.key.slice(7))]!.at;
  // A road from other islands brings many links; it draws one line per capability it serves (and per way), carrying them all.
  const fans: { key: string; arrival: ArrivalInfo; capability: string; dir: "down" | "up"; carries: string[] }[] = [];
  for (const a of arrivals.values()) for (const k of a.links) {
    const l = links.get(k)!, capability = l.dir === "up" ? l.from : l.to, dir = l.dir as "down" | "up", key = `${a.key}:${dir}:${capability}`;
    const fan = fans.find(f => f.key === key);
    if (fan) fan.carries.push(k); else fans.push({ key, arrival: a, capability, dir, carries: [k] });
  }
  for (const f of fans) {
    const one = links.get(f.carries[0]!)!, stories = [...new Set(f.carries.map(k => { const l = links.get(k)!; return f.dir === "down" ? l.fromStory : l.toStory; }))];
    const title = f.carries.length === 1 ? (f.dir === "down" ? one.fromTitle : one.toTitle) : `${f.carries.length} links`;
    const across = stories.length === 1 ? stories[0]! : `${stories.length} stories`;
    links.set(f.key, f.dir === "down"
      ? { key: f.key, from: f.arrival.key, to: f.capability, fromTitle: title, toTitle: one.toTitle, fromStory: across, toStory: data.story.title, dir: "down", arrival: f.arrival.key, carries: f.carries }
      : { key: f.key, from: f.capability, to: f.arrival.key, fromTitle: one.fromTitle, toTitle: title, fromStory: data.story.title, toStory: across, dir: "up", arrival: f.arrival.key, carries: f.carries });
    if (f.dir === "down") entranceOf.set(f.key, spot(f.capability, fanFrom(f.arrival)));
  }
  // Then each caller's starts: one dot per direction it calls out in (within a quarter turn), shared by its lines that way.
  const ports = new Map<string, { at: P; dirs: P[] }[]>();
  const startFor = (from: string, target: P): P => {
    const n = anchorOf(from), dir = norm(sub(target, n)), list = ports.get(from) ?? [];
    const near = list.find(p => p.dirs.every(d => angleBetween(d, dir) < Math.PI / 4));
    if (near) { near.dirs.push(dir); return near.at; }
    const at = spot(from, target);
    list.push({ at, dirs: [dir] }); ports.set(from, list);
    return at;
  };
  for (const l of internal) startOf.set(l.key, startFor(l.from, entranceOf.get(l.key)!));
  for (const f of fans) if (f.dir === "up") startOf.set(f.key, startFor(f.capability, fanFrom(f.arrival)));

  // Lay the lines.
  const group = new Group(); group.name = "mock-overlay-lines"; root.add(group);
  const y = (up: number) => (p: P) => heightAt(p) + SIZE.lift + up;
  const material = (colour: string, order: number) => new MeshBasicMaterial({ color: colour, transparent: true, opacity: 1, side: DoubleSide, depthWrite: false, depthTest: false, fog: false });
  const casingMat = new MeshBasicMaterial({ color: PALETTE.casing, transparent: true, opacity: 0.88, side: DoubleSide, depthWrite: false, depthTest: false, fog: false });
  const add = (geometry: BufferGeometry, mat: MeshBasicMaterial, order: number) => {
    const m = new Mesh(geometry, mat); m.renderOrder = order; m.raycast = () => {}; group.add(m); return m;
  };
  const disc = (p: P, r: number, mat: MeshBasicMaterial, order: number, up: number) => {
    const g = new CircleGeometry(r, 20); g.rotateX(-Math.PI / 2); const m = add(g, mat, order); m.position.copy(lift(p, SIZE.lift + up)); return m;
  };
  const coreMats = new Map<string, MeshBasicMaterial>();
  const lineMat = (key: string, colour: string) => { const m = material(colour, 0); m.userData.colour = colour; coreMats.set(key, m); return m; };
  const dotMats = new Map<string, MeshBasicMaterial>();
  const dotDrawn = new Set<string>();
  const drawLine = (key: string, s: P, e: P, colour: string, tip: boolean, startDot: boolean) => {
    // Lines between the same two places in both directions bend to opposite sides; every line bends a little, so lines
    // that share a start fan apart.
    const pts = curve(s, e, BEND);
    const endDir = sub(pts.at(-1)!, pts.at(-3)!);
    // The line stops short of its arrowhead's tip, so the head reads sharp.
    const body = tip ? (() => { const back = SIZE.arrow * 0.7, cut: P[] = [...pts]; while (cut.length > 2 && dist(cut.at(-1)!, e) < back) cut.pop(); return cut; })() : pts;
    const mat = lineMat(key, colour);
    const meshes = [
      add(ribbon(body, SIZE.line + SIZE.casing * 2, y(0)), casingMat, 10),
      add(ribbon(body, SIZE.line, y(0.02)), mat, 12),
    ];
    if (tip) {
      meshes.push(add(arrow({ x: e.x + norm(endDir).x * 0.45, z: e.z + norm(endDir).z * 0.45 }, endDir, SIZE.arrow + 0.9, SIZE.arrowHalf + 0.62, y(0.04)), casingMat, 13));
      meshes.push(add(arrow(e, endDir, SIZE.arrow, SIZE.arrowHalf, y(0.06)), mat, 14));
    }
    const dotKey = `${s.x.toFixed(2)},${s.z.toFixed(2)}`;
    if (startDot && !dotDrawn.has(dotKey)) {
      dotDrawn.add(dotKey);
      const dm = material(colour, 0); dm.userData.colour = colour; dotMats.set(dotKey, dm);
      disc(s, SIZE.dot + SIZE.casing * 0.9, casingMat, 15, 0.08); disc(s, SIZE.dot, dm, 16, 0.1);
    }
    lines.push({ key, s, e, pts, colour, tip, meshes, start: startDot ? dotKey : undefined });
  };
  for (const l of internal) drawLine(l.key, startOf.get(l.key)!, entranceOf.get(l.key)!, PALETTE.line, true, true);
  for (const f of fans) {
    const a = f.arrival, k = f.key, from = fanFrom(a), dock = docks[Number(a.key.slice(7))]!.at;
    if (f.dir === "down") {
      // From the landing's rim (or the dock) in to the capability it serves.
      const e = entranceOf.get(k)!, s = landingAt.has(a.key) ? (() => { const u = norm(sub(e, from)); return { x: from.x + u.x * SIZE.landing * 0.92, z: from.z + u.z * SIZE.landing * 0.92 }; })() : dock;
      drawLine(k, s, e, PALETTE.line, true, false);
    } else {
      // Out from the capability to the landing's rim, or to the dock, where the lane goes on over the sea.
      const s = startOf.get(k)!, e = landingAt.has(a.key) ? (() => { const u = norm(sub(s, from)); return { x: from.x + u.x * SIZE.landing * 0.95, z: from.z + u.z * SIZE.landing * 0.95 }; })() : dock;
      drawLine(k, s, e, PALETTE.out, true, true);
    }
  }
  // The landings themselves: open ground, its rim the map's thin white border.
  const landingMeshes = new Map<string, Mesh>();
  for (const [key, c] of landingAt) {
    const fill = new MeshBasicMaterial({ color: PALETTE.landing, transparent: true, side: DoubleSide, depthWrite: false, depthTest: false, fog: false });
    // A disc of open ground, cut to the land: the part over the sea is left out.
    const pts: number[] = [], R = SIZE.landing, rings = 10, around = 48;
    const at = (r: number, a: number): P => ({ x: c.x + r * Math.cos(a), z: c.z + r * Math.sin(a) });
    const put = (...ps: P[]) => { if (!onLand({ x: ps.reduce((s, p) => s + p.x, 0) / 3, z: ps.reduce((s, p) => s + p.z, 0) / 3 })) return; for (const p of ps) pts.push(p.x - c.x, 0, p.z - c.z); };
    for (let i = 0; i < rings; i++) for (let k = 0; k < around; k++) {
      const r0 = R * i / rings, r1 = R * (i + 1) / rings, a0 = k / around * Math.PI * 2, a1 = (k + 1) / around * Math.PI * 2;
      put(at(r0, a0), at(r1, a0), at(r1, a1)); if (i > 0) put(at(r0, a0), at(r1, a1), at(r0, a1));
    }
    const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(pts, 3));
    const m = new Mesh(g, fill); m.renderOrder = 9; m.position.copy(lift(c, 0.12)); group.add(m); landingMeshes.set(key, m);
    const rimMat = new MeshBasicMaterial({ color: PALETTE.landingEdge, transparent: true, side: DoubleSide, depthWrite: false, depthTest: false });
    let run: P[] = [];
    const flush = () => { if (run.length > 1) { const rm = new Mesh(ribbon(run, 0.4, y(-SIZE.lift + 0.12)), rimMat); rm.renderOrder = 9.5; rm.raycast = () => {}; group.add(rm); } run = []; };
    for (let k = 0; k <= 96; k++) { const p = at(R, k / 96 * Math.PI * 2); if (onLand(p)) run.push(p); else flush(); }
    flush();
  }

  // The wrenches: 6C's rule. An increment names a capability, not a link: its wrench stands at the capability's most central
  // entrance in (the one nearest its name), or, when nothing calls it, at the start of its own line out.
  const overlay = document.createElement("div");
  overlay.className = "mock-overlay";
  host.appendChild(overlay);
  type Spot = { el: HTMLElement; at: Vector3 };
  const spots: Spot[] = [];
  const wrenches = new Map<string, Spot & { via: string }>();
  for (const id of new Set(data.openWork.flatMap(w => w.capabilities))) {
    if (!own.has(id)) continue;
    const ins = lines.filter(l => links.get(l.key)?.to === id);
    // The plate stands about 16 to 38 pixels above its foot: it must not cover a name.
    const plateClear = (p: P) => { const q = project(lift(p)).page; return !nameBoxes.some(b => q.x + 12 > b.l && q.x - 12 < b.r && q.y - 16 > b.t && q.y - 38 < b.b); };
    const ordered = ins.sort((a, b) => dist(a.e, anchorOf(id)) - dist(b.e, anchorOf(id)));
    // At the marker, or, when its plate would cover a name there, a little way back along the same line.
    const along = (l: Line) => [...l.pts].reverse().filter(p => dist(p, l.e) < 7);
    let via: Line | undefined, at: P | undefined;
    for (const l of ordered) { const p = along(l).find(plateClear); if (p) { via = l; at = p; break; } }
    if (!via && ins.length) { via = ordered[0]!; at = via.e; }
    if (!via) { via = lines.find(l => links.get(l.key)?.from === id); at = via?.s; }
    if (!via || !at) continue;
    const el = document.createElement("div");
    el.className = "mock-wrench"; el.dataset.capability = id;
    el.innerHTML = `<svg viewBox="-13 -40 26 42" width="26" height="42" aria-hidden="true">
      <ellipse cx="0" cy="0" rx="4.5" ry="1.6" fill="#080b0e" fill-opacity="0.55"/>
      <path d="M0 0V-17" stroke="${PALETTE.ink}" stroke-width="1.6"/>
      <circle class="plate" cx="0" cy="-27" r="11" fill="${PALETTE.paper}" stroke="${PALETTE.ink}" stroke-width="1.2"/>
      <g transform="translate(0 -27) scale(0.66)"><path class="glyph" d="${WRENCH}" fill="${PALETTE.ink}"/></g>
    </svg>`;
    overlay.appendChild(el);
    const spotAt = { el, at: lift(at, SIZE.lift), via: via.key };
    spots.push(spotAt); wrenches.set(id, spotAt);
  }
  let frame = 0;
  const follow = () => {
    for (const s of spots) {
      const at = project(s.at);
      s.el.style.transform = `translate(${at.x}px, ${at.y}px)`;
      s.el.style.visibility = at.front ? "" : "hidden";
    }
    frame = requestAnimationFrame(follow);
  };
  follow();
  state.invalidate();

  // Picking: a wrench by its icon, then the nearest line on the page, then a landing, then the territory below.
  const raycaster = new Raycaster();
  const lineAt = (x: number, y: number) => {
    let best: Line | undefined, d = 7;
    for (const l of lines) {
      const pts = l.pts.map(p => project(lift(p, SIZE.lift)).page);
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i]!, b = pts[i + 1]!, dd = toSegment({ x, z: y }, { x: a.x, z: a.y }, { x: b.x, z: b.y });
        if (dd < d) { d = dd; best = l; }
      }
    }
    return best;
  };
  const pick = (x: number, y: number): Picked | undefined => {
    for (const [id, w] of wrenches) {
      const box = w.el.querySelector(".plate")!.getBoundingClientRect();
      if (x >= box.left - 3 && x <= box.right + 3 && y >= box.top - 3 && y <= box.bottom + 3) return { kind: "wrench", id };
    }
    const line = lineAt(x, y);
    if (line) return { kind: "link", id: line.key };
    const rect = state.gl.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new Vector2((x - rect.left) / rect.width * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1), state.camera as Camera);
    const landing = raycaster.intersectObjects([...landingMeshes.values()], false)[0];
    if (landing) return { kind: "landing", id: [...landingMeshes].find(([, m]) => m === landing.object)![0] };
    const under = raycaster.intersectObjects([...fillOf.values()].map(f => f.mesh), false)[0];
    const id = under?.object.name.slice("territory:".length);
    return id && own.has(id) ? { kind: "territory", id } : undefined;
  };
  const find = (kind: string, id: string): Picked | undefined => {
    if (kind === "territory") return own.has(id) ? { kind, id } : undefined;
    if (kind === "wrench") return wrenches.has(id) ? { kind, id } : undefined;
    if (kind === "link") return lines.some(l => l.key === id) ? { kind, id } : undefined;
    if (kind === "landing") return landingMeshes.has(id) ? { kind, id } : undefined;
    return undefined;
  };

  // The pick lights in the selection's gold; nothing is hidden or dimmed.
  const highlight = (picked: Picked | undefined) => {
    for (const m of [...coreMats.values(), ...dotMats.values()]) m.color.set(m.userData.colour as string);
    for (const w of wrenches.values()) w.el.classList.remove("lit");
    for (const m of landingMeshes.values()) (m.material as MeshBasicMaterial).color.set(PALETTE.landing);
    const keys = picked?.kind === "link" ? [picked.id] : picked?.kind === "landing" ? fans.filter(f => f.arrival.key === picked.id).map(f => f.key) : picked?.kind === "wrench" ? [wrenches.get(picked.id)!.via] : [];
    for (const k of keys) {
      coreMats.get(k)?.color.set(PALETTE.lit);
      const start = lines.find(l => l.key === k)?.start;
      if (start) dotMats.get(start)?.color.set(PALETTE.lit);
    }
    if (picked?.kind === "landing") (landingMeshes.get(picked.id)!.material as MeshBasicMaterial).color.set("#f3e3a6");
    if (picked?.kind === "wrench") wrenches.get(picked.id)!.el.classList.add("lit");
    state.invalidate();
  };

  const point = (kind: string, id: string) => {
    if (kind === "wrench") { const w = wrenches.get(id); if (!w) return undefined; const b = w.el.querySelector(".plate")!.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }
    if (kind === "landing") { const c = landingAt.get(id); return c ? project(lift(c)).page : undefined; }
    if (kind === "territory") {
      // A point in the territory that is on no line and under no name.
      const n = anchorOf(id);
      for (let r = 3; r < 30; r += 1) for (let a = 0; a < 360; a += 20) {
        const p = { x: n.x + r * Math.cos(a * Math.PI / 180), z: n.z + r * Math.sin(a * Math.PI / 180) }, q = project(lift(p)).page;
        if (territoryAt(p) === id && !underName(p, 4) && clearance(p) > 1.5 && !lineAt(q.x, q.y) && pick(q.x, q.y)?.kind === "territory") return q;
      }
      return undefined;
    }
    const line = lines.find(l => l.key === id);
    if (!line) return undefined;
    for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
      const q = project(lift(line.pts[Math.round(t * (line.pts.length - 1))]!, SIZE.lift)).page;
      const hit = pick(q.x, q.y);
      if (hit?.kind === "link" && hit.id === id) return q;
    }
    return undefined;
  };

  const fills = [...new Map(data.capabilities.map(c => {
    const word = (c as unknown as { parked: boolean; word: string }).parked ? "parked" : (c as unknown as { word: string }).word, shape = fillOf.get(c.id);
    return [word, { word, colour: shape ? `#${new Color(shape.colour).getHexString()}` : "#97c459" }] as const;
  })).values()];
  const stats = {
    links: links.size, inside: internal.length, lines: lines.length, starts: dotDrawn.size,
    arrivals: [...arrivals.values()].map(a => ({ kind: a.kind, fans: fans.filter(f => f.arrival.key === a.key).map(f => `${f.dir} ${byId.get(f.capability)?.title}: ${f.carries.length}`), stories: a.stories, capabilities: a.capabilities.map(id => byId.get(id)?.title), links: a.links.length })),
    wrenches: [...wrenches].map(([id, w]) => ({ capability: byId.get(id)?.title, via: w.via })),
  };
  return {
    pick, find, highlight, point, links, arrivals, fills, stats,
    wrenches: new Map([...wrenches].map(([id, w]) => [id, { at: w.via }])),
    keep: cutLanes,
    dispose() { cancelAnimationFrame(frame); overlay.remove(); root.remove(group); },
  };
}
