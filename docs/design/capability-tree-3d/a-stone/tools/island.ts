/** Round 6A's layer on the real island, laid in the island's own plate so it turns and tilts with it. The map's island, its
 * coast, glass, camera and the roads between islands stay as the map draws them; on this island the mock hides the map's own
 * territory cut and lays its plan (flow.ts) on the same land instead, flat, in the map's colours and the claim flags' ink:
 * - open land, a pale parchment, over the whole island;
 * - each capability an organic patch in its health colour, its outline dashed;
 * - the roads, solid, through the open land, never across a patch: one way out of each caller, splitting toward its gates;
 *   the links from other islands come ashore where the map's roads land and split the same way;
 * - one gate per link, a gap in the called patch's dashed outline, a short ink tick each side, the road running through it;
 * - a wrench, a flat ink icon standing upright and constant on screen as a flag does, at the gate its work changes;
 * - each capability's name, as the map names a territory (its plate's look), at its middle. */
import { BoxGeometry, BufferGeometry, CanvasTexture, DoubleSide, Float32BufferAttribute, Group, Matrix4, Mesh,
  MeshBasicMaterial, Object3D, Raycaster, RepeatWrapping, SRGBColorSpace, Vector2, Vector3, type Camera } from "three";
import type { RootState } from "@react-three/fiber";
import { SAMPLE } from "./panel.js";
import { GAP, along, layout, outlineArc, route, runsOf, type P, type Want } from "./flow.js";

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
  /** Every drawn road (a run carrying the same links), by id. */
  roads: { id: string; links: string[] }[];
  /** Each health the patches are filled with, and the map's colour for it. */
  fills: { word: string; colour: string }[];
  /** What was laid, counted: `mock.layer.stats` in the console. */
  stats: Record<string, unknown>;
  /** The island's box on the page, in CSS pixels: the rest view is framed on it. */
  extent(): { left: number; right: number; top: number; bottom: number };
  keepHidden(): void;
  dispose(): void;
};
type Capability = { id: string; title: string; lines: number; word: string; parked: boolean; dependsOn: { id: string; title: string; story: string; storyId: string }[] };
type Data = { story: { id: string; title: string }; capabilities: Capability[]; openWork: { capabilities: string[] }[];
  map: { tree: { stories: { id: string; title: string; capabilities: { id: string; title: string; dependsOn?: string[] }[] }[] } } };

/** The palette (README.md lists it). The fills are the map's own (packages/forest/src/view/territory-land.ts's WORD_FILL and
 * PARKED_FILL); the ink is the claim flags'. */
export const PALETTE = {
  land: "#ddd5bd", ink: "#2b261f", road: "#7a5838", lit: "#ffc93c", litEdge: "#2b261f",
  wrench: "#1b1814", wrenchEdge: "#ece4d0", wrenchSample: "#d6bdf0", shadow: "#080b0e",
} as const;
const FILL: Record<string, { colour: string; opacity: number }> = {
  healthy: { colour: "#97C459", opacity: 0.8 }, unhealthy: { colour: "#E24B4A", opacity: 0.85 }, proposed: { colour: "#F2D16B", opacity: 0.8 },
  untested: { colour: "#F2D16B", opacity: 0.8 }, parked: { colour: "#86939D", opacity: 0.8 },
};
/** Sizes, in plan units (about a pixel each at rest). */
const OUTLINE = 1.6, DASH = 8, DASH_ON = 0.55, ROAD = 3.2, TICK = 8, TICK_W = 2, LIT = 4.6, LIT_EDGE = 1.4;

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
const nameOf = (title: string) => title.replace(/^\d+ · /, "");

/** A dash drawn once, repeated along every outline: on for `on` of each repeat. */
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

/** The wrench: a flat ink icon, an open-ended spanner standing upright, in the claim flag's manner. */
function wrenchSvg(fill: string): string {
  return `<svg viewBox="-10 -36 20 38" width="18" height="34" aria-hidden="true">
    <ellipse cx="0" cy="0.5" rx="5.5" ry="2" fill="${PALETTE.shadow}" fill-opacity="0.55"/>
    <path d="${WRENCH}" fill="${fill}" stroke="${fill === PALETTE.wrench ? PALETTE.wrenchEdge : PALETTE.ink}" stroke-width="1.3" stroke-linejoin="round"/>
  </svg>`;
}
/** The spanner's outline: a straight handle up to a round head with an open jaw at its top. */
export const WRENCH = "M -2 0 L -2 -17.25 A 8 8 0 0 1 -3 -32.42 L -3 -26 A 3 3 0 0 0 3 -26 L 3 -32.42 A 8 8 0 0 1 2 -17.25 L 2 0 Z";

