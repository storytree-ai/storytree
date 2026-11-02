/** The mock's layer on the real island, laid in the island's own plate so it turns and tilts with it. The map's island, coast,
 * colours, glass and camera stay; on this island the mock hides the map's own territory cut and lays its plan (layout.ts) on the
 * same land instead, drawn as an inked map in 2.5D, in the claim flags' manner (packages/forest/src/view/claim-flag.ts):
 * - each capability a field in the map's health colour, edged by a low castle wall: an upright, flat-drawn cut-out with a
 *   pale band, crenellations and a thin ink outline, unlit and untextured;
 * - one gate in each field's wall: an opening between two small square towers, drawn the same way;
 * - the paths as dashed ink lines on the commons, one per linked pair, merging where they share a way;
 * - the road off the coast toward Keys, ending at a dot and its name;
 * - a wrench, a flat ink icon standing upright and constant on screen as a flag does, on each field open work names;
 * - each field's name, as the map names a territory (its plate's look), at its middle. */
import { BoxGeometry, BufferGeometry, CanvasTexture, Color, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Matrix4, Mesh,
  MeshBasicMaterial, Object3D, Raycaster, RepeatWrapping, SRGBColorSpace, Vector2, Vector3, type Camera } from "three";
import type { RootState } from "@react-three/fiber";
import { SAMPLE } from "./panel.js";
import { GAP, plan, type P } from "./layout.js";

export type Picked =
  | { kind: "territory"; id: string }
  | { kind: "path"; id: string; from: string; to: string; shared?: string[] }
  | { kind: "gate"; id: string }
  | { kind: "road"; id: string; from: string; to: string }
  | { kind: "wrench"; id: string; capability: string; sample: boolean };
export type Layer = {
  pick(x: number, y: number): Picked | undefined;
  find(kind: string, id: string): Picked | undefined;
  showSample(on: boolean): void;
  highlight(picked: Picked | undefined): void;
  /** Where a mark is on the page, in CSS pixels, for a capture to click. */
  point(kind: string, id: string): { x: number; y: number } | undefined;
  /** Each health the fields are filled with, and the map's colour for it. */
  fills: { word: string; colour: string }[];
  /** What was laid, counted: `mock.layer.stats` in the console. */
  stats: Record<string, unknown>;
  /** The plan's box on the page, in CSS pixels: the rest view is framed on it. */
  extent(): { left: number; right: number; top: number; bottom: number };
  /** Hides the map's own territory cut on this island again, should the map redraw it. */
  keepHidden(): void;
  dispose(): void;
};
type Capability = { id: string; title: string; lines: number; word: string; parked: boolean; dependsOn: { id: string; title: string; story: string; storyId: string }[] };
type Data = { story: { id: string }; capabilities: Capability[]; openWork: { capabilities: string[] }[] };

/** The ink map's palette (README.md lists it). */
export const PALETTE = {
  ink: "#1b1814", wall: "#ece4d0", commons: "#d9d1b9", path: "#6e5236", lit: "#ffd34d",
  wrench: "#e6e9ec", wrenchSample: "#d6bdf0", shadow: "#080b0e",
} as const;

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
const along = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
const nameOf = (title: string) => title.replace(/^\d+ · /, "");

/** The land as the map cut it, each territory's triangles: where the land is, its colours, and the ground's height. */
function landOf(land: Object3D) {
  const shapes: { id: string; tris: P[][]; box: [number, number, number, number]; colour: string; opacity: number }[] = [];
  const heights: [number, number][] = [];
  land.traverse(object => {
    if (!object.name.startsWith("territory:")) return;
    const mesh = object as Mesh, at = mesh.geometry.getAttribute("position"), tris: P[][] = [];
    for (let i = 0; i + 2 < at.count; i += 3) tris.push([0, 1, 2].map(k => ({ x: at.getX(i + k), z: at.getZ(i + k) })));
    for (let i = 0; i < at.count; i += 7) heights.push([at.getX(i) ** 2 + at.getZ(i) ** 2, at.getY(i)]);
    const xs = tris.flat().map(p => p.x), zs = tris.flat().map(p => p.z), material = mesh.material as MeshBasicMaterial;
    shapes.push({ id: object.name.slice("territory:".length), tris, box: [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)],
      colour: `#${material.color.getHexString()}`, opacity: material.opacity });
  });
  const inTri = (p: P, [a, b, c]: P[]) => {
    const s = (u: P, v: P) => (v.x - u.x) * (p.z - u.z) - (v.z - u.z) * (p.x - u.x);
    const d1 = s(a!, b!), d2 = s(b!, c!), d3 = s(c!, a!);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  const onLand = (p: P) => shapes.some(({ box: [x0, x1, z0, z1], tris }) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1 && tris.some(t => inTri(p, t)));
  // The plate's surface is a shallow dome: its height, fitted from the territories' own corners.
  let n = 0, sr = 0, sy = 0, srr = 0, sry = 0;
  for (const [r2, y] of heights) { n++; sr += r2; sy += y; srr += r2 * r2; sry += r2 * y; }
  const slope = n * srr - sr * sr === 0 ? 0 : (n * sry - sr * sy) / (n * srr - sr * sr), base = (sy - slope * sr) / n;
  return { shapes, onLand, heightAt: (p: P) => base + slope * (p.x * p.x + p.z * p.z) };
}

