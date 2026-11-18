// Capability 3 · Story node render
import { BufferGeometry, CircleGeometry, Color, DoubleSide, Float32BufferAttribute, FrontSide, Group, Mesh, MeshBasicMaterial, type Object3D, Vector3 } from "three";
import { inTunnelMouth, MOUTH_ROOM, type IslandRoads } from "../territories/island-roads.js";
import { LIGHT, type IslandRelief } from "../territories/island-relief.js";
import { hollowRing, PICK_GOLD, RING_LEAST_PX } from "./open-work.js";

type Point = { readonly x: number; readonly z: number };

export const ROAD = { colour: "#e2d3aa", alpha: 0.7 } as const;
export const TERRITORY_JUNCTION = 1.8;
export const PLAZA = { top: 0.7, rise: 0.22, step: 1.22 } as const;
export const QUIET_BORDER = { colour: "#f4f7f8", opacity: 0.4 } as const;
export const POST = { ink: "#1b2024", paper: "#f3efe4" } as const;
export const LIT = { gold: PICK_GOLD } as const;
export const GROUND = "#686d70";

export type FillAt = (p: Point) => { colour: Color; opacity: number } | undefined;

export function landColour(fillAt: FillAt): (p: Point) => Color {
  const ground = new Color(GROUND);
  return (p) => { const f = fillAt(p); return f === undefined ? ground.clone() : ground.clone().lerp(f.colour, f.opacity); };
}

export const WALL_SHADE = { lit: 0.84, away: 0.56 } as const;

export function shade(c: Color, facing: Point): Color {
  const l = Math.hypot(facing.x, facing.z) || 1, k = ((facing.x * LIGHT.x + facing.z * LIGHT.z) / l + 1) / 2;
  return c.clone().multiplyScalar(WALL_SHADE.away + (WALL_SHADE.lit - WALL_SHADE.away) * k);
}

export function islandRoadMarks(roads: IslandRoads, onGround: (p: Point) => Vector3, fillAt: FillAt, relief: IslandRelief): Group {
  const group = new Group();
  group.name = "island-roads";
  const sand = new Color(ROAD.colour), under = landColour(fillAt);
  const onSurface = (p: Point) => { const v = onGround(p); v.y += relief.raise(p); return v; };
  const mix = (p: Point) => under(p).lerp(sand, ROAD.alpha);
  const flat = (geometry: BufferGeometry, material: MeshBasicMaterial, name: string, order: number) => {
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.renderOrder = order;
    mesh.raycast = () => {};
    group.add(mesh);
    return mesh;
  };
  const material = (colour?: string | Color, opacity = 1) => new MeshBasicMaterial({ ...(colour === undefined ? { vertexColors: true } : { color: colour }), transparent: true, opacity, side: DoubleSide, forceSinglePass: true, depthWrite: false });
  roads.segments.forEach((segment, i) => {
    const mesh = flat(ribbon(dense(segment.pts), segment.width, onSurface, mix), material(), `road:${i}`, 3);
    mesh.userData = { links: segment.links, width: segment.width };
  });
  const junction = (at: Point, width: number, name: string) => {
    const disc = new CircleGeometry(width / 2, 16).rotateX(-Math.PI / 2);
    const corners = disc.getAttribute("position");
    for (let k = 0; k < corners.count; k++) {
      const placed = onSurface({ x: at.x + corners.getX(k), z: at.z + corners.getZ(k) });
      corners.setXYZ(k, placed.x, placed.y, placed.z);
    }
    flat(disc, material(mix(at)), name, 3);
  };
  roads.junctions.forEach(({ at, width }, i) => junction(at, width, `road-junction:${i}`));
  const plaza = (at: Point, width: number, name: string) => {
    const foot = width / 2, top = foot * PLAZA.top, up = PLAZA.rise * relief.scale, colour = mix(at), sides = 24;
    const positions: number[] = [], colours: number[] = [];
    const put = (p: Point, lift: number, c: Color) => { const v = onSurface(p); positions.push(v.x, v.y + lift, v.z); colours.push(c.r, c.g, c.b); };
    const round = (r: number, k: number): Point => ({ x: at.x + r * Math.cos(2 * Math.PI * k / sides), z: at.z + r * Math.sin(2 * Math.PI * k / sides) });
    for (let k = 0; k < sides; k++) {
      const lit = shade(colour.clone().multiplyScalar(PLAZA.step), { x: Math.cos(2 * Math.PI * (k + 0.5) / sides), z: Math.sin(2 * Math.PI * (k + 0.5) / sides) });
      put(round(foot, k), 0, lit); put(round(foot, k + 1), 0, lit); put(round(top, k + 1), up, lit);
      put(round(foot, k), 0, lit); put(round(top, k + 1), up, lit); put(round(top, k), up, lit);
    }
    for (let k = 0; k < sides; k++) { put(at, up, colour); put(round(top, k), up, colour); put(round(top, k + 1), up, colour); }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
    flat(geometry, material(), name, 3.1).userData = { plaza: { at, foot, top, rise: up } };
  };
  for (const [capability, { at }] of roads.settlements) {
    const ending = roads.segments.filter((s) => [s.pts[0]!, s.pts.at(-1)!].some((p) => Math.hypot(p.x - at.x, p.z - at.z) < 1e-6));
    if (ending.length) plaza(at, Math.max(...ending.map((s) => s.width)) * TERRITORY_JUNCTION, `territory-junction:${capability}`);
  }
  standingPosts(group, roads, relief, onGround, under);
  tunnelPortals(group, roads, relief, onGround);
  const rings = new Group();
  rings.name = "gate-ring";
  rings.userData = { relief, onSurface: (p: Point) => { const v = onGround(p); v.y += relief.height + 0.05 * relief.scale; return v; } };
  group.add(rings);
  return group;
}