/** The land as the map cut it, each territory's triangles: where the land is, and the ground's height. */
function landOf(land: Object3D) {
  const tris: P[][] = [], heights: [number, number][] = [];
  land.traverse(object => {
    if (!object.name.startsWith("territory:")) return;
    const mesh = object as Mesh, at = mesh.geometry.getAttribute("position"), index = mesh.geometry.getIndex();
    const corner = (i: number) => { const k = index ? index.getX(i) : i; return { x: at.getX(k), z: at.getZ(k) }; };
    const count = index ? index.count : at.count;
    for (let i = 0; i + 2 < count; i += 3) tris.push([corner(i), corner(i + 1), corner(i + 2)]);
    for (let i = 0; i < at.count; i += 7) heights.push([at.getX(i) ** 2 + at.getZ(i) ** 2, at.getY(i)]);
  });
  const boxes = tris.map(t => [Math.min(...t.map(p => p.x)), Math.max(...t.map(p => p.x)), Math.min(...t.map(p => p.z)), Math.max(...t.map(p => p.z))] as const);
  const inTri = (p: P, [a, b, c]: P[]) => {
    const s = (u: P, v: P) => (v.x - u.x) * (p.z - u.z) - (v.z - u.z) * (p.x - u.x);
    const d1 = s(a!, b!), d2 = s(b!, c!), d3 = s(c!, a!);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  const onLand = (p: P) => tris.some((t, i) => { const [x0, x1, z0, z1] = boxes[i]!; return p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1 && inTri(p, t); });
  let n = 0, sr = 0, sy = 0, srr = 0, sry = 0;
  for (const [r2, y] of heights) { n++; sr += r2; sy += y; srr += r2 * r2; sry += r2 * y; }
  const slope = n * srr - sr * sr === 0 ? 0 : (n * sry - sr * sy) / (n * srr - sr * sr), base = (sy - slope * sr) / n;
  return { tris, onLand, heightAt: (p: P) => base + slope * (p.x * p.x + p.z * p.z) };
}

export function islandLayer(state: RootState, story: string, data: Data, host: HTMLElement, coast: readonly (readonly P[])[]): Layer {
  const plate = state.scene.getObjectByName(`planet:${story}`)!;
  const landMesh = plate.getObjectByName("territory-land")!, root = landMesh.parent!;
  root.updateMatrixWorld(true);
  const { tris, onLand, heightAt } = landOf(landMesh);
  const own = new Set(data.capabilities.map(({ id }) => id));
  const byId = new Map(data.capabilities.map(c => [c.id, c]));
  const storyOf = new Map(data.map.tree.stories.flatMap(s => s.capabilities.map(c => [c.id, { title: c.title, story: s.title, storyId: s.id }] as const)));
  // The map's own cut of this island (its territory fills, borders and hatching, file dots and claim flags) is pinned out of
  // sight: the map sets each one's visibility as it presents the land, so a setter that keeps it hidden is what holds.
  const hideMap = () => {
    landMesh.traverse(mark => {
      if (mark === landMesh || !/^(territory|file|claim)/.test(mark.name) || Object.getOwnPropertyDescriptor(mark, "visible")?.get) return;
      Object.defineProperty(mark, "visible", { get: () => false, set: () => {}, configurable: true });
    });
    state.invalidate();
  };
  hideMap();

  // The plan, then fitted to the land: as large as it goes with its open margin still on land, about the land's middle.
  const { patches, layers, crossings } = layout(data.capabilities);
  // Turned east for west, when that brings the capabilities the other islands call nearer the coast their roads land on (the
  // map's lanes say where): the layers still run down, callers above.
  const arrivalsLand = (() => {
    const at = [...state.scene.getObjectByName("pathways:selection-lanes")?.children ?? []].length ? (() => {
      const xsOf: number[] = [];
      state.scene.getObjectByName("pathways:selection-lanes")!.traverse(o => { if (o.name.startsWith("lane:") && o.userData.dir !== "up") { const b = new Vector3(); (o as Mesh).geometry.computeBoundingBox(); (o as Mesh).geometry.boundingBox!.getCenter(b); xsOf.push(b.applyMatrix4((o as Mesh).matrixWorld).applyMatrix4(new Matrix4().copy(root.matrixWorld).invert()).x); } });
      return xsOf.length ? xsOf.reduce((u, v) => u + v, 0) / xsOf.length : 0;
    })() : 0;
    return at;
  })();
  const called = new Set(data.map.tree.stories.filter(s => s.id !== data.story.id).flatMap(s => s.capabilities.flatMap(c => c.dependsOn ?? [])).filter(id => own.has(id)));
  const allX = [...patches.values()].map(p => p.x), mid = (Math.min(...allX) + Math.max(...allX)) / 2;
  const calledX = [...called].map(id => patches.get(id)!.x).reduce((u, v) => u + v, 0) / Math.max(1, called.size);
  const mirrored = (arrivalsLand > 0) !== (calledX > mid);
  if (mirrored) for (const p of patches.values()) { p.x = 2 * mid - p.x; p.outline = p.outline.map(q => ({ x: 2 * mid - q.x, z: q.z })).reverse(); }
  const middle = (() => {
    let ax = 0, az = 0, area = 0;
    for (const [a, b, c] of tris) { const s = Math.abs((b!.x - a!.x) * (c!.z - a!.z) - (c!.x - a!.x) * (b!.z - a!.z)) / 2; area += s; ax += s * (a!.x + b!.x + c!.x) / 3; az += s * (a!.z + b!.z + c!.z) / 3; }
    return { x: ax / area, z: az / area };
  })();
  // Land kept round the plan, in plan units: room for a gate's way in on the coast side of any patch, and the road to it.
  const MARGIN = 60;
  const samples: P[] = [];
  for (const p of patches.values()) {
    for (let i = 0; i < p.outline.length; i += 4) { const q = p.outline[i]!, l = dist(q, p) || 1; samples.push({ x: q.x + (q.x - p.x) / l * MARGIN, z: q.z + (q.z - p.z) / l * MARGIN }); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) samples.push({ x: p.x + sx * (p.label.w / 2 + MARGIN * 0.6), z: p.z + sz * (p.label.h / 2 + MARGIN * 0.6) });
  }
  const xs = samples.map(q => q.x), zs = samples.map(q => q.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const reach = Math.max(...tris.flat().map(q => Math.max(Math.abs(q.x), Math.abs(q.z))));
  const N = 320, cellSize = reach * 2 / N, grid = new Uint8Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) grid[i * N + j] = onLand({ x: -reach + (i + 0.5) * cellSize, z: -reach + (j + 0.5) * cellSize }) ? 1 : 0;
  const landAt = (q: P) => { const i = Math.floor((q.x + reach) / cellSize), j = Math.floor((q.z + reach) / cellSize); return i >= 0 && j >= 0 && i < N && j < N && grid[i * N + j] === 1; };
  type Fit = { s: number; ox: number; oz: number };
  const place = (q: P, f: Fit) => ({ x: middle.x + f.ox + (q.x - cx) * f.s, z: middle.z + f.oz + (q.z - cz) * f.s });
  const fits = (f: Fit) => samples.every(q => landAt(place(q, f)));
  let best: Fit = { s: 0, ox: 0, oz: 0 };
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  for (let ox = -0.2; ox <= 0.201; ox += 0.02) for (const oz of [0]) {
    const trial = { s: 1e-6, ox: ox * reach, oz: oz * reach };
    if (!fits(trial) || (best.s && !fits({ ...trial, s: best.s }))) continue;
    let lo = best.s, hi = reach * 4 / span;
    for (let k = 0; k < 20; k++) { const mid = (lo + hi) / 2; if (fits({ ...trial, s: mid })) lo = mid; else hi = mid; }
    if (lo > best.s) best = { ...trial, s: lo };
  }
  const S = best.s;
  const to = (q: P): P => place(q, best);
  const back = (q: P): P => ({ x: (q.x - middle.x - best.ox) / S + cx, z: (q.z - middle.z - best.oz) / S + cz });

  // The docks: where each lit lane from another island comes ashore (the map's own lanes, read before they are hidden).
  const inverse = new Matrix4().copy(root.matrixWorld).invert();
  const lanes: { from: string; to: string; dir: string; dock: P }[] = [];
  state.scene.getObjectByName("pathways:selection-lanes")?.traverse(o => {
    if (!o.name.startsWith("lane:")) return;
    const mesh = o as Mesh, at = mesh.geometry.getAttribute("position"), v = new Vector3();
    mesh.updateMatrixWorld(true);
    const local = (i: number) => v.set(at.getX(i), at.getY(i), at.getZ(i)).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse).clone();
    const up = o.userData.dir === "up", count = at.count;
    let dock: Vector3 | undefined;
    for (let k = 0; k < count; k++) {
      const i = up ? count - 1 - k : k, p = local(i);
      if (p.y < heightAt(p) - 2) break;
      dock = p;
    }
    if (dock) lanes.push({ from: o.userData.from, to: o.userData.to, dir: o.userData.dir, dock: { x: dock.x, z: dock.z } });
  });
  const dockAt: P[] = [];
  const near = Math.max(4, reach * 0.04);
  const dockOf = (p: P) => { let i = dockAt.findIndex(d => dist(d, p) < near); if (i < 0) { i = dockAt.length; dockAt.push(p); } return i; };
  // A story's links come ashore where the map's lanes from that story land most often; failing that, on the coast toward it.
  const dockFor = (storyId: string): number => {
    const counts = new Map<number, number>();
    for (const lane of lanes) {
      const other = lane.dir === "up" ? lane.to : lane.from;
      if (storyOf.get(other)?.storyId === storyId) { const k = dockOf(lane.dock); counts.set(k, (counts.get(k) ?? 0) + 1); }
    }
    if (counts.size) return [...counts].sort((a, b) => b[1] - a[1])[0]![0];
    const there = state.scene.getObjectByName(`planet:${storyId}`)?.getWorldPosition(new Vector3()).applyMatrix4(inverse);
    const toward = there ? { x: there.x - middle.x, z: there.z - middle.z } : { x: 1, z: 1 }, l = Math.hypot(toward.x, toward.z) || 1;
    let r = 0;
    while (landAt({ x: middle.x + toward.x / l * r, z: middle.z + toward.z / l * r }) && r < reach * 2) r += cellSize / 2;
    return dockOf({ x: middle.x + toward.x / l * (r - cellSize), z: middle.z + toward.z / l * (r - cellSize) });
  };

  // Every link with an end on this island: inside it, and to or from another story's capability by a dock.
  const wants: Want[] = [];
  const links = new Map<string, LinkInfo>();
  for (const c of data.capabilities) for (const d of c.dependsOn) {
    const key = `${c.id}->${d.id}`;
    if (own.has(d.id)) {
      wants.push({ key, from: { kind: "patch", id: c.id }, to: { kind: "patch", id: d.id } });
      links.set(key, { key, from: c.id, to: d.id, fromTitle: c.title, toTitle: byId.get(d.id)!.title, fromStory: data.story.title, toStory: data.story.title });
    } else {
      const dock = dockFor(d.storyId);
      wants.push({ key, from: { kind: "patch", id: c.id }, to: { kind: "dock", dock } });
      links.set(key, { key, from: c.id, to: d.id, fromTitle: c.title, toTitle: d.title, fromStory: data.story.title, toStory: d.story, dock });
    }
  }
  for (const s of data.map.tree.stories) if (s.id !== data.story.id) for (const c of s.capabilities) for (const d of c.dependsOn ?? []) if (own.has(d)) {
    const key = `${c.id}->${d}`, dock = dockFor(s.id);
    wants.push({ key, from: { kind: "dock", dock }, to: { kind: "patch", id: d } });
    links.set(key, { key, from: c.id, to: d, fromTitle: c.title, toTitle: byId.get(d)!.title, fromStory: s.title, toStory: data.story.title, dock });
  }
  const docksInPlan = dockAt.map(back);
  const routed = route(patches, wants, q => landAt(to(q)), docksInPlan);
  for (const [k, g] of routed.gates) links.get(k)!.gate = k; void GAP;

  const ground = (q: P, up = 0) => heightAt(q) + S * (0.05 + up);
  const lift = (q: P, up = 0) => { const w = to(q); return new Vector3(w.x, ground(w, up), w.z); };
  const onGround = (pts: P[]) => pts.map(to);
  const group = new Group(); group.name = "mock-flow"; root.add(group);
  const flat = (colour: string, offset: number, opacity = 1, map?: CanvasTexture) => new MeshBasicMaterial({ color: map ? "#ffffff" : colour, ...(map ? { map } : {}), transparent: true, opacity, fog: false, side: DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: offset });

  // Open land: the whole island, a pale parchment, as a drawn map's land is.
  {
    const pos: number[] = [];
    for (const t of tris) for (const q of t) pos.push(q.x, heightAt(q) + S * 0.02, q.z);
    const geometry = new BufferGeometry(); geometry.setAttribute("position", new Float32BufferAttribute(pos, 3));
    const land = new Mesh(geometry, new MeshBasicMaterial({ color: PALETTE.land, side: DoubleSide, depthWrite: false, fog: false }));
    land.name = "mock-land"; land.renderOrder = 0.5; land.raycast = () => {};
    group.add(land);
  }
  // Patches: the map's colour for the capability's health, a fan from its middle (each outline is star-shaped about it).
  const patchMeshes = new Map<string, Mesh>();
  const fills = new Map<string, { word: string; colour: string }>();
  for (const c of data.capabilities) {
    const p = patches.get(c.id)!, word = c.parked ? "parked" : c.word, fill = FILL[word] ?? FILL.untested!;
    fills.set(word, { word, colour: fill.colour });
    const pos: number[] = [], m = to(p);
    const pts = onGround(p.outline);
    pts.forEach((q, i) => { const r = pts[(i + 1) % pts.length]!; pos.push(m.x, ground(m, 0.02), m.z, q.x, ground(q, 0.02), q.z, r.x, ground(r, 0.02), r.z); });
    const geometry = new BufferGeometry(); geometry.setAttribute("position", new Float32BufferAttribute(pos, 3));
    const mesh = new Mesh(geometry, flat(fill.colour, -1, fill.opacity)); mesh.renderOrder = 1; mesh.name = `patch:${c.id}`;
    group.add(mesh); patchMeshes.set(c.id, mesh);
  }
  // Outlines, dashed in ink, opened at each gate.
  const dashed = flat(PALETTE.ink, -2, 0.9, dashTexture(PALETTE.ink, DASH_ON));
  const outlineRuns = new Map<string, P[][]>();
  let gapsCut = 0;
  for (const [id, p] of patches) {
    const a = outlineArc(p.outline);
    const cuts = [...routed.gates.values()].filter(g => g.patch === id).map(g => [g.s - GAP / 2, g.s + GAP / 2] as [number, number]).sort((u, v) => u[0] - v[0]);
    // Start the walk at a point no gap covers.
    let start = 0;
    for (let k = 0; k < 40 && cuts.some(([u0, u1]) => [start, start + a.total, start - a.total].some(s => s > u0 && s < u1)); k++) start += GAP / 2;
    const runs: P[][] = [];
    let run: P[] = [];
    const STEP = 1.5;
    for (let s = start; s <= start + a.total + 1e-6; s += STEP) {
      const inGap = cuts.some(([u0, u1]) => [s, s - a.total, s + a.total].some(t => t > u0 && t < u1));
      if (inGap) { if (run.length > 1) runs.push(run); run = []; continue; }
      run.push(a.at(s).p);
    }
    if (run.length > 1) runs.push(run);
    gapsCut += cuts.length;
    outlineRuns.set(id, runs);
    for (const r of runs) { const mesh = new Mesh(ribbon(onGround(r), OUTLINE * S, q => ground(q, 0.04), DASH * S), dashed); mesh.renderOrder = 3; mesh.raycast = () => {}; group.add(mesh); }
  }
  // Roads: each run of a road network, drawn once, solid.
  const roadMaterial = flat(PALETTE.road, -3);
  const roadHits: Mesh[] = [];
  const runs = routed.trees.flatMap(t => runsOf(t, routed.paths, new Map()));
  for (const [k, g] of routed.gates) runs.push({ pts: [g.approach, g.at, g.inner], links: [k] });
  runs.forEach((r, k) => {
    const pts = onGround(r.pts);
    const mesh = new Mesh(ribbon(pts, ROAD * S, q => ground(q, 0.06), 1), roadMaterial); mesh.renderOrder = 4; mesh.raycast = () => {};
    const hit = new Mesh(ribbon(pts, 9 * S, q => ground(q, 0.06), 1), new MeshBasicMaterial({ visible: false, side: DoubleSide }));
    hit.name = `road:${k}`; hit.userData = { links: r.links, pts: r.pts };
    group.add(mesh, hit); roadHits.push(hit);
  });
  // A round end where a road starts, splits or ends, so its joins read as one line.
  const disc = (q: P, r: number, material: MeshBasicMaterial, order: number, up: number) => {
    const pts: number[] = [], c = to(q);
    for (let k = 0; k < 16; k++) { const a0 = k / 16 * Math.PI * 2, a1 = (k + 1) / 16 * Math.PI * 2; const q0 = { x: c.x + r * Math.cos(a0), z: c.z + r * Math.sin(a0) }, q1 = { x: c.x + r * Math.cos(a1), z: c.z + r * Math.sin(a1) }; pts.push(c.x, ground(c, up), c.z, q0.x, ground(q0, up), q0.z, q1.x, ground(q1, up), q1.z); }
    const geometry = new BufferGeometry(); geometry.setAttribute("position", new Float32BufferAttribute(pts, 3));
    const m = new Mesh(geometry, material); m.renderOrder = order; m.raycast = () => {}; return m;
  };
  for (const r of runs) for (const q of [r.pts[0]!, r.pts.at(-1)!]) group.add(disc(q, ROAD * S / 2, roadMaterial, 4, 0.06));

  // Gates: the gap itself, marked by a short ink tick across the outline at each end of it; an unseen box over the gap, so a
  // click on it is easy to land.
  const gateGroups = new Map<string, Group>();
  const tickMaterial = flat(PALETTE.ink, -6);
  for (const g of routed.gates.values()) {
    const gg = new Group(); gg.name = `gate:${g.key}`;
    const fill = tickMaterial.clone();
    for (const s of [-1, 1]) {
      const c = { x: g.at.x + g.along.x * GAP / 2 * s, z: g.at.z + g.along.z * GAP / 2 * s };
      const a = { x: c.x - g.out.x * TICK / 2, z: c.z - g.out.z * TICK / 2 }, b = { x: c.x + g.out.x * TICK / 2, z: c.z + g.out.z * TICK / 2 };
      const tick = new Mesh(ribbon(onGround([a, b]), TICK_W * S, q => ground(q, 0.1), 1), fill); tick.renderOrder = 7; tick.raycast = () => {};
      gg.add(tick);
    }
    const hit = new Mesh(new BoxGeometry(GAP * 1.3 * S, 2 * S, GAP * 1.3 * S), new MeshBasicMaterial({ visible: false, side: DoubleSide }));
    hit.position.copy(lift(g.at, 1)); hit.rotation.y = -Math.atan2(g.along.z, g.along.x);
    gg.add(hit);
    gg.userData = { fill, at: g.at };
    gateGroups.set(g.key, gg); group.add(gg);
  }

  // The page's own marks over the canvas, constant on screen as the map's names and flags are.
  const overlay = document.createElement("div");
  overlay.className = "mock-overlay";
  host.appendChild(overlay);
  type Spot = { el: HTMLElement; at: Vector3; name?: boolean; x?: number; y?: number };
  const spots: Spot[] = [];
  for (const c of data.capabilities) {
    const el = document.createElement("div");
    el.dataset.capability = c.id;
    el.className = "forest-label planet-nameplate capability mock-name";
    el.textContent = nameOf(c.title);
    overlay.appendChild(el);
    spots.push({ el, at: lift(patches.get(c.id)!), name: true });
  }
  // A wrench stands just inside a gate of the capability its work names: a gate from this story first, else one from the coast,
  // else, for a capability nothing calls, where its own road leaves it.
  const wrenches = new Map<string, Spot & { sample: boolean }>();
  const named = new Set(data.openWork.flatMap(w => w.capabilities));
  const sampleCapability = data.capabilities.find(c => c.title === SAMPLE.capability)?.id;
  const wrenchGate = new Map<string, string>();
  const wrenchAt = (capability: string): P => {
    const gs = [...routed.gates.values()].filter(g => g.patch === capability).sort((a, b) => (links.get(a.key)!.dock === undefined ? 0 : 1) - (links.get(b.key)!.dock === undefined ? 0 : 1) || a.at.z - b.at.z);
    const g = gs[0];
    if (g) { wrenchGate.set(capability, g.key); return { x: g.at.x - g.out.x * 5 + g.along.x * GAP * 1.1, z: g.at.z - g.out.z * 5 + g.along.z * GAP * 1.1 }; }
    const e = routed.exits.get(capability), p = patches.get(capability)!;
    if (e) return { x: e.at.x - e.out.x * 5 + 8, z: e.at.z - e.out.z * 5 };
    return p;
  };
  const makeWrench = (capability: string, sample: boolean) => {
    const el = document.createElement("div");
    el.className = `mock-wrench${sample ? " mock-wrench-sample" : ""}`;
    el.innerHTML = wrenchSvg(sample ? PALETTE.wrenchSample : PALETTE.wrench) + (sample ? `<span class="mock-wrench-tag">sample</span>` : "");
    overlay.appendChild(el);
    const at = wrenchAt(capability);
    const spot = { el, at: lift(sample ? { x: at.x + 14, z: at.z } : at, 0.1), sample };
    spots.push(spot);
    return spot;
  };
  for (const capability of named) if (patches.has(capability)) wrenches.set(capability, makeWrench(capability, false));
  const sampleWrench = sampleCapability === undefined ? undefined : makeWrench(sampleCapability, true);
  if (sampleWrench) sampleWrench.el.hidden = true;
  // Each dock: a dot where the roads come ashore, and what they carry.
  const dockInfo = dockAt.map((at, k) => {
    const carried = [...links.values()].filter(l => l.dock === k);
    const inbound = carried.filter(l => l.toStory === data.story.title), outbound = carried.filter(l => l.fromStory === data.story.title);
    const stories = [...new Set(inbound.map(l => l.fromStory))];
    const parts = [
      ...(inbound.length ? [stories.length === 1 ? `from ${stories[0]}` : `from ${stories.length} stories`] : []),
      ...(outbound.length ? [outbound.length === 1 ? `to ${outbound[0]!.toStory} · ${nameOf(outbound[0]!.toTitle)}` : `to ${new Set(outbound.map(l => l.toStory)).size} stories`] : []),
    ];
    return { at, label: parts.join(" · "), links: carried.map(l => l.key) };
  });
  dockInfo.forEach(d => {
    if (!d.links.length) return;
    const dot = document.createElement("div"); dot.className = "mock-road-end"; overlay.appendChild(dot);
    const at = new Vector3(d.at.x, heightAt(d.at) + S * 0.1, d.at.z);
    spots.push({ el: dot, at });
    const el = document.createElement("div"); el.className = "forest-label planet-nameplate capability mock-road-name"; el.textContent = d.label; overlay.appendChild(el);
    spots.push({ el, at, name: true });
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
      // A name stands centred on its place; a road's name beside its dot, to the right.
      const w = spot.el.offsetWidth, h = spot.el.offsetHeight, beside = spot.el.classList.contains("mock-road-name");
      const box = beside ? { l: spot.x! + 6, r: spot.x! + 6 + w, t: spot.y! - h / 2, b: spot.y! + h / 2 } : { l: spot.x! - w / 2, r: spot.x! + w / 2, t: spot.y! - h / 2, b: spot.y! + h / 2 };
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

  // Picking: a wrench by its icon on the page, then the gates and the roads in the scene, then the patch below.
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
      const nearest = (m: (typeof roads)[number]) => {
        const pts = onGround(m.object.userData.pts as P[]), q = m.point.clone().applyMatrix4(inverse);
        let d = Infinity;
        for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i]!, b = pts[i + 1]!, dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.z - a.z) * dz) / l)); d = Math.min(d, Math.hypot(q.x - a.x - t * dx, q.z - a.z - t * dz)); }
        return d;
      };
      const hit = [...roads].sort((a, b) => nearest(a) - nearest(b))[0]!.object;
      const carried = hit.userData.links as string[];
      return carried.length === 1 ? { kind: "link", id: carried[0]! } : { kind: "road", id: hit.name.slice(5), links: carried };
    }
    const under = raycaster.intersectObjects([...patchMeshes.values()], false)[0];
    const id = under?.object.name.slice("patch:".length);
    return id && own.has(id) ? { kind: "territory", id } : undefined;
  };
  const find = (kind: string, id: string): Picked | undefined => {
    if (kind === "territory") return own.has(id) ? { kind, id } : undefined;
    if (kind === "wrench") return id === sampleCapability && !wrenches.has(id) ? { kind, id, capability: id, sample: true } : wrenches.has(id) ? { kind, id, capability: id, sample: false } : undefined;
    if (kind === "gate") return gateGroups.has(id) ? { kind, id } : undefined;
    if (kind === "link") return routed.paths.has(id) ? { kind, id } : undefined;
    if (kind === "road") { const hit = roadHits.find(h => h.name === `road:${id}`); return hit ? { kind, id, links: hit.userData.links } : undefined; }
    return undefined;
  };

  // The pick lights in gold edged in ink: a patch's own dashed outline, a gate's ticks, and every road it names drawn over in
  // one gold line. Nothing is hidden or dimmed.
  const litFill = flat(PALETTE.lit, -5), litEdge = flat(PALETTE.litEdge, -4);
  const litDashed = flat(PALETTE.lit, -5, 1, dashTexture(PALETTE.lit, DASH_ON));
  const lit: Mesh[] = [];
  const highlight = (picked: Picked | undefined) => {
    for (const g of gateGroups.values()) (g.userData.fill as MeshBasicMaterial).color.set(PALETTE.ink);
    for (const w of [...wrenches.values(), ...(sampleWrench ? [sampleWrench] : [])]) w.el.classList.remove("lit");
    for (const m of lit.splice(0)) { group.remove(m); m.geometry.dispose(); }
    const add = (m: Mesh, order: number) => { m.renderOrder = order; m.raycast = () => {}; group.add(m); lit.push(m); };
    if (picked?.kind === "territory") for (const r of outlineRuns.get(picked.id) ?? []) add(new Mesh(ribbon(onGround(r), OUTLINE * 2.2 * S, q => ground(q, 0.12), DASH * S), litDashed), 6);
    if (picked?.kind === "wrench") (picked.sample ? sampleWrench : wrenches.get(picked.capability))?.el.classList.add("lit");
    const keys = picked?.kind === "link" ? [picked.id] : picked?.kind === "road" ? picked.links : picked?.kind === "gate" ? [picked.id] : [];
    const gateKey = picked?.kind === "gate" ? picked.id : picked?.kind === "link" && routed.gates.has(picked.id) ? picked.id : undefined;
    if (gateKey) (gateGroups.get(gateKey)!.userData.fill as MeshBasicMaterial).color.set(PALETTE.lit);
    for (const k of keys) {
      const pts = routed.paths.get(k);
      if (!pts) continue;
      add(new Mesh(ribbon(onGround(pts), (LIT + LIT_EDGE * 2) * S, q => ground(q, 0.14), 1), litEdge), 5);
      add(new Mesh(ribbon(onGround(pts), LIT * S, q => ground(q, 0.16), 1), litFill), 6);
    }
    state.invalidate();
  };

  const point = (kind: string, id: string) => {
    if (kind === "wrench") { const w = id.endsWith(":sample") ? sampleWrench : wrenches.get(id); if (!w) return undefined; const b = w.el.querySelector("svg")!.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height * 0.35 }; }
    if (kind === "gate") { const g = routed.gates.get(id); return g ? project(lift(g.at, 1)).page : undefined; }
    if (kind === "territory") { const p = patches.get(id); if (!p) return undefined; return project(lift({ x: p.x, z: p.z + Math.max(p.label.h / 2 + 4, p.half.h * 0.55) })).page; }
    // A link, or a road: the point along the run that carries it with the fewest others farthest from every gate and name.
    const hits = kind === "link" ? roadHits.filter(h => (h.userData.links as string[]).includes(id)).sort((a, b) => a.userData.links.length - b.userData.links.length)
      : roadHits.filter(h => h.name === `road:${id}`);
    const pts = hits[0]?.userData.pts as P[] | undefined;
    if (!pts) return undefined;
    const avoid = [...routed.gates.values()].map(g => g.at).concat([...patches.values()]);
    let bestAt: P | undefined, room = -1;
    for (let i = 1; i < pts.length; i++) for (let t = 0.1; t < 1; t += 0.2) {
      const p = along(pts[i - 1]!, pts[i]!, t), r = Math.min(...avoid.map(q => dist(p, q)));
      if (r > room) { room = r; bestAt = p; }
    }
    return bestAt ? project(lift(bestAt)).page : undefined;
  };

  const gates = new Map([...routed.gates].map(([k, g]) => [k, { key: k, town: g.patch, links: [k] }]));
  const stats = {
    scale: Math.round(S * 1000) / 1000, mirrored, plan: { w: Math.round(Math.max(...xs) - Math.min(...xs)), h: Math.round(Math.max(...zs) - Math.min(...zs)) }, layers: layers.map(l => l.map(id => nameOf(byId.get(id)!.title))), crossings, patches: patches.size,
    gates: routed.gates.size, gapsCut, links: links.size, inside: wants.filter(w => w.from.kind === "patch" && w.to.kind === "patch").length,
    arriving: wants.filter(w => w.from.kind === "dock").length, leaving: wants.filter(w => w.to.kind === "dock").length,
    unrouted: routed.unrouted, roadRuns: runs.length, docks: dockInfo.map(d => ({ label: d.label, links: d.links.length })), lanes: lanes.length,
    wrenches: [...wrenches.keys()].map(id => ({ capability: nameOf(byId.get(id)!.title), gate: wrenchGate.get(id) ?? "its way out" })),
  };

  return {
    pick, find, highlight, point, fills: [...fills.values()], stats, keepHidden: hideMap, links, gates, docks: dockInfo.map(d => ({ label: d.label, links: d.links })),
    roads: roadHits.map(h => ({ id: h.name.slice(5), links: h.userData.links as string[] })),
    // The plan itself, every name and both ends of the roads off the coast: the rest view is framed on what is drawn, not on
    // the empty land round it.
    extent() {
      state.camera.updateMatrixWorld(); root.updateMatrixWorld(true);
      const pts = [...patches.values()].flatMap(p => p.outline.filter((_, i) => i % 6 === 0)).map(q => project(lift(q)).page);
      for (const spot of spots) {
        const at = project(spot.at).page, w = spot.el.offsetWidth, h = spot.el.offsetHeight;
        const beside = spot.el.classList.contains("mock-road-name");
        pts.push({ x: beside ? at.x : at.x - w / 2, y: at.y - h / 2 }, { x: beside ? at.x + 6 + w : at.x + w / 2, y: at.y + h / 2 + 4 });
      }
      return { left: Math.min(...pts.map(c => c.x)), right: Math.max(...pts.map(c => c.x)), top: Math.min(...pts.map(c => c.y)) - 6, bottom: Math.max(...pts.map(c => c.y)) + 6 };
    },
    showSample(on) { if (sampleWrench) sampleWrench.el.hidden = !on; },
    dispose() { cancelAnimationFrame(frame); overlay.remove(); root.remove(group); },
  };
}
