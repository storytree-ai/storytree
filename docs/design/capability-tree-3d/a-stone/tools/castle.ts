/** Round 5's layer on the real island, laid in the island's own plate so it turns and tilts with it. The map's island, its
 * territories (their shape, size and colour), its coast, glass and camera all stay as the map draws them; the plan (town.ts)
 * adds, flat on the land in the map's own colours:
 * - the borders between territories drawn dashed, in the map's border colour, in place of its thin solid white line;
 * - the roads, one solid line each in the map's road colour, along the borders and in from the docks where other islands'
 *   roads land;
 * - one gate per link: a gap in the called territory's dashed border, a short tick each side, the road running through it
 *   and a short way in;
 * - a wrench, a flat ink icon standing upright and constant on screen as a flag does, at the gap its work changes;
 * - each capability's name at its territory's middle. */
import { BoxGeometry, BufferGeometry, CanvasTexture, Color, DoubleSide, Float32BufferAttribute, Group, Matrix4, Mesh,
  MeshBasicMaterial, Object3D, Raycaster, RepeatWrapping, SRGBColorSpace, Vector2, Vector3, type Camera } from "three";
import type { RootState } from "@react-three/fiber";
import type { TerritoryMap } from "../../../../../packages/forest/src/territories/territories.js";
import { SAMPLE } from "./panel.js";
import { insideOf } from "../../../../../packages/forest/src/view/territory-land.js";
import { along, townPlan, type LinkEnd, type P } from "./town.js";

export type Picked =
  | { kind: "territory"; id: string }
  | { kind: "link"; id: string }
  | { kind: "road"; id: string; links: string[] }
  | { kind: "gate"; id: string }
  | { kind: "wrench"; id: string; capability: string; sample: boolean };
/** One link, as the panel tells it. */
export type LinkInfo = { key: string; from: string; to: string; fromTitle: string; toTitle: string; fromStory: string; toStory: string; gate?: string; dock?: number };
export type GateInfo = { key: string; town: string; links: string[] };
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

/** The palette (README.md lists it): the border and the road are the map's own colours (packages/forest/src/view/
 * territory-land.ts's BORDER_COLOUR; packages/forest-world/src/planet/plumbing.ts's DEPENDENCY_ROAD). */
export const PALETTE = {
  ink: "#1b1814", border: "#f4f7f8", road: "#c7bba1", roadEdge: "#6e5236", lit: "#ffd34d",
  wrench: "#1b1814", wrenchEdge: "#ece4d0", wrenchSample: "#d6bdf0", shadow: "#080b0e",
} as const;
const query = new URLSearchParams(location.search);
/** The island's ground unit, as round 4 measured its strips: 5 units is about 13 pixels at rest. */
export const UNIT = 5;
/** A gate's gap in the border, in ground units (README: round 5). */
export const GAP = Number(query.get("gap") ?? 4.2);

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
const nameOf = (title: string) => title.replace(/^\d+ · /, "");

