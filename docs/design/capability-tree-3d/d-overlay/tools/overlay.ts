/** Round 7's layer on the real island, laid in the island's own plate so it turns and tilts with it. The map's island, its
 * territories (shape, size, colour, thin white borders), its names, its roads between islands and the selection's lanes
 * across the sea all stay as the map draws them. What changes:
 * - the selection's lanes stop at their dock on the coast (the map runs them on along the borders, ADR-0991 D4): only the
 *   stretch on this island's land is left undrawn;
 * - every link between The library's capabilities is one overlay line above the land, in the lanes' manner (a coloured
 *   thread with a thin dark casing), gently curved, straight across whatever lies between;
 * - each line starts at a dot in its caller's territory and ends on an arrowhead in the territory it enters, both beside
 *   that territory's name and clear of every name;
 * - each arriving road: a small landing of open ground on the coast when it serves more than one capability here, its
 *   lines fanning out from there; otherwise its line runs straight into the one capability it serves;
 * - 6C's wrench, upright on a stem like the claim flag, at the entrance its work changes. */
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, Plane, Raycaster,
  Vector2, Vector3, type Camera } from "three";
import type { RootState } from "@react-three/fiber";
import type { TerritoryMap } from "../../../../../packages/forest/src/territories/territories.js";
import { capabilityPlates } from "../../../../../packages/forest/src/view/nameplates.js";
import { LANE_COLOUR } from "../../../../../packages/forest-world/src/planet/lanes.js";

export type P = { x: number; z: number };
export type Picked =
  | { kind: "territory"; id: string }
  | { kind: "line"; id: string }
  | { kind: "wrench"; id: string };
/** One link, as the panel tells it: `from` calls `to`. */
export type LinkInfo = { key: string; from: string; to: string; fromTitle: string; toTitle: string; fromStory: string; toStory: string };
/** One drawn line: a link inside the story, a fan line from a landing or a dock (every link it carries into one
 * capability), or a line out to a dock. */
export type LineInfo = { id: string; kind: "inside" | "arrival" | "out"; links: string[]; to: string; toTitle: string; toStory: string; from?: string; dock?: number };
export type ArrivalInfo = { dock: number; stories: string[]; links: number; serves: { id: string; title: string; links: number }[]; landing: boolean; territory?: string };
export type Layer = {
  pick(x: number, y: number): Picked | undefined;
  find(kind: string, id: string): Picked | undefined;
  highlight(picked: Picked | undefined): void;
  /** Where a mark is on the page, in CSS pixels, for a capture to click. */
  point(kind: string, id: string): { x: number; y: number } | undefined;
  /** Lays the lines and marks: once the rest view is framed, so names are measured where they stand. */
  place(): void;
  links: Map<string, LinkInfo>; lines: Map<string, LineInfo>; arrivals: ArrivalInfo[];
  fills: { word: string; colour: string }[];
  stats: Record<string, unknown>;
  extent(): { left: number; right: number; top: number; bottom: number };
  keepHidden(): void;
};
type Capability = { id: string; title: string; lines: number; word: string; parked: boolean; dependsOn: { id: string; title: string; story: string; storyId: string }[] };
type Data = { story: { id: string; title: string }; capabilities: Capability[]; openWork: { capabilities: string[] }[]; map: { tree: { stories: { id: string; title: string; capabilities: { id: string; title: string }[] }[] } } };

/** The palette (README.md lists it). The threads are the map's own lane inks (packages/forest-world/src/planet/lanes.ts). */
export const PALETTE = {
  inside: "#fbf6e9", arrival: LANE_COLOUR.down, out: LANE_COLOUR.up, casing: "#15121a", lit: "#ffc93c",
  landing: "#e4e6e1", landingEdge: "#f4f7f8", ink: "#2a2723", paper: "#f3efe4", shadow: "#080b0e",
} as const;
/** 6C's wrench (docs/design/capability-tree-3d/c-cartographer/index.html's symbol), drawn in a 24-unit box. */
export const WRENCH = "M5.6-9.6a5.4 5.4 0 0 0-6.7 6.9L-9.4 5.6a2.1 2.1 0 1 0 3 3L2.1-0.9a5.4 5.4 0 0 0 6.9-6.7L5.7-4.3 3.2-4.9 2.6-7.4z";