const STANDING = { faceRatio: 0.62, body: "#9aa2a8", shadow: 0.22, reach: 0.8 } as const;

function standingPosts(group: Group, roads: IslandRoads, relief: IslandRelief, onGround: (p: Point) => Vector3, under: (p: Point) => Color): void {
  const at = (p: Point, d: Point, k: number): Point => ({ x: p.x + d.x * k, z: p.z + d.z * k });
  const solidMaterial = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, side: DoubleSide, forceSinglePass: true });
  const shadowMaterial = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, side: DoubleSide, forceSinglePass: true, depthWrite: false });
  const body = new Color(STANDING.body), ink = new Color(POST.ink), black = new Color("#000");
  const mesh = (positions: number[], colours: number[] | undefined, material: MeshBasicMaterial, name: string, order: number, pickable = false) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    if (colours !== undefined) geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
    const made = new Mesh(geometry, material);
    made.name = name;
    made.renderOrder = order;
    if (!pickable) made.raycast = () => {};
    group.add(made);
    return made;
  };
  const faceMaterial = new MeshBasicMaterial({ color: POST.paper, transparent: true, opacity: 1, side: DoubleSide, forceSinglePass: true });
  roads.gates.forEach((gate, i) => {
    if (inTunnelMouth(roads, gate)) return;
    const ramp = relief.ramps.find((r) => r.gate === gate), side = relief.post.side;
    const tall = relief.post.height, across = { x: -gate.along.z, z: gate.along.x };
    const gap = ramp === undefined ? gate.opening : Math.max(gate.opening, relief.rampWidth);
    for (const sign of [-1, 1]) {
      let c = at(gate.at, gate.along, (gap / 2 + side / 2) * sign);
      if (ramp !== undefined) c = at(c, ramp.out, -(side / 2 + 0.15 * relief.scale));
      const base = Math.max(relief.raise(at(c, across, 0.3 * relief.scale)), relief.raise(at(c, across, -0.3 * relief.scale)));
      const ground = onGround(c).y + base, v = (q: Point, up: number) => [q.x, ground + up, q.z];
      const square = (half: number) => [at(at(c, gate.along, -half), across, -half), at(at(c, gate.along, half), across, -half), at(at(c, gate.along, half), across, half), at(at(c, gate.along, -half), across, half)];
      const foot = square(side / 2), positions: number[] = [], colours: number[] = [];
      const push = (points: number[][], colour: Color) => { for (const p of points) { positions.push(...p); colours.push(colour.r, colour.g, colour.b); } };
      for (let k = 0; k < 4; k++) {
        const a = foot[k]!, b = foot[(k + 1) % 4]!, out = { x: (a.x + b.x) / 2 - c.x, z: (a.z + b.z) / 2 - c.z };
        const lit = shade(body, out);
        push([v(a, 0), v(b, 0), v(b, tall), v(a, 0), v(b, tall), v(a, tall)], lit);
      }
      push([v(foot[0]!, tall), v(foot[1]!, tall), v(foot[2]!, tall), v(foot[0]!, tall), v(foot[2]!, tall), v(foot[3]!, tall)], ink);
      const post = mesh(positions, colours, solidMaterial, `gate-post:${i}:${sign}`, 4, true);
      post.userData = { gate: true, index: i, between: gate.between, entrances: gate.entrances, links: gate.links, standing: true, height: tall, base };
      const face = square(side * STANDING.faceRatio / 2);
      mesh([face[0]!, face[1]!, face[2]!, face[0]!, face[2]!, face[3]!].flatMap((q) => v(q, tall + 0.02 * relief.scale)), undefined, faceMaterial, `gate-face:${i}:${sign}`, 5);
      const away = { x: -LIGHT.x * tall * STANDING.reach, z: -LIGHT.z * tall * STANDING.reach };
      const hull = [...foot, ...foot.map((q) => ({ x: q.x + away.x, z: q.z + away.z }))];
      const mid = { x: hull.reduce((s, q) => s + q.x, 0) / hull.length, z: hull.reduce((s, q) => s + q.z, 0) / hull.length };
      hull.sort((a, b) => Math.atan2(a.z - mid.z, a.x - mid.x) - Math.atan2(b.z - mid.z, b.x - mid.x));
      const dark = under(mid).lerp(black, STANDING.shadow), shadow: number[][] = [];
      hull.forEach((a, k) => shadow.push(v(mid, 0.04 * relief.scale), v(a, 0.04 * relief.scale), v(hull[(k + 1) % hull.length]!, 0.04 * relief.scale)));
      mesh(shadow.flat(), shadow.flatMap(() => [dark.r, dark.g, dark.b]), shadowMaterial, `gate-shadow:${i}:${sign}`, 3.5);
    }
  });
}

