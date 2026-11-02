/** The mock's layer on the real island: everything here is laid in the island's own plate, beside the map's territories, and
 * is read from what the map drew (its territory fills and its border lines), so it moves, turns and tilts with the island.
 * - a low drystone wall on every border between two territories (the map's white border lines), none on the coast;
 * - a cobbled pathway for each link between two of the story's capabilities, territory to territory through their gates;
 * - an arched stone gateway with an open wooden door where a pathway crosses a wall (one per pair of neighbours it joins);
 * - a cobbled road from a territory off the coast toward another story's island, for a link to its capability, with a signpost;
 * - a wrench on a territory's gate for the open work that names it;
 * The map's own name labels stay as they are. */
import { BufferGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, InstancedMesh,
  Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, Object3D, Raycaster, RepeatWrapping, SRGBColorSpace, Sprite, SpriteMaterial,
  TorusGeometry, BoxGeometry, Vector2, Vector3, type Camera, type Material } from "three";
import type { RootState } from "@react-three/fiber";
import { SAMPLE } from "./panel.js";

type P = { x: number; z: number };
type Seg = { from: P; to: P };
export type Picked =
  | { kind: "territory"; id: string }
  | { kind: "path"; id: string; from: string; to: string; shared?: string[] }
  | { kind: "gate"; id: string; pair: [string, string] }
  | { kind: "road"; id: string; from: string; to: string }
  | { kind: "wrench"; id: string; capability: string; sample: boolean };
export type Layer = {
  pick(x: number, y: number): Picked | undefined;
  find(kind: string, id: string): Picked | undefined;
  showSample(on: boolean): void;
  highlight(picked: Picked | undefined): void;
  /** Where a mark is on the page, in CSS pixels (the middle of a pathway's or road's cobbles), for a capture to click. */
  point(kind: string, id: string): { x: number; y: number } | undefined;
  /** Each health the island's territories are filled with, and the map's colour for it. */
  fills: { word: string; colour: string }[];
  /** What was laid, counted: shown in the console as `mock.layer.stats`. */
  stats: Record<string, unknown>;
};
type Capability = { id: string; title: string; dependsOn: { id: string; title: string; story: string; storyId: string }[] };
type Data = { story: { id: string }; capabilities: Capability[]; openWork: { capabilities: string[] }[] };

/** The stone's palette (README.md lists it). */
export const PALETTE = {
  stones: ["#8e8a80", "#a39d90", "#7c786f", "#b3ab9a", "#958d7d"], cap: "#bdb6a6",
  door: "#8a5a32", doorDark: "#5e3b20", cobble: "#e2d6b8", cobbleDark: "#b7a27c",
  wrench: "#c9d0d6", wrenchSample: "#c9a6e8", label: "#f4ecd8", labelInk: "#3b3428", lit: "#ffd34d",
} as const;

const along = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
function segDist(p: P, { from: a, to: b }: Seg): number {
  const dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz;
  const t = l === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}
/** A deterministic random, so the walls are laid the same on every open. */
function random(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

/** The territories as the map filled them: each one's triangles on the ground, by capability ("unclaimed" for none). */
function territoriesOf(plate: Object3D) {
  const shapes: { id: string; tris: P[][]; box: [number, number, number, number]; mesh: Mesh }[] = [];
  plate.traverse(object => {
    if (!object.name.startsWith("territory:")) return;
    const mesh = object as Mesh, at = mesh.geometry.getAttribute("position"), tris: P[][] = [];
    for (let i = 0; i + 2 < at.count; i += 3) tris.push([0, 1, 2].map(k => ({ x: at.getX(i + k), z: at.getZ(i + k) })));
    const xs = tris.flat().map(p => p.x), zs = tris.flat().map(p => p.z);
    shapes.push({ id: object.name.slice("territory:".length), tris, box: [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)], mesh });
  });
  const inTri = (p: P, [a, b, c]: P[]) => {
    const s = (u: P, v: P) => (v.x - u.x) * (p.z - u.z) - (v.z - u.z) * (p.x - u.x);
    const d1 = s(a!, b!), d2 = s(b!, c!), d3 = s(c!, a!);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  const at = (p: P): string | undefined => shapes.find(({ box: [x0, x1, z0, z1], tris }) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1 && tris.some(t => inTri(p, t)))?.id;
  return { shapes, at };
}

/** A text label as a sprite, standing upright to the eye at any turn or tilt. */
function label(text: string, height: number, { ink = PALETTE.labelInk, paper = PALETTE.label, bold = true } = {}): Sprite {
  const scale = 4, font = `${bold ? "600 " : ""}${22 * scale}px ui-sans-serif, system-ui, sans-serif`;
  const measure = document.createElement("canvas").getContext("2d")!; measure.font = font;
  const w = Math.ceil(measure.measureText(text).width) + 20 * scale, h = 32 * scale;
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = paper; ctx.strokeStyle = ink; ctx.lineWidth = 2 * scale;
  ctx.beginPath(); ctx.roundRect(scale, scale, w - 2 * scale, h - 2 * scale, 9 * scale); ctx.fill(); ctx.stroke();
  ctx.fillStyle = ink; ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, w / 2, h / 2 + scale);
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set(height * w / h, height, 1);
  sprite.renderOrder = 20;
  return sprite;
}