const query = new URLSearchParams(location.search);
/** Sizes, in the plate's ground units (about 2.6 pixels each at rest). */
const SIZE = {
  thread: Number(query.get("thread") ?? 0.9), casing: 0.28, arrow: 3.6, arrowWide: 3, start: 0.95,
  /** How far a line bows from straight, as a share of its length. */
  bow: Number(query.get("bow") ?? 0.08), lift: 0.35,
  /** The landing's radius. */
  landing: 6,
  /** Clearances: a marker from any name, from another marker, and from its territory's border. */
  nameRoom: 6, markRoom: 5, borderRoom: 1.1,
};

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
const along = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
const unit = (a: P, b: P): P => { const l = dist(a, b) || 1; return { x: (b.x - a.x) / l, z: (b.z - a.z) / l }; };
const turn = (d: P, a: number): P => ({ x: d.x * Math.cos(a) - d.z * Math.sin(a), z: d.x * Math.sin(a) + d.z * Math.cos(a) });
function inPolygon(p: P, poly: readonly P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** A flat ribbon `width` wide along `points`, at height `y`. */
function ribbon(points: P[], width: number, y: (p: P) => number): BufferGeometry {
  const positions: number[] = [], index: number[] = [];
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)]!, b = points[Math.min(points.length - 1, i + 1)]!;
    const d = unit(a, b), nx = -d.z * width / 2, nz = d.x * width / 2;
    positions.push(p.x + nx, y(p), p.z + nz, p.x - nx, y(p), p.z - nz);
    if (i > 0) { const k = 2 * i; index.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}
/** A flat filled polygon (a fan from its first point, so convex shapes only), at height `y`. */
function fan(points: P[], y: (p: P) => number): BufferGeometry {
  const positions = points.flatMap(p => [p.x, y(p), p.z]), index: number[] = [];
  for (let i = 1; i + 1 < points.length; i++) index.push(0, i, i + 1);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}
const circle = (c: P, r: number, n = 20): P[] => [c, ...Array.from({ length: n + 1 }, (_, k) => ({ x: c.x + r * Math.cos(k / n * Math.PI * 2), z: c.z + r * Math.sin(k / n * Math.PI * 2) }))];

/** The wrench on its stem: 6C's disc and spanner, upright and constant on screen, standing on the land as a claim flag does. */
function wrenchSvg(): string {
  return `<svg viewBox="-13 -40 26 42" width="26" height="42" aria-hidden="true">
    <ellipse cx="0" cy="0" rx="4.5" ry="1.6" fill="${PALETTE.shadow}" fill-opacity="0.5"/>
    <path d="M0 0V-17" stroke="${PALETTE.ink}" stroke-width="1.6" stroke-linecap="round"/>
    <g transform="translate(0 -27)"><circle class="plate" r="10.5" fill="${PALETTE.paper}" stroke="${PALETTE.ink}" stroke-width="1.2"/>
    <g transform="scale(0.625)"><path class="spanner" d="${WRENCH}" fill="${PALETTE.ink}"/></g></g>
  </svg>`;
}