export const PORTAL = { stone: "#f3efe4", band: 0.28, wing: 2.2, spring: 0.12, mouth: "#15191c", lean: 1.0, most: 0.3, floor: 0.7, dusk: 0.8, lip: 2.2 } as const;
const roadHalf = (width: number, scale: number) => (width - MOUTH_ROOM * scale) / 2;

function tunnelPortals(group: Group, roads: IslandRoads, relief: IslandRelief, onGround: (p: Point) => Vector3): void {
  const mouth = new MeshBasicMaterial({ color: PORTAL.mouth, transparent: true, opacity: 1, side: FrontSide, forceSinglePass: true, depthWrite: false });
  roads.portals.forEach((portal, i) => {
    const r = portal.width / 2, band = r * PORTAL.band, spring = r * PORTAL.spring, tall = spring + r + band;
    const tunnel = relief.tunnels.find((t) => [t.pts[0]!, t.pts.at(-1)!].some((q) => Math.hypot(q.x - portal.at.x, q.z - portal.at.z) < 1e-6));
    const run = tunnel === undefined ? Infinity : tunnel.pts.reduce((s, q, k) => (k ? s + Math.hypot(q.x - tunnel.pts[k - 1]!.x, q.z - tunnel.pts[k - 1]!.z) : 0), 0);
    const base = onGround(portal.at).y + relief.raise(portal.at) + 0.02 * relief.scale, lean = Math.min(PORTAL.lean, run * PORTAL.most / tall);
    const face = (u: number, v: number) => {
      const g = onGround({ x: portal.at.x + portal.along.x * u + portal.into.x * v * lean, z: portal.at.z + portal.along.z * u + portal.into.z * v * lean });
      return [g.x, base + v, g.z];
    };
    const outline = (w: number) => [[-w, 0], [-w, spring], ...Array.from({ length: 13 }, (_, k) => { const a = Math.PI - k * Math.PI / 12; return [w * Math.cos(a), spring + w * Math.sin(a)]; }), [w, 0]] as [number, number][];
    const inner = outline(r), dark: number[] = [], ring: number[] = [], colours: number[] = [];
    const stone = new Color(PORTAL.stone), front = shade(stone, { x: -portal.into.x, z: -portal.into.z }), top = stone.clone().multiplyScalar(WALL_SHADE.lit + 0.1);
    const out = new Vector3(-portal.into.x, 0.2, -portal.into.z);
    const wound = (a: number[], b: number[], c: number[]) => {
      const n = new Vector3(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!).cross(new Vector3(c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!));
      return n.dot(out) >= 0 ? [...a, ...b, ...c] : [...a, ...c, ...b];
    };
    const tri = (into: number[], a: number[], b: number[], c: number[]) => into.push(...wound(a, b, c));
    const quad = (a: number[], b: number[], c: number[], d: number[], colour: Color) => { tri(ring, a, b, c); tri(ring, a, c, d); for (let k = 0; k < 6; k++) colours.push(colour.r, colour.g, colour.b); };
    const wide = r + band * PORTAL.wing, high = spring + r + band;
    const edge = ([u, v]: [number, number]): [number, number] => {
      if (v <= spring + 1e-9) return [Math.sign(u) * wide, v];
      const du = u, dv = v - spring, t = Math.min(Math.abs(du) > 1e-9 ? wide / Math.abs(du) : Infinity, (high - spring) / dv);
      return [du * t, spring + dv * t];
    };
    for (let k = 0; k + 1 < inner.length; k++) {
      const [a, b] = [inner[k]!, inner[k + 1]!], [c, d] = [edge(a), edge(b)];
      tri(dark, face(0, spring), face(a[0], a[1]), face(b[0], b[1]));
      quad(face(a[0], a[1]), face(c[0], c[1]), face(d[0], d[1]), face(b[0], b[1]), front);
    }
    for (const side of [-1, 1]) {
      const corner = face(side * wide, high), atTop = edge([0, spring + r]), atSide = edge([side * r * Math.SQRT1_2, spring + r * Math.SQRT1_2]);
      tri(ring, corner, face(atTop[0], atTop[1]), face(atSide[0], atSide[1]));
      for (let k = 0; k < 3; k++) colours.push(front.r, front.g, front.b);
    }
    const back = (u: number, v: number) => { const q = face(u, v); return [q[0]! + portal.into.x * band * PORTAL.lip, q[1]!, q[2]! + portal.into.z * band * PORTAL.lip]; };
    out.set(0, 1, 0);
    quad(face(-wide, high), face(wide, high), back(wide, high), back(-wide, high), top);
    out.set(-portal.into.x, 0.2, -portal.into.z);
    tri(dark, face(-r, 0), face(r, 0), face(0, spring));
    const made = (positions: number[], material: MeshBasicMaterial, name: string, order: number) => {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
      const mesh = new Mesh(geometry, material);
      mesh.name = name;
      mesh.renderOrder = order;
      group.add(mesh);
      return mesh;
    };
    made(dark, mouth, `tunnel-mouth:${i}`, 4).raycast = () => {};
    const half = Math.min(r * 0.8, roadHalf(portal.width, relief.scale)), deep = Math.max(...inner.map(([, v]) => v)) * lean * PORTAL.floor;
    const ground = (u: number, w: number) => { const g = onGround({ x: portal.at.x + portal.along.x * u + portal.into.x * w, z: portal.at.z + portal.along.z * u + portal.into.z * w }); return [g.x, base + 0.01 * relief.scale, g.z]; };
    const lit = new Color(ROAD.colour).lerp(new Color(PORTAL.mouth), 0.45);
    const before = -r * PORTAL.dusk, rows = [[before, 0], [0, 1], [deep, 0]] as const, floorAt: number[] = [], floorColours: number[] = [];
    for (let k = 0; k + 1 < rows.length; k++) {
      const [[w0, a0], [w1, a1]] = [rows[k]!, rows[k + 1]!];
      floorAt.push(...ground(-half, w0), ...ground(half, w0), ...ground(half, w1), ...ground(-half, w0), ...ground(half, w1), ...ground(-half, w1));
      for (const a of [a0, a0, a1, a0, a1, a1]) floorColours.push(lit.r, lit.g, lit.b, a);
    }
    const floor = made(floorAt, new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, side: DoubleSide, forceSinglePass: true, depthWrite: false }), `tunnel-floor:${i}`, 4.05);
    floor.geometry.setAttribute("color", new Float32BufferAttribute(floorColours, 4));
    floor.raycast = () => {};
    const arch = made(ring, new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, side: FrontSide, forceSinglePass: true, depthWrite: false }), `tunnel-portal:${i}`, 4.1);
    arch.geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
    const gate = roads.gates.findIndex((g) => Math.hypot(g.at.x - portal.border.x, g.at.z - portal.border.z) < 1e-6);
    arch.userData = gate < 0 ? { portal: true, links: portal.links, base } : { portal: true, links: portal.links, base, gate: true, index: gate, between: roads.gates[gate]!.between };
    if (gate < 0) arch.raycast = () => {};
  });
}