/** A dash drawn once, repeated along every border: on for `on` of each repeat. */
function dashTexture(colour: string, on: number): CanvasTexture {
  const canvas = document.createElement("canvas"); canvas.width = 8; canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = colour; ctx.fillRect(0, 0, 8, Math.round(64 * on));
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
  // The map's file dots, claim flags and thin solid borders on this island stay out of sight (the borders are drawn again,
  // dashed); its territories stay as drawn.
  const hideMap = () => {
    land.traverse(mark => {
      if (mark === land || !/^(file|claim|territory-borders)/.test(mark.name) || Object.getOwnPropertyDescriptor(mark, "visible")?.get) return;
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
  const dockOf = (p: P) => { let i = dockAt.findIndex(d => dist(d, p) < UNIT * 1.5); if (i < 0) { i = dockAt.length; dockAt.push(p); } return i; };

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

  // Sizes, in ground units (about 2.6 pixels each at rest).
  const BORDER = 0.42, DASH = 2.6, DASH_ON = 0.55;
  const ROAD = 0.95, ROAD_EDGE = 0.22, TURN = UNIT * 0.6;
  const TICK = GAP * 0.6, TICK_W = 0.8;
  const LIFT = 0.05;
  const plan = townPlan(map, coast, { inset: UNIT, gap: GAP, links: asked, docks: dockAt });
  for (const l of plan.links) { const info = links.get(l.key)!; if (l.gate) info.gate = l.gate; }
  const lift = (q: P, up = 0) => new Vector3(q.x, heightAt(q) + up, q.z);
  const ground = (q: P) => heightAt(q) + LIFT;

  const group = new Group(); group.name = "mock-roads"; root.add(group);
  const flat = (colour: string, offset: number, map?: CanvasTexture) => new MeshBasicMaterial({ color: map ? "#ffffff" : colour, ...(map ? { map } : {}), transparent: true, fog: false, side: DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: offset });
  const gatesOn = new Map<string, typeof plan.gates extends Map<string, infer G> ? G[] : never>();
  for (const g of plan.gates.values()) gatesOn.set(g.town, [...(gatesOn.get(g.town) ?? []), g]);
  const indexOf = new Map([...plan.towns.values()].map(t => [t.index, t.id]));

  // The borders, dashed: every border the map draws, cut to the coast, opened where a gate stands on it.
  const dashed = flat(PALETTE.border, -1, dashTexture(PALETTE.border, DASH_ON));
  const litDashed = flat(PALETTE.lit, -4, dashTexture(PALETTE.lit, DASH_ON));
  const bordersOf = new Map<string, P[][]>();
  let gapsCut = 0;
  for (const border of map.borders) {
    const parts = border.between.map(c => map.cells[c]!.territory);
    const mine = parts.map(i => indexOf.get(i)).filter((x): x is string => !!x);
    const gaps = mine.flatMap(id => gatesOn.get(id) ?? []);
    for (const piece of insideOf(border.from, border.to, coast)) {
      const a = piece.from, b = piece.to, l = dist(a, b);
      if (l < 1e-6) continue;
      // Each gate's gap: the stretch of this piece within half a gap of the gate.
      const cuts = gaps.flatMap(g => {
        const dx = (b.x - a.x) / l, dz = (b.z - a.z) / l, u = (g.at.x - a.x) * dx + (g.at.z - a.z) * dz;
        const off = Math.hypot(g.at.x - a.x - u * dx, g.at.z - a.z - u * dz), r = GAP / 2;
        if (off >= r) return [];
        const h = Math.sqrt(r * r - off * off), u0 = Math.max(0, u - h), u1 = Math.min(l, u + h);
        return u1 > u0 ? [[u0, u1] as [number, number]] : [];
      }).sort((p, q) => p[0] - q[0]);
      const runs: P[][] = [];
      let from = 0;
      for (const [u0, u1] of cuts) { if (u0 > from + 1e-6) runs.push([along(a, b, from / l), along(a, b, u0 / l)]); from = Math.max(from, u1); gapsCut++; }
      if (l > from + 1e-6) runs.push([along(a, b, from / l), b]);
      for (const run of runs) {
        const mesh = new Mesh(ribbon(run, BORDER, ground, DASH), dashed); mesh.renderOrder = 3; mesh.raycast = () => {};
        group.add(mesh);
        for (const id of mine) bordersOf.set(id, [...(bordersOf.get(id) ?? []), run]);
      }
    }
  }

  // Roads: every stretch the links walk, drawn once; a stretch is a line of the graph or the way in through a gate.
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
    // A road ends through its gate and a short way in.
    if (l.endSpur) carry(`s${pointKey(l.endSpur[1])}<${l.nodes.at(-1)}`, l.endSpur, [nodeKey(l.nodes.at(-1)!), pointKey(l.endSpur[1])], l.key);
    routeOf.set(l.key, [...l.nodes.map(i => plan.nodes[i]!), ...(l.endSpur ? [l.endSpur[1]] : [])]);
  }
  // Chained through the corners where only two stretches with the same load meet, so a road runs on as one line.
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
  // A solid line in the road colour over a thin darker edge, the edges all drawn first so where roads meet they join as one.
  const roadFill = flat(PALETTE.road, -3), roadEdge = flat(PALETTE.roadEdge, -2);
  const roadHits: Mesh[] = [];
  chains.forEach((chain, k) => {
    const pts = rounded(chain.pts, TURN);
    const edge = new Mesh(ribbon(pts, ROAD + ROAD_EDGE * 2, ground, 1), roadEdge); edge.renderOrder = 4; edge.raycast = () => {};
    const mesh = new Mesh(ribbon(pts, ROAD, ground, 1), roadFill); mesh.renderOrder = 5; mesh.raycast = () => {};
    const hit = new Mesh(ribbon(pts, UNIT * 0.8, ground, 1), new MeshBasicMaterial({ visible: false, side: DoubleSide }));
    hit.name = `road:${k}`; hit.userData = { links: chain.carried, pts };
    group.add(edge, mesh, hit); roadHits.push(hit);
  });
  // A round cap where a road ends or splits, so its joins read as one line.
  const cap = (p: P, r: number, material: MeshBasicMaterial, order: number) => {
    const pts: number[] = [], c = [p.x, ground(p), p.z];
    for (let k = 0; k < 16; k++) { const a0 = k / 16 * Math.PI * 2, a1 = (k + 1) / 16 * Math.PI * 2, q0 = { x: p.x + r * Math.cos(a0), z: p.z + r * Math.sin(a0) }, q1 = { x: p.x + r * Math.cos(a1), z: p.z + r * Math.sin(a1) }; pts.push(...c, q0.x, ground(q0), q0.z, q1.x, ground(q1), q1.z); }
    const geometry = new BufferGeometry(); geometry.setAttribute("position", new Float32BufferAttribute(pts, 3));
    const m = new Mesh(geometry, material); m.renderOrder = order; m.raycast = () => {}; return m;
  };
  for (const [end, n] of degree) if (n !== 2) {
    const s = [...stretches.values()].find(o => o.ends.includes(end))!, p = s.ends[0] === end ? s.pts[0]! : s.pts.at(-1)!;
    group.add(cap(p, ROAD / 2 + ROAD_EDGE, roadEdge, 4), cap(p, ROAD / 2, roadFill, 5));
  }

  // Gates: the gap itself, marked by a short tick across the border's end each side of it, in the border's colour; an unseen
  // box over the gap, so a click on it is easy to land.
  const gateGroups = new Map<string, Group>();
  const tickMaterial = flat(PALETTE.border, -6);
  for (const g of plan.gates.values()) {
    const gg = new Group(); gg.name = `gate:${g.key}`;
    const fill = tickMaterial.clone();
    for (const s of [-1, 1]) {
      const c = { x: g.at.x + g.along.x * GAP / 2 * s, z: g.at.z + g.along.z * GAP / 2 * s };
      const a = { x: c.x - g.out.x * TICK / 2, z: c.z - g.out.z * TICK / 2 }, b = { x: c.x + g.out.x * TICK / 2, z: c.z + g.out.z * TICK / 2 };
      const tick = new Mesh(ribbon([a, b], TICK_W, q => ground(q) + 0.02, 1), fill); tick.renderOrder = 7; tick.raycast = () => {};
      gg.add(tick);
    }
    const hit = new Mesh(new BoxGeometry(GAP * 1.2, 1.5, GAP * 1.2), new MeshBasicMaterial({ visible: false, side: DoubleSide }));
    const mid = along(g.at, g.inner, 0.25);
    hit.position.copy(lift(mid, 0.75)); hit.rotation.y = -Math.atan2(g.along.z, g.along.x);
    gg.add(hit);
    gg.userData = { fill, at: mid };
    gateGroups.set(g.key, gg); group.add(gg);
  }

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
    const inward = { x: -g.out.x, z: -g.out.z }, step = GAP * 0.55;
    return { x: g.at.x + inward.x * step + g.along.x * GAP * 0.8, z: g.at.z + inward.z * step + g.along.z * GAP * 0.8 };
  };
  const makeWrench = (capability: string, sample: boolean) => {
    const el = document.createElement("div");
    el.className = `mock-wrench${sample ? " mock-wrench-sample" : ""}`;
    el.innerHTML = wrenchSvg(sample ? PALETTE.wrenchSample : PALETTE.wrench) + (sample ? `<span class="mock-wrench-tag">sample</span>` : "");
    overlay.appendChild(el);
    const spot = { el, at: lift(wrenchAt(capability), 0.1), sample };
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
    spots.push({ el: dot, at: lift(d.at, 0.05) });
    const el = document.createElement("div"); el.className = "forest-label planet-nameplate capability mock-road-name"; el.textContent = d.label; overlay.appendChild(el);
    spots.push({ el, at: lift(d.at, 0.05), name: true });
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

  // The pick lights in the selection's gold: a territory's own dashed border, a gate's ticks, and every road it names drawn
  // over in one solid gold line. Nothing is hidden or dimmed.
  // One solid gold line, wide enough to cover the brown dashes under it: gold over dashes out of step read as orange.
  const litMaterial = new MeshBasicMaterial({ color: PALETTE.lit, transparent: true, fog: false, side: DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5 });
  const lit: Mesh[] = [];
  const highlight = (picked: Picked | undefined) => {
    for (const g of gateGroups.values()) (g.userData.fill as MeshBasicMaterial).color.set(PALETTE.border);
    for (const w of [...wrenches.values(), ...(sampleWrench ? [sampleWrench] : [])]) w.el.classList.remove("lit");
    for (const m of lit.splice(0)) { group.remove(m); m.geometry.dispose(); }
    if (picked?.kind === "territory") for (const run of bordersOf.get(picked.id) ?? []) { const m = new Mesh(ribbon(run, BORDER * 1.6, q => ground(q) + 0.01, DASH), litDashed); m.renderOrder = 6; group.add(m); lit.push(m); }
    if (picked?.kind === "wrench") (picked.sample ? sampleWrench : wrenches.get(picked.capability))?.el.classList.add("lit");
    const keys = picked?.kind === "link" ? [picked.id] : picked?.kind === "road" ? picked.links : picked?.kind === "gate" ? plan.gates.get(picked.id)!.links : [];
    if (picked?.kind === "gate") (gateGroups.get(picked.id)!.userData.fill as MeshBasicMaterial).color.set(PALETTE.lit);
    if (picked?.kind === "link") { const g = links.get(picked.id)?.gate; if (g) (gateGroups.get(g)!.userData.fill as MeshBasicMaterial).color.set(PALETTE.lit); }
    for (const k of keys) {
      const pts = routeOf.get(k);
      if (!pts) continue;
      const m = new Mesh(ribbon(rounded(pts, TURN), ROAD + ROAD_EDGE * 2, q => ground(q) + 0.01, 1), litMaterial); m.renderOrder = 6; group.add(m); lit.push(m);
    }
    state.invalidate();
  };

  const point = (kind: string, id: string) => {
    if (kind === "wrench") { const w = id.endsWith(":sample") ? sampleWrench : wrenches.get(id); if (!w) return undefined; const b = w.el.querySelector("svg")!.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height * 0.35 }; }
    if (kind === "gate") { const g = gateGroups.get(id); return g ? project(lift(g.userData.at as P)).page : undefined; }
    if (kind === "territory") { const t = plan.towns.get(id); return t ? project(lift({ x: t.deep.x, z: t.deep.z + t.depth * 0.5 })).page : undefined; }
    // A link, or a road: the middle of the stretch that carries it with the fewest others.
    const hits = kind === "link" ? roadHits.filter(h => (h.userData.links as string[]).includes(id)).sort((a, b) => a.userData.links.length - b.userData.links.length)
      : roadHits.filter(h => h.name === `road:${id}`);
    const pts = hits[0]?.userData.pts as P[] | undefined;
    if (!pts) return undefined;
    // The point along it farthest from every gate's gap, so a click there lands on the road and not on a gate.
    const gateAt = [...gateGroups.values()].map(g => g.userData.at as P);
    let best: P | undefined, room = -1;
    for (let i = 1; i < pts.length; i++) for (let t = 0.1; t < 1; t += 0.2) {
      const p = along(pts[i - 1]!, pts[i]!, t), r = Math.min(...gateAt.map(q => dist(p, q)));
      if (r > room) { room = r; best = p; }
    }
    if (best) return project(lift(best)).page;
    return undefined;
  };

  const fills = [...new Map(data.capabilities.map(c => {
    const word = c.parked ? "parked" : c.word, shape = fillOf.get(c.id);
    return [word, { word, colour: shape ? `#${new Color(shape.colour).getHexString()}` : "#97c459" }] as const;
  })).values()];
  const gates = new Map([...plan.gates].map(([k, g]) => [k, { key: k, town: g.town, links: g.links }]));
  const stats = {
    gap: GAP, territories: plan.towns.size, gapsCut, gates: plan.gates.size, links: links.size, routed: plan.links.length,
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