/** Cobbles in packed earth, drawn once, repeated along every pathway. */
function cobbles(): CanvasTexture {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!, rand = random(7);
  ctx.fillStyle = PALETTE.cobbleDark; ctx.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 6; row++) for (let col = 0; col < 6; col++) {
    const x = col * 22 + (row % 2) * 11 + rand() * 4, y = row * 22 + rand() * 4, r = 8 + rand() * 2.5;
    ctx.fillStyle = new Color(PALETTE.cobble).offsetHSL(0, 0, (rand() - 0.5) * 0.12).getStyle();
    for (const dx of [-128, 0, 128]) for (const dy of [-128, 0, 128]) { ctx.beginPath(); ctx.ellipse(x + dx, y + dy, r, r * 0.85, rand(), 0, Math.PI * 2); ctx.fill(); }
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping; texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A flat ribbon `width` wide along `points` on the ground, its texture repeating every `width` along it. */
function ribbon(points: P[], width: number, y: (p: P) => number, material: Material): Mesh {
  const positions: number[] = [], uvs: number[] = [], index: number[] = [];
  let run = 0;
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)]!, b = points[Math.min(points.length - 1, i + 1)]!;
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l * width / 2, nz = dx / l * width / 2;
    if (i > 0) run += dist(points[i - 1]!, p);
    positions.push(p.x + nx, y(p), p.z + nz, p.x - nx, y(p), p.z - nz);
    uvs.push(0, run / width, 1, run / width);
    if (i > 0) { const k = 2 * i; index.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return new Mesh(geometry, material);
}