/** Triangles and an outline for a flat cut-out standing upright on the ground from `a` to `b`: the wall's band `h` high with
 * crenellations `m` higher, `merlon` wide, in the vertical plane through a and b. */
function cutOut(a: P, b: P, h: number, m: number, merlon: number, y: (p: P) => number) {
  const l = dist(a, b), tris: number[] = [], lines: number[] = [];
  const at = (u: number, up: number) => { const p = along(a, b, u / l); return [p.x, y(p) + up, p.z]; };
  const quad = (u0: number, u1: number, v0: number, v1: number) => tris.push(...at(u0, v0), ...at(u1, v0), ...at(u1, v1), ...at(u0, v0), ...at(u1, v1), ...at(u0, v1));
  const line = (u0: number, v0: number, u1: number, v1: number) => lines.push(...at(u0, v0), ...at(u1, v1));
  quad(0, l, 0, h);
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
function dashTexture(): CanvasTexture {
  const canvas = document.createElement("canvas"); canvas.width = 8; canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = PALETTE.path; ctx.fillRect(0, 4, 8, 34);
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
    if (Math.abs(cross) < 1e-9 * la * lc) { out.push(b); continue; }
    const k = Math.min(r, la / 2, lc / 2), p = along(b, a, k / la), q = along(b, c, k / lc);
    for (let t = 0; t <= 1; t += 0.2) { const u = along(p, b, t), w = along(b, q, t); out.push(along(u, w, t)); }
  }
  out.push(points.at(-1)!);
  return out;
}

/** The wrench: a flat ink icon, an open-ended spanner standing upright, in the claim flag's manner (pale fill, ink outline, a
 * shadow at its foot). Drawn as an SVG on the page, constant on screen, its foot on the field. */
function wrenchSvg(fill: string): string {
  return `<svg viewBox="-14 -40 28 44" width="28" height="44" aria-hidden="true">
    <ellipse cx="0" cy="1" rx="7" ry="2.6" fill="${PALETTE.shadow}" fill-opacity="0.45"/>
    <path d="M -2.2 0 L -2.2 -24 C -6.5 -25.5 -8.6 -29.5 -7.6 -33.6 L -3.4 -30.2 L 0.4 -31.6 L 1.6 -35.6 L -2.2 -38.6 C 2.4 -40.2 7.6 -36.6 7.4 -31.4 C 7.2 -27.9 5.2 -25.2 2.2 -24 L 2.2 0 Z"
      fill="${fill}" stroke="${PALETTE.ink}" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>`;
}