export type GatePick = { readonly gate: number; readonly between: readonly [string, string] };

export function gateOf(mark: Object3D): GatePick | undefined {
  const { gate, index, between } = mark.userData as { gate?: true; index?: number; between?: readonly [string, string] };
  return gate === true && index !== undefined && between !== undefined ? { gate: index, between } : undefined;
}

const GATE_RING_ROOM = 1.3;

export function ringGate(marks: Object3D, roads: IslandRoads, pick: GatePick | undefined, zoom = 1): void {
  const rings = marks.getObjectByName("gate-ring");
  if (rings === undefined) return;
  for (const ring of [...rings.children]) { rings.remove(ring); (ring as Mesh).geometry.dispose(); ((ring as Mesh).material as MeshBasicMaterial).dispose(); }
  if (pick === undefined) return;
  const gate = roads.gates[pick.gate];
  if (gate === undefined) return;
  const { relief, onSurface } = rings.userData as { relief: IslandRelief; onSurface: (p: Point) => Vector3 };
  const ramp = relief.ramps.find((r) => r.gate === gate);
  const gap = ramp === undefined ? gate.opening : Math.max(gate.opening, relief.rampWidth);
  const gold = new MeshBasicMaterial({ color: LIT.gold, transparent: true, opacity: 1, side: DoubleSide, forceSinglePass: true, depthWrite: false });
  const ring = hollowRing(gate.at, Math.hypot(gap / 2 + relief.post.side, relief.post.side + 0.2 * relief.scale) * GATE_RING_ROOM, RING_LEAST_PX, gold, onSurface, zoom);
  ring.name = `gate-ring:${pick.gate}`;
  ring.renderOrder = 5;
  rings.add(ring);
}