/** A smooth line through `points`, sampled every `step`. */
function smooth(points: P[], step: number): P[] {
  if (points.length < 3) return points.length < 2 ? points : sampleLine(points[0]!, points[1]!, step);
  const out: P[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!, p1 = points[i]!, p2 = points[i + 1]!, p3 = points[Math.min(points.length - 1, i + 2)]!;
    const n = Math.max(2, Math.ceil(dist(p1, p2) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  out.push(points.at(-1)!);
  return out;
}
function sampleLine(a: P, b: P, step: number): P[] {
  const n = Math.max(2, Math.ceil(dist(a, b) / step));
  return Array.from({ length: n + 1 }, (_, k) => along(a, b, k / n));
}

export function stoneLayer(state: RootState, story: string, data: Data): Layer {
  const plate = state.scene.getObjectByName(`planet:${story}`)!;
  const land = plate.getObjectByName("territory-land")!, root = land.parent!, borders = land.getObjectByName("territory-borders")!;
  const { shapes, at } = territoriesOf(land);
  const own = new Set(data.capabilities.map(({ id }) => id));
  const titleOf = new Map(data.capabilities.map(({ id, title }) => [id, title]));

  // The ground's height under a point, fitted from the map's own border lines (the plate's surface is a shallow dome).
  const ground = borders.userData.ground as number[], pos = (borders as Mesh).geometry.getAttribute("position");
  let n = 0, sr = 0, sy = 0, srr = 0, sry = 0;
  for (let i = 0; i < pos.count; i++) { const r2 = pos.getX(i) ** 2 + pos.getZ(i) ** 2, y = pos.getY(i); n++; sr += r2; sy += y; srr += r2 * r2; sry += r2 * y; }
  const slope = n * srr - sr * sr === 0 ? 0 : (n * sry - sr * sy) / (n * srr - sr * sr), base = (sy - slope * sr) / n;
  const heightAt = (p: P) => base + slope * (p.x * p.x + p.z * p.z);
  const segs: Seg[] = [];
  for (let i = 0; i + 3 < ground.length; i += 4) segs.push({ from: { x: ground[i]!, z: ground[i + 1]! }, to: { x: ground[i + 2]!, z: ground[i + 3]! } });
  const reach = Math.max(...segs.flatMap(({ from, to }) => [Math.hypot(from.x, from.z), Math.hypot(to.x, to.z)]));
  // The wall's size, in the plate's ground units, from the island's reach.
  const H = reach * 0.014, W = H * 0.8, EPS = reach * 0.004;

  // Which two territories each border line runs between (a coast line, with land on one side only, gets no wall).
  const walls: (Seg & { a: string; b: string; key: string; length: number })[] = [];
  for (const seg of segs) {
    const m = along(seg.from, seg.to, 0.5), dx = seg.to.x - seg.from.x, dz = seg.to.z - seg.from.z, l = Math.hypot(dx, dz);
    if (l < 1e-6) continue;
    const a = at({ x: m.x - dz / l * EPS, z: m.z + dx / l * EPS }), b = at({ x: m.x + dz / l * EPS, z: m.z - dx / l * EPS });
    if (a === undefined || b === undefined || a === b) continue;
    walls.push({ ...seg, a, b, key: [a, b].sort().join("|"), length: l });
  }
  const neighbours = new Map<string, Set<string>>();
  for (const { a, b } of walls) { (neighbours.get(a) ?? neighbours.set(a, new Set()).get(a)!).add(b); (neighbours.get(b) ?? neighbours.set(b, new Set()).get(b)!).add(a); }

  // Each territory's seat: the point on it farthest from its walls and its coast, where its pathways meet and its number stands.
  const onLand = (p: P) => at(p) !== undefined;
  const seats = new Map<string, P>();
  for (const { id, box: [x0, x1, z0, z1] } of shapes) {
    const step = Math.max((x1 - x0) / 24, (z1 - z0) / 24, reach / 200);
    let best: P | undefined, score = -1;
    for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) {
      const p = { x, z };
      if (at(p) !== id) continue;
      let clear = Math.min(...walls.filter(w => w.a === id || w.b === id).map(w => segDist(p, w)), Infinity);
      for (let k = 0; k < 12 && clear > 0; k++) {
        const angle = k * Math.PI / 6;
        for (let r = step / 2; r < clear; r += step / 2) if (!onLand({ x: x + Math.cos(angle) * r, z: z + Math.sin(angle) * r })) { clear = r; break; }
      }
      if (clear > score) { score = clear; best = p; }
    }
    if (best) seats.set(id, best);
  }

  // The links: a pathway per capability link inside the story, territory to territory through the fewest walls.
  const route = (from: string, to: string): string[] | undefined => {
    const back = new Map<string, string>([[from, from]]), queue = [from];
    while (queue.length) { const c = queue.shift()!; if (c === to) break; for (const m of neighbours.get(c) ?? []) if (!back.has(m) && own.has(m)) { back.set(m, c); queue.push(m); } }
    if (!back.has(to)) return undefined;
    const way = [to]; while (way[0] !== from) way.unshift(back.get(way[0]!)!);
    return way;
  };
  const links = data.capabilities.flatMap(c => c.dependsOn.filter(d => own.has(d.id)).map(d => ({ from: c.id, to: d.id, way: route(c.id, d.id) })));
  // Where each territory reaches the coast: the shortest way from its seat off the land that crosses no other territory.
  const exits = new Map<string, { dir: P; r: number }>();
  for (const [id, seat] of seats) for (let k = 0; k < 72; k++) {
    const dir = { x: Math.cos(k * Math.PI / 36), z: Math.sin(k * Math.PI / 36) };
    let r = 0, here: string | undefined = id;
    while (here === id && r < reach * 2) { r += H * 0.25; here = at({ x: seat.x + dir.x * r, z: seat.z + dir.z * r }); }
    if (here === undefined && r < (exits.get(id)?.r ?? Infinity)) exits.set(id, { dir, r });
  }
  // A link to another story's capability leaves by the coast: through the fewest walls to a territory on the coast, and of
  // those the one whose shore faces that story's island.
  const inverse = new Matrix4().copy(root.matrixWorld).invert();
  const roadWays = data.capabilities.flatMap(c => c.dependsOn.filter(d => !own.has(d.id)).flatMap(d => {
    const other = state.scene.getObjectByName(`planet:${d.storyId}`), seat = seats.get(c.id);
    if (!other || !seat) return [];
    const there = other.getWorldPosition(new Vector3()).applyMatrix4(inverse), l = Math.hypot(there.x - seat.x, there.z - seat.z);
    const toward = { x: (there.x - seat.x) / l, z: (there.z - seat.z) / l };
    let level = [c.id];
    const back = new Map<string, string>([[c.id, c.id]]);
    while (level.length && !level.some(id => exits.has(id))) {
      const next: string[] = [];
      for (const id of level) for (const m of neighbours.get(id) ?? []) if (!back.has(m) && own.has(m)) { back.set(m, id); next.push(m); }
      level = next;
    }
    const shore = level.filter(id => exits.has(id)).sort((a, b) => (exits.get(b)!.dir.x * toward.x + exits.get(b)!.dir.z * toward.z) - (exits.get(a)!.dir.x * toward.x + exits.get(a)!.dir.z * toward.z))[0];
    if (shore === undefined) return [];
    const way = [shore]; while (way[0] !== c.id) way.unshift(back.get(way[0]!)!);
    return [{ from: c.id, to: d.id, dep: d, way, exit: exits.get(shore)! }];
  }));
  // A gate on the longest wall between each pair of neighbours a pathway passes between.
  const gates = new Map<string, { key: string; pair: [string, string]; wall: (typeof walls)[number]; at: P; width: number }>();
  for (const { way } of [...links, ...roadWays]) for (let i = 0; way && i < way.length - 1; i++) {
    const key = [way[i]!, way[i + 1]!].sort().join("|");
    if (gates.has(key)) continue;
    const wall = walls.filter(w => w.key === key).sort((p, q) => q.length - p.length)[0]!;
    gates.set(key, { key, pair: key.split("|") as [string, string], wall, at: along(wall.from, wall.to, 0.5), width: Math.min(wall.length * 0.7, H * 2.6) });
  }

  const group = new Group(); group.name = "mock-stone"; root.add(group);
  const lift = (p: P, up = 0) => new Vector3(p.x, heightAt(p) + up, p.z);
  const rand = random(1);
  const stone = new BoxGeometry(1, 1, 1);
  const stoneMaterial = new MeshLambertMaterial({ color: "#ffffff" });

  // Walls: two courses of rough stones and a row of capstones along each border line, gapped where a gate stands.
  const placements: { m: Matrix4; colour: string }[] = [];
  const up = new Vector3(0, 1, 0), dummy = new Object3D();
  const layStones = (a: P, b: P, courses: number, height: number) => {
    const l = dist(a, b), dir = Math.atan2(b.z - a.z, b.x - a.x);
    const size = height / (courses + 0.6);
    for (let c = 0; c < courses + 1; c++) {
      const cap = c === courses, len = cap ? size * 1.1 : size * 1.6, count = Math.max(1, Math.round(l / len));
      for (let k = 0; k < count; k++) {
        const t = (k + 0.5 + (c % 2 ? 0.35 : 0) * (k < count - 1 ? 1 : 0)) / count, p = along(a, b, Math.min(t, 1));
        dummy.position.copy(lift(p, size * (0.5 + c)));
        dummy.quaternion.setFromAxisAngle(up, -dir + (rand() - 0.5) * 0.12);
        dummy.rotateX((rand() - 0.5) * 0.12); dummy.rotateZ((rand() - 0.5) * 0.12);
        const s = size;
        dummy.scale.set(len * (0.86 + rand() * 0.1), s * (cap ? 0.9 : 1.05 + rand() * 0.2), W * (cap ? 1.05 : 0.9 + rand() * 0.15));
        dummy.updateMatrix();
        placements.push({ m: dummy.matrix.clone(), colour: cap ? PALETTE.cap : PALETTE.stones[Math.floor(rand() * PALETTE.stones.length)]! });
      }
    }
  };
  const gateOn = new Map([...gates.values()].map(g => [g.wall, g]));
  for (const wall of walls) {
    const gate = gateOn.get(wall);
    if (!gate) { layStones(wall.from, wall.to, 3, H); continue; }
    const half = gate.width / 2 / wall.length;
    layStones(wall.from, along(wall.from, wall.to, 0.5 - half), 3, H);
    layStones(along(wall.from, wall.to, 0.5 + half), wall.to, 3, H);
  }

  // Gates: two stacked-stone piers, an arch of stones over them, and a plank door swung open on one pier.
  const gateGroups = new Map<string, Group>();
  const doorMaterial = new MeshStandardMaterial({ color: PALETTE.door, roughness: 0.9 }), bandMaterial = new MeshStandardMaterial({ color: PALETTE.doorDark, roughness: 0.8 });
  for (const gate of gates.values()) {
    const g = new Group(), { wall } = gate, dir = Math.atan2(wall.to.z - wall.from.z, wall.to.x - wall.from.x);
    g.position.copy(lift(gate.at)); g.rotation.y = -dir; g.name = `gate:${gate.key}`;
    const pierH = H * 1.7, pierW = W * 1.25, span = gate.width;
    for (const side of [-1, 1]) for (let c = 0; c < 4; c++) {
      dummy.position.set(side * (span / 2 + pierW / 2), pierH * (c + 0.5) / 4, 0);
      dummy.rotation.set(0, (rand() - 0.5) * 0.15, 0); dummy.scale.set(pierW, pierH / 4 * 0.96, pierW); dummy.updateMatrix();
      placements.push({ m: new Matrix4().multiplyMatrices(gateMatrix(g), dummy.matrix), colour: PALETTE.stones[(c + (side > 0 ? 2 : 0)) % PALETTE.stones.length]! });
    }
    const radius = span / 2 + pierW / 2, stones = 9;
    for (let k = 0; k < stones; k++) {
      const a = Math.PI * (k + 0.5) / stones;
      dummy.position.set(-Math.cos(a) * radius, pierH + Math.sin(a) * radius * 0.8, 0);
      dummy.rotation.set(0, 0, a - Math.PI / 2); dummy.scale.set(Math.PI * radius / stones * 0.92, pierW * 0.9, pierW * 0.95); dummy.updateMatrix();
      placements.push({ m: new Matrix4().multiplyMatrices(gateMatrix(g), dummy.matrix), colour: k === (stones - 1) / 2 ? PALETTE.cap : PALETTE.stones[k % PALETTE.stones.length]! });
    }
    const door = new Group(), plank = new Mesh(new BoxGeometry(span * 0.95, pierH * 0.82, W * 0.12), doorMaterial);
    plank.position.set(span * 0.475, pierH * 0.41, 0); door.add(plank);
    for (const y of [0.18, 0.64]) { const band = new Mesh(new BoxGeometry(span * 0.95, pierH * 0.06, W * 0.14), bandMaterial); band.position.set(span * 0.475, pierH * y, 0); door.add(band); }
    door.position.set(-span / 2, 0, 0); door.rotation.y = -1.25; g.add(door);
    // A wider invisible box over the gate, so a click on it is easy to land.
    g.add(hitBox(span + pierW * 2, pierH + span / 2 + pierW, W * 3, 0));
    gateGroups.set(gate.key, g); group.add(g);
  }
  function gateMatrix(g: Group) { g.updateMatrix(); return g.matrix; }

  const walling = new InstancedMesh(stone, stoneMaterial, placements.length);
  placements.forEach(({ m, colour }, i) => { walling.setMatrixAt(i, m); walling.setColorAt(i, new Color(colour)); });
  walling.name = "mock-walls"; walling.raycast = () => {};
  group.add(walling);

  // Pathways: cobbles from seat to gate to seat, a hand's breadth above the land so they read over its colours.
  const PATH = H * 1.35, texture = cobbles();
  // Unlit, as the land is: the cobbles keep their colour at every tilt.
  const pathMaterial = () => new MeshBasicMaterial({ map: texture, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
  const paths = new Map<string, Mesh>();
  // A way from seat to seat, through the gate between each pair of neighbours, met square to its wall so the cobbles pass
  // under the arch; ways that share a stretch share its cobbles.
  const wayPoints = (way: string[]): P[] => {
    const pts: P[] = [seats.get(way[0]!)!];
    for (let i = 0; i < way.length - 1; i++) {
      const gate = gates.get([way[i]!, way[i + 1]!].sort().join("|"))!, w = gate.wall, dx = w.to.x - w.from.x, dz = w.to.z - w.from.z, l = Math.hypot(dx, dz);
      const seat = seats.get(way[i]!)!, side = (seat.x - gate.at.x) * -dz / l + (seat.z - gate.at.z) * dx / l > 0 ? 1 : -1, out = H * 1.6;
      pts.push({ x: gate.at.x - dz / l * out * side, z: gate.at.z + dx / l * out * side }, gate.at, { x: gate.at.x + dz / l * out * side, z: gate.at.z - dx / l * out * side }, seats.get(way[i + 1]!)!);
    }
    return pts;
  };
  for (const { from, to, way } of links) {
    if (!way) continue;
    const pts = wayPoints(way);
    const mesh = ribbon(smooth(pts, H * 0.4), PATH, p => heightAt(p) + H * 0.06, pathMaterial());
    mesh.name = `path:${from}->${to}`; mesh.renderOrder = 3;
    paths.set(`${from}->${to}`, mesh); group.add(mesh);
  }

  // A road off the coast for each link to another story's capability: from the territory's seat toward that island, past the
  // coast onto the glass, ending at a signpost naming where it goes.
  const roads = new Map<string, Group>();
  for (const { from, to, dep, way, exit } of roadWays) {
    const shoreSeat = seats.get(way.at(-1)!)!, coast = { x: shoreSeat.x + exit.dir.x * exit.r, z: shoreSeat.z + exit.dir.z * exit.r };
    const end = { x: coast.x + exit.dir.x * reach * 0.1, z: coast.z + exit.dir.z * reach * 0.1 }, top = heightAt(coast);
    const g = new Group(); g.name = `road:${from}->${to}`;
    const mesh = ribbon([...smooth(wayPoints(way), H * 0.4), ...sampleLine(shoreSeat, end, H * 0.4).slice(1)], PATH, p => Math.max(heightAt(p), top) + H * 0.06, pathMaterial());
    mesh.renderOrder = 3; g.add(mesh);
    const post = new Mesh(new CylinderGeometry(H * 0.14, H * 0.16, H * 4, 6), doorMaterial);
    post.position.set(end.x, top + H * 2, end.z); g.add(post);
    const sign = label(`to ${dep.story} · ${dep.title}`, H * 2.4, { paper: "#e9d9b4" });
    sign.position.copy(post.position).add(new Vector3(0, H * 3.4, 0)); g.add(sign);
    const hit = hitBox(H * 3, H * 7, H * 3, 0); hit.position.set(end.x, top, end.z); g.add(hit);
    roads.set(`${from}->${to}`, g); group.add(g);
  }

  // Wrenches: one on each territory that open work names, over the gate its own pathway leaves by, else its busiest gate.
  const wrenchAt = (capability: string): P => {
    const out = links.find(l => l.from === capability && l.way && l.way.length > 1);
    const first = out ? gates.get([out.way![0]!, out.way![1]!].sort().join("|")) : [...gates.values()].find(g => g.pair.includes(capability));
    return first?.at ?? seats.get(capability)!;
  };
  const wrenches = new Map<string, Group>();
  const named = new Set(data.openWork.flatMap(w => w.capabilities));
  const sampleCapability = data.capabilities.find(c => c.title === SAMPLE.capability)?.id;
  const makeWrench = (capability: string, sample: boolean) => {
    const g = new Group(), metal = new MeshLambertMaterial({ color: sample ? PALETTE.wrenchSample : PALETTE.wrench, emissive: sample ? PALETTE.wrenchSample : PALETTE.wrench, emissiveIntensity: 0.35 });
    const s = H * 3.4;
    const handle = new Mesh(new BoxGeometry(s * 0.28, s * 2.1, s * 0.14), metal); handle.position.y = -s * 0.2; g.add(handle);
    const head = new Mesh(new TorusGeometry(s * 0.45, s * 0.17, 6, 16, Math.PI * 1.45), metal); head.position.y = s * 1.15; head.rotation.z = -Math.PI * 0.22; g.add(head);
    const tail = new Mesh(new TorusGeometry(s * 0.22, s * 0.1, 6, 12), metal); tail.position.y = -s * 1.25; g.add(tail);
    g.rotation.z = Math.PI / 5;
    const holder = new Group(); holder.add(g);
    const p = wrenchAt(capability);
    holder.position.copy(lift(p, H * 8));
    if (sample) { const tag = label("sample", H * 1.1, { paper: "#efe2fb", ink: "#5b3d7a" }); tag.position.set(0, s * 2.1, 0); holder.add(tag); }
    holder.add(hitBox(s * 2.2, s * 3.6, s * 2.2, 0));
    holder.name = `wrench:${capability}${sample ? ":sample" : ""}`;
    group.add(holder);
    return holder;
  };
  for (const capability of named) if (own.has(capability)) wrenches.set(capability, makeWrench(capability, false));
  const sampleWrench = sampleCapability === undefined ? undefined : makeWrench(sampleCapability, true);
  if (sampleWrench) sampleWrench.visible = false;

  state.invalidate();

  // Picking: the mock's own marks first (wrenches, gates, roads, pathways), then the territory under the pointer.
  const raycaster = new Raycaster();
  const hitOf = (object: Object3D | null): Picked | undefined => {
    for (let o = object; o; o = o.parent) {
      const [kind, ...rest] = o.name.split(":"), id = rest.join(":");
      if (kind === "wrench") return { kind: "wrench", id: rest[0]!, capability: rest[0]!, sample: rest[1] === "sample" };
      if (kind === "gate") return { kind: "gate", id, pair: id.split("|") as [string, string] };
      if (kind === "road") { const [from, to] = id.split("->"); return { kind: "road", id, from: from!, to: to! }; }
      if (kind === "path") { const [from, to] = id.split("->"); return { kind: "path", id, from: from!, to: to! }; }
      if (kind === "territory" && own.has(id)) return { kind: "territory", id };
    }
    return undefined;
  };
  const pick = (x: number, y: number): Picked | undefined => {
    const rect = state.gl.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new Vector2((x - rect.left) / rect.width * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1), state.camera as Camera);
    const marks = raycaster.intersectObjects([...wrenches.values(), ...(sampleWrench?.visible ? [sampleWrench] : []), ...gateGroups.values(), ...roads.values(), ...paths.values()], true);
    if (marks.length) {
      const first = hitOf(marks[0]!.object);
      // A stretch several pathways share: the others it carries, so the panel can list them.
      if (first?.kind === "path") {
        const shared = [...new Set(marks.filter(m => m.distance - marks[0]!.distance < H * 0.5).map(m => hitOf(m.object)).filter(p => p?.kind === "path" && p.id !== first.id).map(p => p!.id))];
        if (shared.length) return { ...first, shared };
      }
      return first;
    }
    const land = raycaster.intersectObjects(shapes.map(s => s.mesh), false);
    return land.length ? hitOf(land[0]!.object) : undefined;
  };
  const find = (kind: string, id: string): Picked | undefined => {
    if (kind === "territory") return own.has(id) ? { kind, id } : undefined;
    if (kind === "wrench") return id === sampleCapability && !wrenches.has(id) ? { kind, id, capability: id, sample: true } : wrenches.has(id) ? { kind, id, capability: id, sample: false } : undefined;
    if (kind === "gate") return gates.has(id) ? { kind, id, pair: id.split("|") as [string, string] } : undefined;
    const [from, to] = id.split("->");
    if (kind === "path" && paths.has(id)) return { kind, id, from: from!, to: to! };
    if (kind === "road" && roads.has(id)) return { kind, id, from: from!, to: to! };
    return undefined;
  };

  // The picked mark is lit in the selection's gold: a pathway or road's cobbles, a gate's door, a wrench's steel.
  const lit = new Map<Mesh, Material>();
  const highlight = (picked: Picked | undefined) => {
    for (const [mesh, material] of lit) mesh.material = material;
    lit.clear();
    const object = !picked ? undefined : picked.kind === "path" ? paths.get(picked.id) : picked.kind === "road" ? roads.get(picked.id) : picked.kind === "gate" ? gateGroups.get(picked.id)
      : picked.kind === "wrench" ? (picked.sample ? sampleWrench : wrenches.get(picked.id)) : undefined;
    object?.traverse(o => {
      const mesh = o as Mesh, material = mesh.material as MeshBasicMaterial | MeshLambertMaterial | undefined;
      if (!material || !material.visible || o instanceof Sprite) return;
      const gold = material.clone();
      if ("emissive" in gold) { gold.emissive.set(PALETTE.lit); gold.emissiveIntensity = 0.5; } else gold.color.set(PALETTE.lit);
      lit.set(mesh, material); mesh.material = gold;
    });
    state.invalidate();
  };

  const stats = { gateList: [...gates.values()].map(g => ({ key: g.key, between: g.pair.map(id => titleOf.get(id) ?? id) })), reach, wallHeight: H, walls: walls.length, wallLength: walls.reduce((s, w) => s + w.length, 0), stones: placements.length, gates: gates.size,
    pathways: paths.size, links: links.length, unrouted: links.filter(l => !l.way).map(l => `${titleOf.get(l.from)} -> ${titleOf.get(l.to)}`),
    neighbourLinks: links.filter(l => l.way?.length === 2).length, roads: roads.size, wrenches: wrenches.size, seats: seats.size,
    linkWays: links.map(l => ({ from: titleOf.get(l.from), to: titleOf.get(l.to), through: l.way?.slice(1, -1).map(id => titleOf.get(id) ?? id) ?? null })) };
  const screen = (world: Vector3) => {
    const ndc = world.clone().project(state.camera as Camera), rect = state.gl.domElement.getBoundingClientRect();
    return { x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height };
  };
  const point = (kind: string, id: string): { x: number; y: number } | undefined => {
    if (kind === "territory") {
      // A spot on its land clear of every pathway: around its seat, nearest first, the first a click there picks it at.
      const seat = seats.get(id);
      for (let r = H * 2; seat && r < reach; r += H) for (let k = 0; k < 12; k++) {
        const p = { x: seat.x + Math.cos(k * Math.PI / 6) * r, z: seat.z + Math.sin(k * Math.PI / 6) * r };
        if (at(p) !== id) continue;
        const spot = screen(lift(p).applyMatrix4(group.matrixWorld)), hit = pick(spot.x, spot.y);
        if (hit?.kind === "territory" && hit.id === id) return spot;
      }
      return undefined;
    }
    const object = kind === "path" ? paths.get(id) : kind === "road" ? roads.get(id)?.children[0] : kind === "gate" ? gateGroups.get(id) : kind === "wrench" ? (id.endsWith(":sample") ? sampleWrench : wrenches.get(id)) : undefined;
    if (!object) return undefined;
    if (object instanceof Mesh && (kind === "path" || kind === "road")) {
      const at = object.geometry.getAttribute("position"), k = Math.floor(at.count / 4) * 2;
      return screen(new Vector3((at.getX(k) + at.getX(k + 1)) / 2, at.getY(k), (at.getZ(k) + at.getZ(k + 1)) / 2).applyMatrix4(object.matrixWorld));
    }
    return screen(object.getWorldPosition(new Vector3()).add(kind === "gate" ? new Vector3(0, H, 0) : new Vector3()));
  };
  const fills = new Map<string, string>();
  for (const { id, mesh } of shapes) if (own.has(id)) fills.set(mesh.userData.parked ? "parked" : String(mesh.userData.word), "#" + (mesh.material as MeshLambertMaterial).color.getHexString());
  return { point, fills: [...fills].map(([word, colour]) => ({ word, colour })), pick, find, showSample: on => { if (sampleWrench) { sampleWrench.visible = on; state.invalidate(); } }, highlight, stats };
}

/** An invisible box that takes a click, standing on the ground at `y`. */
function hitBox(w: number, h: number, d: number, y: number): Mesh {
  const box = new Mesh(new BoxGeometry(w, h, d), new MeshLambertMaterial({ visible: false }));
  box.position.y = y + h / 2;
  return box;
}