export function castleLayer(state: RootState, story: string, data: Data, host: HTMLElement): Layer {
  const plate = state.scene.getObjectByName(`planet:${story}`)!;
  const land = plate.getObjectByName("territory-land")!, root = land.parent!;
  const { shapes, onLand, heightAt } = landOf(land);
  const own = new Set(data.capabilities.map(({ id }) => id));
  const byId = new Map(data.capabilities.map(c => [c.id, c]));
  const fillOf = new Map(shapes.map(s => [s.id, s]));
  // The map's own cut of this island (its territory fills, borders, hatching and file dots) is pinned out of sight: the map
  // sets each one's visibility as it presents the land, so a setter that keeps it hidden is what holds.
  const hideMap = () => {
    land.traverse(mark => {
      if (mark === land || !/^(territory|file|claim)/.test(mark.name) || Object.getOwnPropertyDescriptor(mark, "visible")?.get) return;
      Object.defineProperty(mark, "visible", { get: () => false, set: () => {}, configurable: true });
    });
    state.invalidate();
  };
  hideMap();

  // The plan, fitted to the land: as large as it goes with its outer commons still on land, about the land's middle.
  const p = plan(data.capabilities);
  const middle = (() => {
    let ax = 0, az = 0, area = 0;
    for (const { tris } of shapes) for (const [a, b, c] of tris) { const s = Math.abs((b!.x - a!.x) * (c!.z - a!.z) - (c!.x - a!.x) * (b!.z - a!.z)) / 2; area += s; ax += s * (a!.x + b!.x + c!.x) / 3; az += s * (a!.z + b!.z + c!.z) / 3; }
    return { x: ax / area, z: az / area };
  })();
  const cx = (p.bounds.x0 + p.bounds.x1) / 2, cz = (p.bounds.z0 + p.bounds.z1) / 2;
  const edgeSamples: P[] = [];
  for (const e of p.edges) for (let t = 0; t <= 1; t += 0.1) edgeSamples.push(along(p.nodes[e.a]!, p.nodes[e.b]!, t));
  // The ring of commons outside the outer lines, half a gap wide, is on land too.
  for (const s of [...edgeSamples]) {
    const out = { x: s.x <= p.bounds.x0 + 1e-6 ? -1 : s.x >= p.bounds.x1 - 1e-6 ? 1 : 0, z: s.z <= p.bounds.z0 + 1e-6 ? -1 : s.z >= p.bounds.z1 - 1e-6 ? 1 : 0 };
    if (out.x || out.z) edgeSamples.push({ x: s.x + out.x * GAP / 2, z: s.z + out.z * GAP / 2 });
  }
  // The land as a grid, so the fit can ask about many points quickly.
  const reach = Math.max(...shapes.flatMap(sh => [Math.abs(sh.box[0]), Math.abs(sh.box[1]), Math.abs(sh.box[2]), Math.abs(sh.box[3])]));
  const N = 360, cellSize = reach * 2 / N, grid = new Uint8Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) grid[i * N + j] = onLand({ x: -reach + (i + 0.5) * cellSize, z: -reach + (j + 0.5) * cellSize }) ? 1 : 0;
  const landAt = (q: P) => { const i = Math.floor((q.x + reach) / cellSize), j = Math.floor((q.z + reach) / cellSize); return i >= 0 && j >= 0 && i < N && j < N && grid[i * N + j] === 1; };
  const place = (q: P, f: { s: number; ox: number; oz: number; turn: number }) => {
    const dx = q.x - cx, dz = q.z - cz, c = Math.cos(f.turn), sn = Math.sin(f.turn);
    return { x: middle.x + f.ox + (dx * c - dz * sn) * f.s, z: middle.z + f.oz + (dx * sn + dz * c) * f.s };
  };
  const fits = (f: { s: number; ox: number; oz: number; turn: number }) => edgeSamples.every(q => landAt(place(q, f)));
  // As large as it goes, square to the island's north so the columns stand upright and the names run across them, shifted
  // about the land's middle.
  let best = { s: 0, ox: 0, oz: 0, turn: 0 };
  for (let t = 0; t < 1; t++) for (const ox of [-0.16, -0.08, 0, 0.08, 0.16]) for (const oz of [-0.16, -0.08, 0, 0.08, 0.16]) {
    const trial = { s: 1e-6, ox: ox * reach, oz: oz * reach, turn: t * Math.PI / 12 };
    if (!fits(trial)) continue;
    let lo = 0, hi = reach * 4 / (p.bounds.x1 - p.bounds.x0);
    if (fits({ ...trial, s: best.s })) { lo = best.s; } else continue;
    for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; if (fits({ ...trial, s: mid })) lo = mid; else hi = mid; }
    if (lo > best.s) best = { ...trial, s: lo };
  }
  // Then nudged, finer, about the best.
  for (let round = 0; round < 3; round++) for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]) {
    const trial = { ...best, ox: best.ox + d[0]! * reach * 0.02, oz: best.oz + d[1]! * reach * 0.02, turn: best.turn + d[2]! * Math.PI / 72 };
    let lo = best.s, hi = best.s * 1.3;
    if (!fits({ ...trial, s: lo })) continue;
    for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2; if (fits({ ...trial, s: mid })) lo = mid; else hi = mid; }
    if (lo > best.s) best = { ...trial, s: lo };
  }
  // A little short of the most, so the outer commons keep a margin of land before the coast.
  best = { ...best, s: best.s * 0.97 };
  const S = best.s;
  const to = (q: P): P => place(q, best);

  // Sizes, from the commons' width on the land.
  const Gw = GAP * S;
  const H = Gw * 0.2, M = H * 0.6, MERLON = H * 1.1;
  const OPEN = Gw * 0.42, TOWER = H * 1.5, TOWER_H = H * 1.9;
  const PATH = Gw * 0.075, DASH = Gw * 0.26, TURN = Gw * 0.5;
  const lift = (q: P, up = 0) => new Vector3(q.x, heightAt(q) + up, q.z);
  const ground = (q: P) => heightAt(q) + H * 0.04;

  const group = new Group(); group.name = "mock-castle"; root.add(group);
  const inkMaterial = () => new LineBasicMaterial({ color: PALETTE.ink });
  const wallFill = new MeshBasicMaterial({ color: PALETTE.wall, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });

  // The commons: the island's land under the fields, a pale parchment, as a drawn map's land is.
  {
    const pos: number[] = [];
    for (const { tris } of shapes) for (const t of tris) for (const q of t) pos.push(q.x, heightAt(q) + H * 0.01, q.z);
    const geometry = new BufferGeometry(); geometry.setAttribute("position", new Float32BufferAttribute(pos, 3));
    const commons = new Mesh(geometry, new MeshBasicMaterial({ color: PALETTE.commons, side: DoubleSide, depthWrite: false }));
    commons.name = "mock-commons"; commons.renderOrder = 0.5; commons.raycast = () => {};
    group.add(commons);
  }
  // Fields: the map's colour for the capability's health, a flat square inside its wall.
  const fields = new Map<string, { mesh: Mesh; corners: P[]; centre: P; ink: LineBasicMaterial[] }>();
  for (const f of p.fields) {
    const h = f.side / 2, corners = [{ x: f.x - h, z: f.z - h }, { x: f.x + h, z: f.z - h }, { x: f.x + h, z: f.z + h }, { x: f.x - h, z: f.z + h }].map(to);
    const shape = fillOf.get(f.id), geometry = new BufferGeometry(), steps = 8, pos: number[] = [];
    // Split into a grid, so the square follows the dome.
    const pt = (i: number, j: number) => { const a = along(corners[0]!, corners[1]!, i / steps), b = along(corners[3]!, corners[2]!, i / steps), q = along(a, b, j / steps); return [q.x, heightAt(q) + H * 0.02, q.z]; };
    for (let i = 0; i < steps; i++) for (let j = 0; j < steps; j++) pos.push(...pt(i, j), ...pt(i + 1, j), ...pt(i + 1, j + 1), ...pt(i, j), ...pt(i + 1, j + 1), ...pt(i, j + 1));
    geometry.setAttribute("position", new Float32BufferAttribute(pos, 3));
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ color: shape?.colour ?? "#97c459", transparent: true, opacity: shape?.opacity ?? 0.8, side: DoubleSide, depthWrite: false }));
    mesh.name = `territory:${f.id}`; mesh.renderOrder = 1;
    group.add(mesh);
    fields.set(f.id, { mesh, corners, centre: to(f), ink: [] });
  }

  // Walls: a cut-out along each side of each field, its gate's side opened in the middle for the gate.
  const gateSide = (id: string) => { const f = p.fields.find(x => x.id === id)!; return { E: 1, S: 2, W: 3, N: 0 }[f.gate]; };
  const towerAt = new Map<string, P[]>();
  let wallLength = 0, merlons = 0;
  for (const [id, field] of fields) {
    const tris: number[] = [], lines: number[] = [], c = field.corners;
    const side = gateSide(id);
    for (let k = 0; k < 4; k++) {
      const a = c[k]!, b = c[(k + 1) % 4]!;
      const runs: [P, P][] = [];
      if (k === side) {
        const l = dist(a, b), half = (OPEN / 2 + TOWER / 2) / l;
        runs.push([a, along(a, b, 0.5 - half)], [along(a, b, 0.5 + half), b]);
        towerAt.set(id, [along(a, b, 0.5 - half), along(a, b, 0.5 + half)]);
      } else runs.push([a, b]);
      for (const [u, w] of runs) {
        const cut = cutOut(u, w, H, M, MERLON, ground);
        tris.push(...cut.tris); lines.push(...cut.lines);
        wallLength += dist(u, w); merlons += Math.max(1, Math.round((dist(u, w) / MERLON + 1) / 2));
      }
    }
    const geometry = new BufferGeometry(); geometry.setAttribute("position", new Float32BufferAttribute(tris, 3));
    const fill = new Mesh(geometry, wallFill); fill.renderOrder = 2; fill.raycast = () => {};
    const outline = new BufferGeometry(); outline.setAttribute("position", new Float32BufferAttribute(lines, 3));
    const ink = inkMaterial(), edge = new LineSegments(outline, ink); edge.renderOrder = 3; edge.raycast = () => {};
    field.ink.push(ink);
    const walls = new Group(); walls.name = `walls:${id}`; walls.add(fill, edge); group.add(walls);
  }

  // Gates: a small square tower each side of the opening, a box drawn flat (pale faces, ink edges, crenellated top).
  const gateGroups = new Map<string, Group>();
  for (const [id, [l, r]] of towerAt) {
    const g = new Group(); g.name = `gate:${id}`;
    const ink = inkMaterial();
    const [a, b] = [l!, r!], dir = { x: (b.x - a.x) / dist(a, b), z: (b.z - a.z) / dist(a, b) }, nrm = { x: -dir.z, z: dir.x };
    for (const t of [a, b]) {
      const h = TOWER / 2, sq = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([u, v]) => ({ x: t.x + dir.x * u! + nrm.x * v!, z: t.z + dir.z * u! + nrm.z * v! }));
      const tris: number[] = [], lines: number[] = [];
      for (let k = 0; k < 4; k++) { const cut = cutOut(sq[k]!, sq[(k + 1) % 4]!, TOWER_H, M, TOWER / 3, ground); tris.push(...cut.tris); lines.push(...cut.lines); }
      // Its roof, a flat square at the top of the band, so from above it reads solid.
      const y = (q: P) => ground(q) + TOWER_H - H * 0.01, top = sq.map(q => [q.x, y(q), q.z]);
      tris.push(...top[0]!, ...top[1]!, ...top[2]!, ...top[0]!, ...top[2]!, ...top[3]!);
      const geometry = new BufferGeometry(); geometry.setAttribute("position", new Float32BufferAttribute(tris, 3));
      const mesh = new Mesh(geometry, wallFill); mesh.renderOrder = 2; mesh.raycast = () => {};
      const outline = new BufferGeometry(); outline.setAttribute("position", new Float32BufferAttribute(lines, 3));
      const edge = new LineSegments(outline, ink); edge.renderOrder = 3; edge.raycast = () => {};
      g.add(mesh, edge);
    }
    // A box over the gate, unseen, so a click on it is easy to land.
    const mid = along(a, b, 0.5), top = TOWER_H + M;
    const hit = new Mesh(new BoxGeometry(OPEN + TOWER * 2.4, top, TOWER * 2.4), new MeshBasicMaterial({ visible: false, side: DoubleSide }));
    hit.position.copy(lift(mid, top / 2)); hit.rotation.y = -Math.atan2(dir.z, dir.x);
    g.add(hit);
    g.userData = { ink, at: mid };
    gateGroups.set(id, g); group.add(g);
  }

  // Paths: each stretch of the commons a way walks, drawn once as a dashed ink line, chained through corners where only two
  // stretches meet so the dashes run on.
  const texture = dashTexture();
  const carried = new Map<number, string[]>();
  for (const [key, way] of p.ways) for (const e of way.edges) carried.set(e, [...(carried.get(e) ?? []), key]);
  const degree = new Map<number, number>();
  for (const e of carried.keys()) for (const n of [p.edges[e]!.a, p.edges[e]!.b]) degree.set(n, (degree.get(n) ?? 0) + 1);
  const chains: { edges: number[]; nodes: number[] }[] = [], seen = new Set<number>();
  const sameLoad = (e: number, f: number) => carried.get(e)!.join() === carried.get(f)!.join();
  for (const start of carried.keys()) {
    if (seen.has(start)) continue;
    const chain = { edges: [start], nodes: [p.edges[start]!.a, p.edges[start]!.b] }; seen.add(start);
    for (const end of [1, 0]) for (;;) {
      const n = end ? chain.nodes.at(-1)! : chain.nodes[0]!;
      if (degree.get(n) !== 2) break;
      const next = [...carried.keys()].find(e => !seen.has(e) && (p.edges[e]!.a === n || p.edges[e]!.b === n));
      if (next === undefined || !sameLoad(next, start)) break;
      seen.add(next);
      const other = p.edges[next]!.a === n ? p.edges[next]!.b : p.edges[next]!.a;
      if (end) { chain.edges.push(next); chain.nodes.push(other); } else { chain.edges.unshift(next); chain.nodes.unshift(other); }
    }
    chains.push(chain);
  }
  const dashMaterial = new MeshBasicMaterial({ map: texture, transparent: true, side: DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const pathMeshes: Mesh[] = [];
  for (const chain of chains) {
    const pts = rounded(chain.nodes.map(n => to(p.nodes[n]!)), TURN);
    const mesh = new Mesh(ribbon(pts, PATH, ground, DASH), dashMaterial);
    mesh.renderOrder = 4; mesh.raycast = () => {};
    // A wider unseen ribbon over it takes the clicks.
    const hit = new Mesh(ribbon(pts, Gw * 0.45, ground, DASH), new MeshBasicMaterial({ visible: false, side: DoubleSide }));
    hit.name = `path:${carried.get(chain.edges[0]!)!.join(",")}`;
    hit.userData.edges = chain.edges;
    group.add(mesh, hit); pathMeshes.push(hit);
  }
  const wayPoints = (key: string) => { const w = p.ways.get(key)!; return rounded(w.nodes.map(n => to(p.nodes[n]!)), TURN); };

  // The road off the coast, for the link to another story's capability: along the commons to the outer line nearest that
  // island, then straight off the coast onto the glass, ending at a dot and the name of where it goes.
  const inverse = new Matrix4().copy(root.matrixWorld).invert();
  const roads = new Map<string, { points: P[]; hit: Mesh; end: P; label: string }>();
  for (const c of data.capabilities) for (const d of c.dependsOn.filter(d => !own.has(d.id))) {
    const other = state.scene.getObjectByName(`planet:${d.storyId}`);
    if (!other) continue;
    const there = other.getWorldPosition(new Vector3()).applyMatrix4(inverse), from = to(p.gates.get(c.id)!.at);
    const toward = { x: there.x - from.x, z: there.z - from.z }, l = Math.hypot(toward.x, toward.z);
    toward.x /= l; toward.z /= l;
    const fieldRects = [...fields.values()].map(f => f.corners);
    const inField = (q: P) => fieldRects.some(([a, , c2]) => q.x > Math.min(a!.x, c2!.x) && q.x < Math.max(a!.x, c2!.x) && q.z > Math.min(a!.z, c2!.z) && q.z < Math.max(a!.z, c2!.z));
    const candidates = p.nodes.map((n, i) => ({ i, q: to(n) })).sort((a, b) => (b.q.x * toward.x + b.q.z * toward.z) - (a.q.x * toward.x + a.q.z * toward.z));
    const gateNodes = new Set([...p.gates.values()].map(g => g.node));
    for (const { i, q } of candidates) {
      if (gateNodes.has(i)) continue;
      let r = 0, clear = true;
      while (onLand({ x: q.x + toward.x * r, z: q.z + toward.z * r }) && r < reach * 3) { if (inField({ x: q.x + toward.x * r, z: q.z + toward.z * r })) { clear = false; break; } r += Gw * 0.1; }
      if (!clear) continue;
      const way = p.shortest(p.gates.get(c.id)!.node, i);
      const coast = { x: q.x + toward.x * r, z: q.z + toward.z * r }, end = { x: coast.x + toward.x * Gw * 1.6, z: coast.z + toward.z * Gw * 1.6 };
      const top = heightAt(coast), points = [...rounded(way.nodes.map(n => to(p.nodes[n]!)), TURN), coast, end];
      const y = (u: P) => Math.max(heightAt(u), top) + H * 0.04;
      const mesh = new Mesh(ribbon(points, PATH, y, DASH), dashMaterial); mesh.renderOrder = 4; mesh.raycast = () => {};
      const hit = new Mesh(ribbon(points.slice(-3), Gw * 0.45, y, DASH), new MeshBasicMaterial({ visible: false, side: DoubleSide }));
      hit.name = `road:${c.id}->${d.id}`;
      group.add(mesh, hit);
      roads.set(`${c.id}->${d.id}`, { points, hit, end, label: `to ${d.story} · ${nameOf(d.title)}` });
      break;
    }
  }

  // The page's own marks over the canvas, constant on screen as the map's names and flags are: the fields' names, the wrenches
  // and the road's name.
  const overlay = document.createElement("div");
  overlay.className = "mock-overlay";
  host.appendChild(overlay);
  type Spot = { el: HTMLElement; at: Vector3; below?: Vector3; inside?: Vector3; field?: P[] };
  const spots: Spot[] = [];
  const names = new Map<string, Spot>(), names_ = names;
  for (const [id, field] of fields) {
    const el = document.createElement("div");
    el.dataset.capability = id;
    el.className = "forest-label planet-nameplate capability mock-name";
    el.textContent = nameOf(byId.get(id)!.title);
    overlay.appendChild(el);
    // In its field when it fits there; else just below the field's south wall, as a map names a small place beside it.
    const south = along(field.corners[3]!, field.corners[2]!, 0.5);
    const spot: Spot = { el, at: lift(field.centre, H * 0.1), below: lift(south, 0), inside: lift(field.centre, H * 0.1), field: field.corners };
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
    // It stands where the name is, and the name hangs just below its foot, as a claimed territory's does.
    const spot = { el, at: lift(fields.get(capability)!.centre, H * 0.1), sample };
    names.get(capability)!.el.dataset.claimed = "";
    spots.push(spot);
    return spot;
  };
  for (const capability of named) if (own.has(capability)) wrenches.set(capability, makeWrench(capability, false));
  const sampleWrench = sampleCapability === undefined ? undefined : makeWrench(sampleCapability, true);
  if (sampleWrench) { sampleWrench.el.hidden = true; if (!named.has(sampleCapability!)) delete names.get(sampleCapability!)!.el.dataset.claimed; }
  for (const [, road] of roads) {
    const dot = document.createElement("div"); dot.className = "mock-road-end"; overlay.appendChild(dot);
    spots.push({ el: dot, at: lift(road.end, H * 0.05) });
    const el = document.createElement("div"); el.className = "forest-label planet-nameplate capability mock-road-name"; el.textContent = road.label; overlay.appendChild(el);
    spots.push({ el, at: lift(road.end, H * 0.05) });
  }
  const project = (v: Vector3) => {
    const rect = state.gl.domElement.getBoundingClientRect(), hostRect = host.getBoundingClientRect();
    const w = v.clone().applyMatrix4(root.matrixWorld).project(state.camera as Camera);
    return { x: rect.left - hostRect.left + (w.x + 1) / 2 * rect.width, y: rect.top - hostRect.top + (1 - w.y) / 2 * rect.height, page: { x: rect.left + (w.x + 1) / 2 * rect.width, y: rect.top + (1 - w.y) / 2 * rect.height }, front: w.z < 1 };
  };
  let frame = 0;
  const follow = () => {
    for (const spot of spots) {
      if (spot.field && spot.below && spot.inside) {
        // The field's width on the page, across its middle, against the name's.
        const a = project(lift(along(spot.field[0]!, spot.field[3]!, 0.5))), b = project(lift(along(spot.field[1]!, spot.field[2]!, 0.5)));
        const fits = Math.abs(b.x - a.x) > spot.el.offsetWidth + 14 && spot.el.dataset.claimed === undefined;
        spot.at = fits ? spot.inside : spot.below;
        spot.el.classList.toggle("mock-name-below", !fits);
      }
      const at = project(spot.at);
      spot.el.style.transform = `translate(${at.x}px, ${at.y}px)`;
      spot.el.style.visibility = at.front ? "" : "hidden";
    }
    frame = requestAnimationFrame(follow);
  };
  follow();

  state.invalidate();

  // Picking: a wrench by its icon on the page, then the gates, the road and the paths in the scene, then the field below.
  const raycaster = new Raycaster();
  const hitOf = (object: Object3D | null): Picked | undefined => {
    for (let o = object; o; o = o.parent) {
      const [kind, ...rest] = o.name.split(":"), id = rest.join(":");
      if (kind === "gate") return { kind: "gate", id };
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
    for (const set of [[...gateGroups.values()], [...roads.values()].map(r => r.hit), pathMeshes]) {
      const marks = raycaster.intersectObjects(set, true);
      if (marks.length) return hitOf(marks[0]!.object);
    }
    const under = raycaster.intersectObjects([...fields.values()].map(f => f.mesh), false);
    return under.length ? hitOf(under[0]!.object) : undefined;
  };
  const find = (kind: string, id: string): Picked | undefined => {
    if (kind === "territory") return own.has(id) ? { kind, id } : undefined;
    if (kind === "wrench") return id === sampleCapability && !wrenches.has(id) ? { kind, id, capability: id, sample: true } : wrenches.has(id) ? { kind, id, capability: id, sample: false } : undefined;
    if (kind === "gate") return gateGroups.has(id) ? { kind, id } : undefined;
    const [from, to2] = id.split("->");
    if (kind === "path") {
      const key = p.ways.has(id) ? id : p.ways.has(`${to2}->${from}`) ? `${to2}->${from}` : undefined;
      if (!key) return undefined;
      const [f, t] = key.split("->");
      // A link is one path whichever way it is asked for; it is named by who calls whom.
      const callsIt = byId.get(f!)!.dependsOn.some(d => d.id === t);
      return { kind, id: key, from: callsIt ? f! : t!, to: callsIt ? t! : f! };
    }
    if (kind === "road" && roads.has(id)) return { kind, id, from: from!, to: to2! };
    return undefined;
  };

  // The pick lights in the selection's gold: a field's wall ink, a gate's towers, a way or the road drawn over in gold.
  const litMaterial = new MeshBasicMaterial({ color: PALETTE.lit, transparent: true, opacity: 0.95, side: DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  let lit: Mesh | undefined;
  const highlight = (picked: Picked | undefined) => {
    for (const f of fields.values()) for (const m of f.ink) m.color.set(PALETTE.ink);
    for (const g of gateGroups.values()) (g.userData.ink as LineBasicMaterial).color.set(PALETTE.ink);
    for (const w of [...wrenches.values(), ...(sampleWrench ? [sampleWrench] : [])]) w.el.classList.remove("lit");
    if (lit) { group.remove(lit); lit.geometry.dispose(); lit = undefined; }
    if (picked?.kind === "territory") for (const m of fields.get(picked.id)!.ink) m.color.set(PALETTE.lit);
    if (picked?.kind === "gate") (gateGroups.get(picked.id)!.userData.ink as LineBasicMaterial).color.set(PALETTE.lit);
    if (picked?.kind === "wrench") (picked.sample ? sampleWrench : wrenches.get(picked.capability))?.el.classList.add("lit");
    const line = picked?.kind === "path" ? wayPoints(picked.id) : picked?.kind === "road" ? roads.get(picked.id)?.points : undefined;
    if (line) { lit = new Mesh(ribbon(line, PATH * 1.6, q => ground(q) + H * 0.01, DASH), litMaterial); lit.renderOrder = 5; group.add(lit); }
    state.invalidate();
  };

  const point = (kind: string, id: string) => {
    if (kind === "wrench") { const w = id.endsWith(":sample") ? sampleWrench : wrenches.get(id); if (!w) return undefined; const b = w.el.querySelector("svg")!.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height * 0.35 }; }
    if (kind === "gate") { const g = gateGroups.get(id); return g ? project(lift(g.userData.at as P, TOWER_H / 2)).page : undefined; }
    if (kind === "territory") { const f = fields.get(id); if (!f) return undefined; return project(lift(along(f.corners[0]!, f.corners[2]!, 0.3))).page; }
    if (kind === "road") { const r = roads.get(id); return r ? project(lift(along(r.points.at(-2)!, r.points.at(-1)!, 0.4))).page : undefined; }
    if (kind === "path") {
      // The middle of the way's stretch that carries the fewest other ways.
      const way = p.ways.get(id); if (!way) return undefined;
      const e = [...way.edges].sort((a, b) => carried.get(a)!.length - carried.get(b)!.length || p.edges[b]!.length - p.edges[a]!.length)[0]!;
      return project(lift(along(to(p.nodes[p.edges[e]!.a]!), to(p.nodes[p.edges[e]!.b]!), 0.5))).page;
    }
    return undefined;
  };

  const fills = [...new Map(data.capabilities.map(c => {
    const word = c.parked ? "parked" : c.word, shape = fillOf.get(c.id);
    return [word, { word, colour: shape ? `#${new Color(shape.colour).getHexString()}` : "#97c459" }] as const;
  })).values()];
  const used = new Set([...carried.keys()]);
  const stats = {
    fields: fields.size, columns: Math.max(...p.fields.map(f => f.col)) + 1, gates: gateGroups.size,
    ways: p.ways.size, links: data.capabilities.reduce((s, c) => s + c.dependsOn.filter(d => own.has(d.id)).length, 0),
    stretches: used.size, sharedStretches: [...carried.values()].filter(k => k.length > 1).length, chains: chains.length,
    wallLength: Math.round(wallLength * 10) / 10, merlons, roads: roads.size, wrenches: wrenches.size,
    commonsWidth: Math.round(Gw * 100) / 100, fit: { middle, best, reach, bounds: p.bounds, land: shapes.map(s => s.box) }, scale: Math.round(S * 1000) / 1000,
    ways_: Object.fromEntries([...p.ways].map(([k, w]) => [k, w.edges.length])),
  };

  return {
    pick, find, highlight, point, fills, stats, keepHidden: hideMap,
    extent() {
      const corners = [{ x: p.bounds.x0, z: p.bounds.z0 }, { x: p.bounds.x1, z: p.bounds.z0 }, { x: p.bounds.x1, z: p.bounds.z1 }, { x: p.bounds.x0, z: p.bounds.z1 }].map(q => project(lift(to(q))).page);
      state.camera.updateMatrixWorld(); root.updateMatrixWorld(true);
      const names = [...names_.values()].map(n => { const c = project(n.at).page, w = n.el.offsetWidth / 2, h = n.el.offsetHeight / 2; return { left: c.x - w, right: c.x + w, top: c.y - h, bottom: c.y + h }; });
      for (const r of roads.values()) { const e = project(lift(r.end)).page; names.push({ left: e.x - 90, right: e.x + 90, top: e.y - 6, bottom: e.y + 24 }); }
      return { left: Math.min(...corners.map(c => c.x), ...names.map(b => b.left)), right: Math.max(...corners.map(c => c.x), ...names.map(b => b.right)),
        top: Math.min(...corners.map(c => c.y), ...names.map(b => b.top)), bottom: Math.max(...corners.map(c => c.y), ...names.map(b => b.bottom)) };
    },
    showSample(on) { if (sampleWrench) { sampleWrench.el.hidden = !on; if (!named.has(sampleCapability!)) { if (on) names.get(sampleCapability!)!.el.dataset.claimed = ""; else delete names.get(sampleCapability!)!.el.dataset.claimed; } } },
    dispose() { cancelAnimationFrame(frame); overlay.remove(); root.remove(group); },
  };
}