export function overlayLayer(state: RootState, story: string, data: Data, host: HTMLElement, map: TerritoryMap, coast: readonly (readonly P[])[]): Layer {
  const plate = state.scene.getObjectByName(`planet:${story}`)!;
  const land = plate.getObjectByName("territory-land")!, root = land.parent!;
  root.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(root.matrixWorld).invert();
  const own = new Set(data.capabilities.map(({ id }) => id));
  const byId = new Map(data.capabilities.map(c => [c.id, c]));
  const elsewhere = new Map(data.map.tree.stories.flatMap(s => s.capabilities.map(c => [c.id, { title: c.title, story: s.title }] as const)));

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
  // On the land: inside the coast, or on it (the map's lanes run along the coast between two borders), and up at its height.
  const nearCoast = (p: P) => coast.some(ring => ring.some((a, i) => {
    const b = ring[(i + 1) % ring.length]!, d = unit(a, b), l = dist(a, b), t = Math.max(0, Math.min(l, (p.x - a.x) * d.x + (p.z - a.z) * d.z));
    return dist(p, { x: a.x + d.x * t, z: a.z + d.z * t }) < 1.5;
  }));
  const onLand = (p: { x: number; y: number; z: number }) => (coast.some(ring => inPolygon(p, ring)) || nearCoast(p)) && p.y > heightAt(p) - 2;

  // The selection's lanes: where each comes ashore here (its dock), read from the map's own lanes. Their stretch on this
  // island's land, the way along the borders, is left undrawn (keepHidden), and their end marks here hidden.
  const local = (mesh: Mesh, i: number) => {
    const at = mesh.geometry.getAttribute("position");
    return new Vector3(at.getX(i), at.getY(i), at.getZ(i)).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
  };
  const trimmed = new WeakSet<BufferGeometry>();
  const trim = (mesh: Mesh) => {
    const geometry = mesh.geometry;
    if (trimmed.has(geometry) || !geometry.index) return;
    mesh.updateMatrixWorld(true);
    const count = geometry.getAttribute("position").count / 2;
    const ashore = Array.from({ length: count }, (_, i) => { const a = local(mesh, 2 * i), b = local(mesh, 2 * i + 1); return onLand(a.add(b).multiplyScalar(0.5)); });
    const old = Array.from(geometry.index.array), kept: number[] = [];
    for (let k = 0; k < old.length; k += 6) { const i = (old[k]! + 2) / 2; if (!(ashore[i - 1] && ashore[i])) kept.push(...old.slice(k, k + 6)); }
    geometry.setIndex(kept);
    trimmed.add(geometry);
  };
  const lanes: { from: string; to: string; dir: string; dock: P; width: number }[] = [];
  const laneGroup = () => state.scene.getObjectByName("pathways:selection-lanes");
  laneGroup()?.traverse(o => {
    if (!o.name.startsWith("lane:")) return;
    const mesh = o as Mesh, count = mesh.geometry.getAttribute("position").count / 2;
    mesh.updateMatrixWorld(true);
    let dock: Vector3 | undefined, width = 1;
    // The dock: the lane's first point on this island's land, walking in from the sea (a lane runs in dependency order, so
    // one building on this island ends here, one this island builds on starts here).
    const up = o.userData.dir === "up";
    for (let k = 0; k < count; k++) {
      const i = up ? k : count - 1 - k, a = local(mesh, 2 * i), b = local(mesh, 2 * i + 1), p = a.clone().add(b).multiplyScalar(0.5);
      if (onLand(p)) { dock = p; width = a.distanceTo(b); break; }
    }
    if (dock) lanes.push({ from: o.userData.from, to: o.userData.to, dir: o.userData.dir, dock: { x: dock.x, z: dock.z }, width });
  });
  const keepHidden = () => {
    laneGroup()?.traverse(o => {
      if (o.name.startsWith("lane:") || o.name.startsWith("lane-glow:")) trim(o as Mesh);
      if (o.name.startsWith("lane-entrance:") && !Object.getOwnPropertyDescriptor(o, "visible")?.get) {
        o.updateMatrixWorld(true);
        const p = new Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(inverse);
        if (onLand(p)) Object.defineProperty(o, "visible", { get: () => false, set: () => {}, configurable: true });
      }
    });
    state.invalidate();
  };
  keepHidden();
  const docks: P[] = [];
  const dockOf = (p: P) => { let i = docks.findIndex(d => dist(d, p) < 2); if (i < 0) { i = docks.length; docks.push(p); } return i; };

  // Every link with an end here.
  const links = new Map<string, LinkInfo>();
  for (const c of data.capabilities) for (const d of c.dependsOn) if (own.has(d.id))
    links.set(`${c.id}->${d.id}`, { key: `${c.id}->${d.id}`, from: c.id, to: d.id, fromTitle: c.title, toTitle: byId.get(d.id)!.title, fromStory: data.story.title, toStory: data.story.title });
  const arrivingAt = new Map<number, LinkInfo[]>(), leavingAt = new Map<number, LinkInfo[]>();
  for (const lane of lanes) {
    const key = `${lane.from}->${lane.to}`, other = elsewhere.get(lane.dir === "up" ? lane.to : lane.from);
    if (!other || links.has(key) || !own.has(lane.dir === "up" ? lane.from : lane.to)) continue;
    const mine = byId.get(lane.dir === "up" ? lane.from : lane.to)!, dock = dockOf(lane.dock);
    const info: LinkInfo = lane.dir === "up"
      ? { key, from: lane.from, to: lane.to, fromTitle: mine.title, toTitle: other.title, fromStory: data.story.title, toStory: other.story }
      : { key, from: lane.from, to: lane.to, fromTitle: other.title, toTitle: mine.title, fromStory: other.story, toStory: data.story.title };
    links.set(key, info);
    const into = lane.dir === "up" ? leavingAt : arrivingAt;
    into.set(dock, [...(into.get(dock) ?? []), info]);
  }
  const width = lanes.length ? Math.min(...lanes.map(l => l.width)) : SIZE.thread;

  // The territories, their names and where each name stands.
  const territoryOf = new Map(map.territories.map((t, i) => [i, t.capability]));
  const cellsOf = new Map<string, P[][]>();
  for (const cell of map.cells) { const c = territoryOf.get(cell.territory); if (c) cellsOf.set(c, [...(cellsOf.get(c) ?? []), cell.polygon as P[]]); }
  const territoryAt = (p: P) => { const cell = map.cells.find(c => inPolygon(p, c.polygon as P[])); return cell && territoryOf.get(cell.territory); };
  const plates = new Map(capabilityPlates(map).map(p => [p.capability, { x: p.x, z: p.z }]));
  const arrivals: ArrivalInfo[] = [...arrivingAt].map(([dock, ls]) => {
    const serves = [...new Set(ls.map(l => l.to))].map(id => ({ id, title: byId.get(id)!.title, links: ls.filter(l => l.to === id).length }));
    const at = docks[dock]!, inward = unit(at, { x: 0, z: 0 });
    return { dock, stories: [...new Set(ls.map(l => l.fromStory))], links: ls.length, serves, landing: serves.length > 1, territory: territoryAt({ x: at.x + inward.x, z: at.z + inward.z }) };
  });

  const group = new Group(); group.name = "mock-lines"; root.add(group);
  const overlay = document.createElement("div");
  overlay.className = "mock-overlay";
  host.appendChild(overlay);
  const project = (v: Vector3) => {
    const rect = state.gl.domElement.getBoundingClientRect(), hostRect = host.getBoundingClientRect();
    const w = v.clone().applyMatrix4(root.matrixWorld).project(state.camera as Camera);
    return { x: rect.left - hostRect.left + (w.x + 1) / 2 * rect.width, y: rect.top - hostRect.top + (1 - w.y) / 2 * rect.height, page: { x: rect.left + (w.x + 1) / 2 * rect.width, y: rect.top + (1 - w.y) / 2 * rect.height }, front: w.z < 1 };
  };
  const lift = (p: P, up = 0) => new Vector3(p.x, heightAt(p) + up, p.z);
  const raycaster = new Raycaster();
  const ray = (x: number, y: number) => { const rect = state.gl.domElement.getBoundingClientRect(); raycaster.setFromCamera(new Vector2((x - rect.left) / rect.width * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1), state.camera as Camera); };
  /** The point on the plate's ground under a point on the page. */
  const toGround = (x: number, y: number, near: P): P | undefined => {
    ray(x, y);
    const origin = raycaster.ray.origin.clone().applyMatrix4(inverse), towards = raycaster.ray.origin.clone().add(raycaster.ray.direction).applyMatrix4(inverse).sub(origin);
    const plane = new Plane(new Vector3(0, 1, 0), -heightAt(near)), hit = new Vector3();
    return new (raycaster.ray.constructor as typeof raycaster.ray)(origin, towards.normalize()).intersectPlane(plane, hit) ? { x: hit.x, z: hit.z } : undefined;
  };

  const lines = new Map<string, LineInfo>();
  type Drawn = { info: LineInfo; pts: P[]; materials: MeshBasicMaterial[]; colour: string; end?: P };
  const drawn = new Map<string, Drawn>();
  const wrenches = new Map<string, { el: HTMLElement; at: Vector3 }>();
  const marks: { kind: string; at: P; line: string }[] = [];
  const landings: { dock: number; at: P }[] = [];
  let stats: Record<string, unknown> = {};

  const place = () => {
    if (drawn.size) return;
    state.camera.updateMatrixWorld(); root.updateMatrixWorld(true);
    // Each name's footprint on the ground, as it stands on the page now, with room around it.
    const names: { id: string; quad: P[] }[] = [];
    for (const el of host.querySelectorAll<HTMLElement>(".planet-nameplate.capability[data-capability-id]")) {
      const id = el.dataset.capabilityId!, at = plates.get(id);
      if (!at || !own.has(id)) continue;
      const r = el.getBoundingClientRect(), m = 4;
      const quad = [[r.left - m, r.top - m], [r.right + m, r.top - m], [r.right + m, r.bottom + m], [r.left - m, r.bottom + m]].map(([x, y]) => toGround(x!, y!, at));
      if (quad.every(Boolean)) names.push({ id, quad: quad as P[] });
    }
    const inName = (p: P, room: number) => names.some(({ quad }) => inPolygon(p, quad) || quad.some((q, i) => { const b = quad[(i + 1) % 4]!, d = unit(q, b), l = dist(q, b), t = Math.max(0, Math.min(l, (p.x - q.x) * d.x + (p.z - q.z) * d.z)); return dist(p, { x: q.x + d.x * t, z: q.z + d.z * t }) < room; }));
    const taken: P[] = [];
    let fallbacks = 0;
    // A marker's place: in `capability`'s territory, beside its name on the side facing `toward`, clear of every name, of
    // the other markers and of the territory's border.
    // Where a territory is too small for that beside a name as large as the page draws it at rest, the rules ease, then the
    // marker takes the territory's land farthest from the names.
    const tiers = [{ name: SIZE.nameRoom * 0.5, mark: SIZE.markRoom, border: SIZE.borderRoom }, { name: 1, mark: 3, border: 0.6 }, { name: 0.2, mark: 2, border: 0.3 }];
    const spot = (capability: string, toward: P): P => {
      const middle = plates.get(capability)!, dir = unit(middle, toward);
      for (const tier of tiers) {
        let best: P | undefined, score = Infinity;
        for (let r = 1; r <= 40; r += 0.6) for (const a of [0, 0.2, -0.2, 0.4, -0.4, 0.65, -0.65, 0.9, -0.9, 1.25, -1.25, 1.6, -1.6, 2.1, -2.1, 2.6, -2.6, Math.PI]) {
          const s = r + Math.abs(a) * 7;
          if (s >= score) continue;
          const d = turn(dir, a), p = { x: middle.x + d.x * r, z: middle.z + d.z * r };
          if (territoryAt(p) !== capability || inName(p, tier.name) || taken.some(q => dist(p, q) < tier.mark)) continue;
          if (Array.from({ length: 8 }, (_, k) => turn({ x: tier.border, z: 0 }, k * Math.PI / 4)).some(o => territoryAt({ x: p.x + o.x, z: p.z + o.z }) !== capability)) continue;
          best = p; score = s;
        }
        if (best) { taken.push(best); return best; }
      }
      const sites = map.cells.filter(c => territoryOf.get(c.territory) === capability).map(c => c.site as P);
      const room = (p: P) => Math.min(...names.map(({ quad }) => Math.min(...quad.map(q => dist(p, q)))), ...taken.map(q => dist(p, q)));
      const at = sites.sort((a, b) => room(b) - room(a))[0] ?? middle;
      taken.push(at);
      fallbacks++;
      return at;
    };
    // The landings first: open ground just inland of each dock that serves more than one capability here.
    for (const a of arrivals) if (a.landing) {
      const at = docks[a.dock]!, inward = unit(at, { x: 0, z: 0 });
      const centre = { x: at.x + inward.x * (SIZE.landing * 0.7), z: at.z + inward.z * (SIZE.landing * 0.7) };
      landings.push({ dock: a.dock, at: centre });
      taken.push(centre);
    }
    const landingOf = (dock: number) => landings.find(l => l.dock === dock)?.at;
    // The lines, with what each starts from and ends on.
    type Plan = { info: LineInfo; from: P | (() => P); to: P | (() => P); colour: string; arrow: boolean; startDot: boolean };
    const plans: Plan[] = [];
    for (const l of [...links.values()].filter(l => l.fromStory === data.story.title && l.toStory === data.story.title)) {
      const info: LineInfo = { id: l.key, kind: "inside", links: [l.key], to: l.to, toTitle: l.toTitle, toStory: l.toStory, from: l.from };
      plans.push({ info, from: plates.get(l.from)!, to: plates.get(l.to)!, colour: PALETTE.inside, arrow: true, startDot: true });
    }
    for (const a of arrivals) for (const s of a.serves) {
      const id = `dock${a.dock}->${s.id}`, origin = landingOf(a.dock) ?? docks[a.dock]!;
      const info: LineInfo = { id, kind: "arrival", links: arrivingAt.get(a.dock)!.filter(l => l.to === s.id).map(l => l.key), to: s.id, toTitle: s.title, toStory: data.story.title, dock: a.dock };
      plans.push({ info, from: origin, to: plates.get(s.id)!, colour: PALETTE.arrival, arrow: true, startDot: false });
    }
    for (const [dock, ls] of leavingAt) for (const l of ls) {
      const info: LineInfo = { id: l.key, kind: "out", links: [l.key], to: l.to, toTitle: l.toTitle, toStory: l.toStory, from: l.from, dock };
      plans.push({ info, from: plates.get(l.from)!, to: docks[dock]!, colour: PALETTE.out, arrow: false, startDot: true });
    }
    // Entrances first, nearest the names; then each line's start, facing where it goes.
    const ends = plans.map(p => p.arrow ? spot(p.info.to, p.from as P) : p.to as P);
    // A line from a landing leaves from its rim, facing where it goes.
    const rim = (from: P, to: P) => { const l = landings.find(q => q.at === from); if (!l) return from; const d = unit(from, to); return { x: from.x + d.x * SIZE.landing, z: from.z + d.z * SIZE.landing }; };
    const starts = plans.map((p, i) => p.startDot ? spot(p.info.from!, ends[i]!) : rim(p.from as P, ends[i]!));
    const y = (up: number) => (p: P) => heightAt(p) + SIZE.lift + up;
    const material = (colour: string, order: number) => new MeshBasicMaterial({ color: colour, transparent: true, opacity: 1, fog: false, side: DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -order });
    const casingMat = material(PALETTE.casing, 6); casingMat.opacity = 0.85;
    // The landings: a disc of open ground, edged as a territory is.
    for (const l of landings) {
      const edge = new Mesh(fan(circle(l.at, SIZE.landing + 0.35, 28), y(-0.2)), material(PALETTE.landingEdge, 4)); edge.renderOrder = 8;
      const ground = new Mesh(fan(circle(l.at, SIZE.landing, 28), y(-0.18)), material(PALETTE.landing, 5)); ground.renderOrder = 9;
      edge.raycast = ground.raycast = () => {};
      group.add(edge, ground);
    }
    plans.forEach((plan, i) => {
      const a = starts[i]!, b = ends[i]!, len = dist(a, b), d = unit(a, b), side = { x: -d.z, z: d.x };
      const mid = along(a, b, 0.5), bow = len * SIZE.bow, c = { x: mid.x + side.x * bow, z: mid.z + side.z * bow };
      const curve = (t: number): P => along(along(a, c, t), along(c, b, t), t);
      const pts = Array.from({ length: 33 }, (_, k) => curve(k / 32));
      // The thread stops at the arrowhead's base.
      const head = plan.arrow ? SIZE.arrow : 0;
      let cut = pts.length - 1;
      while (plan.arrow && cut > 1 && dist(pts[cut]!, b) < head * 0.8) cut--;
      const body = plan.arrow ? [...pts.slice(0, cut + 1)] : pts;
      const tip = b, back = unit(pts[cut]!, b), base = { x: tip.x - back.x * head, z: tip.z - back.z * head }, wide = { x: -back.z * SIZE.arrowWide / 2, z: back.x * SIZE.arrowWide / 2 };
      const fill = material(plan.colour, 7);
      const parts: Mesh[] = [
        new Mesh(ribbon(body, width + SIZE.casing * 2, y(0)), casingMat),
        new Mesh(ribbon(body, width, y(0.01)), fill),
      ];
      parts[0]!.renderOrder = 10; parts[1]!.renderOrder = 12;
      if (plan.arrow) {
        const c2 = SIZE.casing * 1.6, tipOut = { x: tip.x + back.x * c2, z: tip.z + back.z * c2 }, baseOut = { x: base.x - back.x * c2 * 0.6, z: base.z - back.z * c2 * 0.6 };
        const wideOut = { x: wide.x * (1 + c2 / SIZE.arrowWide * 2.2), z: wide.z * (1 + c2 / SIZE.arrowWide * 2.2) };
        const casing = new Mesh(fan([tipOut, { x: baseOut.x + wideOut.x, z: baseOut.z + wideOut.z }, { x: baseOut.x - wideOut.x, z: baseOut.z - wideOut.z }], y(0.02)), casingMat);
        const arrow = new Mesh(fan([tip, { x: base.x + wide.x, z: base.z + wide.z }, { x: base.x - wide.x, z: base.z - wide.z }], y(0.03)), fill);
        casing.renderOrder = 11; arrow.renderOrder = 13;
        parts.push(casing, arrow);
        marks.push({ kind: "end", at: tip, line: plan.info.id });
      }
      if (plan.startDot) {
        const casing = new Mesh(fan(circle(a, SIZE.start + SIZE.casing, 16), y(0.02)), casingMat), dot = new Mesh(fan(circle(a, SIZE.start, 16), y(0.03)), fill);
        casing.renderOrder = 11; dot.renderOrder = 13;
        parts.push(casing, dot);
        marks.push({ kind: "start", at: a, line: plan.info.id });
      }
      for (const m of parts) { m.raycast = () => {}; group.add(m); }
      lines.set(plan.info.id, plan.info);
      drawn.set(plan.info.id, { info: plan.info, pts, materials: [fill], colour: plan.colour, ...plan.arrow ? { end: tip } : {} });
    });
    // A hub where each landing's lines fan out, and where the road meets it from the dock.
    for (const l of landings) {
      const dock = docks[l.dock]!, fill = material(PALETTE.arrival, 7);
      // The road's last step ashore, from the dock to the landing's edge.
      const d = unit(l.at, dock), edge = { x: l.at.x + d.x * SIZE.landing, z: l.at.z + d.z * SIZE.landing };
      if (dist(dock, l.at) > SIZE.landing) {
        const parts = [new Mesh(ribbon([dock, edge], width + SIZE.casing * 2, y(0)), casingMat), new Mesh(ribbon([dock, edge], width, y(0.01)), fill)];
        parts.forEach((m, k) => { m.renderOrder = [10, 12][k]!; m.raycast = () => {}; group.add(m); });
      }
    }
    // The wrenches: at the capability's most central entrance (the one nearest its name), or where its line leaves when
    // nothing calls it.
    const named = new Set(data.openWork.flatMap(w => w.capabilities));
    const wrenchBoxes: { l: number; r: number; t: number; b: number }[] = [];
    for (const capability of named) {
      if (!own.has(capability)) continue;
      const middle = plates.get(capability)!;
      const into = marks.filter(m => m.kind === "end" && lines.get(m.line)!.to === capability).sort((p, q) => dist(p.at, middle) - dist(q.at, middle))[0];
      const out = marks.find(m => m.kind === "start" && lines.get(m.line)!.from === capability);
      const mark = into ?? out;
      if (!mark) continue;
      // Beside the mark, nearest it where the wrench, as the page draws it, covers no name, no other wrench and not the mark.
      const rects = [...host.querySelectorAll<HTMLElement>(".planet-nameplate")].map(e => e.getBoundingClientRect()).map(r => ({ l: r.left, r: r.right, t: r.top, b: r.bottom }));
      const boxAt = (p: P) => { const q = project(lift(p, SIZE.lift)).page; return { l: q.x - 13, r: q.x + 13, t: q.y - 40, b: q.y + 2 }; };
      const markBox = (() => { const q = project(lift(mark.at, SIZE.lift)).page; return { l: q.x - 5, r: q.x + 5, t: q.y - 5, b: q.y + 5 }; })();
      const meets = (a: { l: number; r: number; t: number; b: number }, b: typeof a) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
      let at = mark.at;
      search: for (let r = 2.4; r <= 14; r += 0.8) for (let k = 0; k < 16; k++) {
        const p = { x: mark.at.x + Math.cos(k / 16 * Math.PI * 2) * r, z: mark.at.z + Math.sin(k / 16 * Math.PI * 2) * r }, box = boxAt(p);
        if (territoryAt(p) !== capability || [...rects, markBox, ...wrenchBoxes].some(o => meets(box, o))) continue;
        at = p; wrenchBoxes.push(box); break search;
      }
      const el = document.createElement("div");
      el.className = "mock-wrench"; el.dataset.capability = capability; el.innerHTML = wrenchSvg();
      overlay.appendChild(el);
      wrenches.set(capability, { el, at: lift(at, SIZE.lift) });
    }
    stats = {
      lines: lines.size, inside: plans.filter(p => p.info.kind === "inside").length, arrivalLines: plans.filter(p => p.info.kind === "arrival").length,
      out: plans.filter(p => p.info.kind === "out").length, links: links.size, docks: docks.length, landings: landings.length,
      arrivals: arrivals.map(a => ({ ...a, territory: a.territory && byId.get(a.territory)?.title })), wrenches: [...wrenches.keys()].map(id => byId.get(id)?.title),
      namesMeasured: names.length, width, laneDocks: Object.entries(lanes.reduce((m, l) => { const k = `${l.dir} ${l.dock.x.toFixed(1)},${l.dock.z.toFixed(1)}`; m[k] = (m[k] ?? 0) + 1; return m; }, {} as Record<string, number>)),
      markersInOwnTerritory: marks.filter(m => m.kind === "end").every(m => territoryAt(m.at) === lines.get(m.line)!.to),
      markersInNames: marks.filter(m => inName(m.at, 0)).length, markersOnFallback: fallbacks,
    };
    state.invalidate();
  };

  let frame = 0;
  const follow = () => {
    for (const w of wrenches.values()) {
      const at = project(w.at);
      w.el.style.transform = `translate(${at.x}px, ${at.y}px)`;
      w.el.style.visibility = at.front ? "" : "hidden";
    }
    frame = requestAnimationFrame(follow);
  };
  follow();

  // Picking: a wrench by its icon, then the nearest line on the page within a few pixels, then the territory below.
  const nearLine = (x: number, y: number, besides?: string): { id: string; d: number } | undefined => {
    let best: { id: string; d: number } | undefined;
    for (const [id, l] of drawn) {
      if (id === besides) continue;
      const pts = l.pts.map(p => project(lift(p, SIZE.lift)).page);
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i]!, b = pts[i + 1]!, dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
        const d = Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
        if (!best || d < best.d) best = { id, d };
      }
    }
    return best;
  };
  const pick = (x: number, y: number): Picked | undefined => {
    for (const [capability, w] of wrenches) {
      const box = w.el.querySelector("svg")!.getBoundingClientRect();
      if (x >= box.left - 2 && x <= box.right + 2 && y >= box.top - 2 && y <= box.bottom - 12) return { kind: "wrench", id: capability };
    }
    const near = nearLine(x, y);
    if (near && near.d < 6) return { kind: "line", id: near.id };
    ray(x, y);
    const under = raycaster.intersectObjects([...fillOf.values()].map(f => f.mesh), false)[0];
    const id = under?.object.name.slice("territory:".length);
    return id && own.has(id) ? { kind: "territory", id } : undefined;
  };
  const find = (kind: string, id: string): Picked | undefined =>
    kind === "territory" ? (own.has(id) ? { kind, id } : undefined)
      : kind === "wrench" ? (wrenches.has(id) ? { kind, id } : undefined)
        : kind === "line" ? (drawn.has(id) ? { kind, id } : undefined) : undefined;

  // The pick lights in gold: a line's thread and its marks. Nothing is hidden or dimmed.
  // A lit line also glows gold either side of its casing, so it stands out among lines of its own colour.
  const glow = new MeshBasicMaterial({ color: PALETTE.lit, transparent: true, opacity: 0.55, fog: false, side: DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
  let halo: Mesh | undefined;
  const highlight = (picked: Picked | undefined) => {
    for (const l of drawn.values()) for (const m of l.materials) m.color.set(l.colour);
    for (const w of wrenches.values()) w.el.classList.remove("lit");
    if (halo) { group.remove(halo); halo.geometry.dispose(); halo = undefined; }
    const line = picked?.kind === "line" ? drawn.get(picked.id) : undefined;
    if (line) {
      for (const m of line.materials) m.color.set(PALETTE.lit);
      halo = new Mesh(ribbon(line.pts, SIZE.thread * 3.4, p => heightAt(p) + SIZE.lift - 0.01), glow); halo.renderOrder = 9; halo.raycast = () => {};
      group.add(halo);
    }
    if (picked?.kind === "wrench") wrenches.get(picked.id)?.el.classList.add("lit");
    state.invalidate();
  };

  const point = (kind: string, id: string) => {
    if (kind === "wrench") { const w = wrenches.get(id); if (!w) return undefined; const b = w.el.querySelector("svg")!.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height * 0.35 }; }
    if (kind === "line") {
      // The point along it farthest from every other line on the page, so the click lands on this one.
      const l = drawn.get(id);
      if (!l) return undefined;
      let best: { x: number; y: number } | undefined, room = -1;
      for (let k = 6; k <= 26; k++) {
        const at = project(lift(l.pts[k]!, SIZE.lift)).page, r = nearLine(at.x, at.y, id)?.d ?? 99;
        if (r > room) { room = r; best = at; }
      }
      return best;
    }
    if (kind === "territory") {
      // The spot of its land farthest from any line, so the click reaches the land.
      let best: { x: number; y: number } | undefined, room = -1;
      for (const cell of map.cells) {
        if (territoryOf.get(cell.territory) !== id) continue;
        const at = project(lift(cell.site)).page, r = nearLine(at.x, at.y)?.d ?? 99;
        if (r > room) { room = r; best = at; }
      }
      return best;
    }
    if (kind === "mark") { const m = marks.find(q => q.line === id && q.kind === "end"); return m && project(lift(m.at, SIZE.lift)).page; }
    if (kind === "landing") { const l = landings.find(q => String(q.dock) === id); return l && project(lift(l.at, SIZE.lift)).page; }
    if (kind === "dock") { const d = docks[Number(id)]; return d && project(lift(d, SIZE.lift)).page; }
    return undefined;
  };

  const fills = [...new Map(data.capabilities.map(c => {
    const word = c.parked ? "parked" : c.word, shape = fillOf.get(c.id);
    return [word, { word, colour: shape ? `#${new Color(shape.colour).getHexString()}` : "#97c459" }] as const;
  })).values()];

  return {
    pick, find, highlight, point, place, links, lines, arrivals, fills, keepHidden,
    get stats() { return stats; },
    extent() {
      state.camera.updateMatrixWorld(); root.updateMatrixWorld(true);
      const pts = coast.flat().map(q => project(lift(q)).page);
      return { left: Math.min(...pts.map(c => c.x)), right: Math.max(...pts.map(c => c.x)), top: Math.min(...pts.map(c => c.y)) - 10, bottom: Math.max(...pts.map(c => c.y)) + 10 };
    },
  };
}