export function dense(pts: readonly Point[]): Point[] {
  const out: Point[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n });
  }
  return out;
}

export function ribbon(points: readonly Point[], width: number, onSurface: (p: Point) => Vector3, colourAt?: (p: Point) => Color): BufferGeometry {
  const positions: number[] = [], colours: number[] = [], index: number[] = [];
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)]!, b = points[Math.min(points.length - 1, i + 1)]!;
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = -(b.z - a.z) / l * width / 2, nz = (b.x - a.x) / l * width / 2;
    for (const q of [{ x: p.x + nx, z: p.z + nz }, { x: p.x - nx, z: p.z - nz }]) {
      const v = onSurface(q);
      positions.push(v.x, v.y, v.z);
      if (colourAt) { const c = colourAt(q); colours.push(c.r, c.g, c.b); }
    }
    if (i > 0) { const k = 2 * i; index.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  if (colourAt) geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setIndex(index);
  return geometry;
}

export function cutOpenings(borders: readonly { from: Point; to: Point }[], gates: readonly { readonly at: Point; readonly opening: number }[]): { from: Point; to: Point }[] {
  return borders.flatMap(({ from: a, to: b }) => {
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l < 1e-9) return [];
    const holes = gates.flatMap((g) => {
      const t = ((g.at.x - a.x) * (b.x - a.x) + (g.at.z - a.z) * (b.z - a.z)) / (l * l);
      const off = Math.hypot(a.x + t * (b.x - a.x) - g.at.x, a.z + t * (b.z - a.z) - g.at.z), r = g.opening / 2;
      if (off >= r) return [];
      const half = Math.sqrt(r * r - off * off) / l;
      return t + half >= 0 && t - half <= 1 ? [[t - half, t + half] as const] : [];
    }).sort((x, y) => x[0] - y[0]);
    const at = (t: number): Point => ({ x: a.x + t * (b.x - a.x), z: a.z + t * (b.z - a.z) });
    const kept: { from: Point; to: Point }[] = [];
    let from = 0;
    for (const [h0, h1] of [...holes, [1, 1] as const]) {
      const to = Math.max(from, Math.min(1, h0));
      if (to - from > 1e-3) kept.push({ from: at(from), to: at(to) });
      from = Math.max(from, h1);
    }
    return kept;
  });
}

export function landFill(map: { readonly territories: readonly { readonly capability?: string; readonly mapped?: true }[]; readonly cells: readonly { readonly site: Point; readonly territory: number }[] }, land: Group): FillAt {
  const fills = map.territories.map((t) => {
    const mesh = land.getObjectByName(`territory:${t.capability ?? (t.mapped === true ? "mapped" : "unclaimed")}`) as Mesh | undefined;
    const material = mesh?.material as MeshBasicMaterial | undefined;
    return material === undefined ? undefined : { colour: material.color.clone(), opacity: material.opacity };
  });
  return (p) => {
    let best: { territory: number } | undefined, d = Infinity;
    for (const cell of map.cells) { const dd = (cell.site.x - p.x) ** 2 + (cell.site.z - p.z) ** 2; if (dd < d) { d = dd; best = cell; } }
    return best === undefined || best.territory < 0 ? undefined : fills[best.territory];
  };
}
