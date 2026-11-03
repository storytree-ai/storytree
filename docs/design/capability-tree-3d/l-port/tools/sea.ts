/** The sea lane, after the six landings (i-sea-lanes/): Mick picked the coast gate (6) and asked for "the pathway leading into
 * a port/structure then we draw a different style line for the shipping lanes, like a light blue or something. This way the
 * two lines don't need to connect", the structure "like the gates but not exactly the same, maybe a port building but with
 * gate style towers", and "no dotted lines please, shipping lines all stay the same. Only add thickness for more lines
 * merging." So (`?sea=port`, the default):
 * - the line: the map's own lanes (pathways:selection-lanes) followed piece by piece, each stretch drawn once however many
 *   lanes share it, in and out alike, one solid pale sea-blue, a step wider only where more lanes share it; mixed opaque into
 *   the sea so shared stretches show no knots. It stops at every coast, and at the selected island it ends just off the port,
 *   never on the road. The map's purple and teal lanes, their pips and the tan band they ride are hidden;
 * - the port, at each landing (the mouth, Keys' landfall): a low building at the coast where the sandy road ends (the
 *   jetty an earlier take had is gone: Mick, "remove the jetty though dont think its needed"), and two towers either side in the gate posts' own slate, shading and
 *   ink top, but twice as tall and capped, so it reads as the gates' kin and not a gate;
 * - `map`: the map's own lanes, as round 11 drew them. */
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, Vector3,
  type BufferAttribute, type Object3D } from "three";
import type { RootState } from "@react-three/fiber";

type P = { x: number; z: number };
export type SeaKey = "port" | "map";
const QUERY = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
export const SEA: SeaKey = (["port", "map"] as const).find(k => k === QUERY.get("sea")) ?? "port";

/** The sea as it shows on the page under the lines, and the one lane tone mixed into it (`?lane=#rrggbb` tries another). */
const SEA_HEX = "#17222b";
const LANE = { ink: QUERY.get("lane") ?? "#8fbfd4", mix: Number(QUERY.get("laneMix") ?? 0.78) };
/** A line's width in ground units by how many lanes share its stretch: 1, 2-7, 8-31, 32 or more. */
const WIDTHS = [0.32, 0.5, 0.78, 1.15];
const widthOf = (n: number) => WIDTHS[n >= 32 ? 3 : n >= 8 ? 2 : n >= 2 ? 1 : 0]!;
const LIFT = 0.16;
/** How far from the mouth the way out's reach from Keys joins its line, in ground units. */
const JOIN_CLEAR = 80;
/** A lane passing this near a berth (in ground units) ends on it. */
const SNAP = 10;
/** How far off the coast the reach from Keys' landfall rounds the island, in ground units. */
const OFFSHORE = 6;
/** The port, in ground units: the berth, the building, the towers. `?port=<scale>`
 * scales it all. */
const SCALE = Number(QUERY.get("port") ?? 1);
const PORT = {
  /** The lanes end this far off the coast, in front of the building. */
  berth: 3 * SCALE,
  house: { along: 2.4 * SCALE, half: 2.0 * SCALE, height: 1.6 * SCALE, roof: "#2a3036" },
  tower: { side: 1.4 * SCALE, height: 3.3 * SCALE, cap: 1.75 * SCALE, capDepth: 0.35 * SCALE, apart: 0.6 * SCALE },
  /** Keys' landfall carries one link, so its port is smaller. */
  small: 0.8,
};

const inPolygon = (p: P, poly: readonly P[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
};

export type SeaInput = {
  state: RootState; root: Object3D; story: string;
  /** The selected island's landings, in its plate's frame: where the road ends, and a point out to sea from it. */
  docks: { at: P; sea: P; dir: "down" | "up" }[];
  /** The ground's height in the plate's frame, and the light's direction on the ground (toward it). */
  heightAt: (p: P) => number; light: P;
  post: { faceRatio: number; body: string; ink: string; paper: string; shadow: number; reach: number; wall: { lit: number; away: number } };
};
export type Sea = { keep(): void; stats: Record<string, unknown> };

export function seaLayer({ state, root, story, docks, heightAt, light, post }: SeaInput): Sea {
  const lanesGroup = state.scene.getObjectByName("pathways:selection-lanes");
  const hideAll = () => {
    lanesGroup?.traverse(o => {
      if (!/^lane(-glow|-entrance)?:/.test(o.name)) return;
      if (!Object.getOwnPropertyDescriptor(o, "visible")?.get) Object.defineProperty(o, "visible", { get: () => false, set: () => {}, configurable: true });
    });
  };
  if (SEA === "map") return { keep() {}, stats: { sea: SEA } };
  root.updateMatrixWorld(true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();

  // Every island's coast (its white line's own rings), to stop the lines at the shore.
  const coasts: { mesh: Mesh; inverse: Matrix4; ring: P[]; story: string }[] = [];
  state.scene.traverse(o => {
    if (!o.name.startsWith("island-coast:")) return;
    let plate: Object3D | null = o; while (plate && !plate.name.startsWith("planet:")) plate = plate.parent;
    const mesh = o as Mesh, at = mesh.geometry.getAttribute("position") as BufferAttribute, ring: P[] = [];
    for (let i = 0; i + 1 < at.count; i += 2) ring.push({ x: (at.getX(i) + at.getX(i + 1)) / 2, z: (at.getZ(i) + at.getZ(i + 1)) / 2 });
    mesh.updateMatrixWorld(true);
    coasts.push({ mesh, inverse: new Matrix4().copy(mesh.matrixWorld).invert(), ring, story: plate?.name.slice("planet:".length) ?? "" });
  });
  const v = new Vector3();
  /** The island a world point stands on, if any. */
  const islandAt = (w: Vector3) => {
    for (const c of coasts) { v.copy(w).applyMatrix4(c.inverse); if (Math.abs(v.y) < 30 && inPolygon({ x: v.x, z: v.z }, c.ring)) return c; }
    return undefined;
  };
  const own = coasts.filter(c => c.story === story);
  const toWorld = root.matrixWorld;
  const onIsland = (p: P) => !!islandAt(new Vector3(p.x, heightAt(p), p.z).applyMatrix4(toWorld));

  // Each landing's port: the coast found walking out from the road's end, its berth a little off the coast.
  const ports = docks.map(d => {
    const l = Math.hypot(d.sea.x - d.at.x, d.sea.z - d.at.z) || 1, u = { x: (d.sea.x - d.at.x) / l, z: (d.sea.z - d.at.z) / l };
    let t = 0; while (t < 30 && onIsland({ x: d.at.x + u.x * t, z: d.at.z + u.z * t })) t += 0.2;
    const k = d.dir === "down" ? 1 : PORT.small, coast = { x: d.at.x + u.x * t, z: d.at.z + u.z * t };
    const berth = { x: coast.x + u.x * PORT.berth, z: coast.z + u.z * PORT.berth };
    return { ...d, u, n: { x: -u.z, z: u.x }, k, coast, inland: t, berth };
  });

  // The lanes, piece by piece in world space: each stretch once, in and out alike, with how many lanes share it.
  type Piece = { a: Vector3; b: Vector3; sa: Vector3; sb: Vector3; n: number };
  const pieces = new Map<string, Piece>();
  const q = (w: Vector3) => `${w.x.toFixed(2)},${w.y.toFixed(2)},${w.z.toFixed(2)}`;
  const seen = new Set<string>();
  const joins: { to: Vector3; next: Vector3; port: (typeof ports)[number] }[] = [];
  let lanes = 0, drop = 0, drops = 0;
  /** A berth in world space, at the height of a lane point near it. */
  const berthAt = (port: (typeof ports)[number], near: Vector3) => { const r = near.clone().applyMatrix4(toRoot); return new Vector3(port.berth.x, r.y, port.berth.z).applyMatrix4(toWorld); };
  const addPiece = (a: Vector3, b: Vector3, sa: Vector3, sb: Vector3, key: string) => { const was = pieces.get(key); if (was) was.n++; else pieces.set(key, { a, b, sa, sb, n: 1 }); };
  lanesGroup?.traverse(o => {
    if (!o.name.startsWith("lane:")) return;
    const key = `${o.userData.from}->${o.userData.to}`; if (seen.has(key)) return; seen.add(key); lanes++;
    const mesh = o as Mesh, at = mesh.geometry.getAttribute("position") as BufferAttribute, dir = o.userData.dir as "up" | "down";
    mesh.updateMatrixWorld(true);
    const centre: Vector3[] = [], side: Vector3[] = [];
    for (let i = 0; i + 1 < at.count; i += 2) {
      const l = new Vector3(at.getX(i), at.getY(i), at.getZ(i)).applyMatrix4(mesh.matrixWorld), r = new Vector3(at.getX(i + 1), at.getY(i + 1), at.getZ(i + 1)).applyMatrix4(mesh.matrixWorld);
      centre.push(l.clone().add(r).multiplyScalar(0.5)); side.push(l.sub(r).normalize());
    }
    const wet = centre.map(c => !islandAt(c));
    // How far the sea stands below the ground's dome, read off the lanes at sea.
    centre.forEach((c, i) => { if (!wet[i] || i % 5) return; const r = c.clone().applyMatrix4(toRoot); drop += heightAt({ x: r.x, z: r.z }) - r.y; drops++; });
    let skip = (_i: number) => false;
    const ownEnd = islandAt(centre.at(-1)!)?.story === story ? "end" : islandAt(centre[0]!)?.story === story ? "start" : undefined;
    // The way out: the map sends it from the mouth, but the island's own road leaves at Keys' landfall, so the line is
    // taken from the nearest point of its way well clear of the mouth, and a new reach joins it to Keys' berth.
    const outPort = ports.find(p => p.dir === "up"), inPort = ports.find(p => p.dir === "down");
    if (dir === "up" && outPort && ownEnd) {
      const mouth = inPort?.at ?? outPort.at;
      const order = centre.map((_, i) => i); if (ownEnd === "end") order.reverse();
      const best = order.find(i => { if (!wet[i]) return false; const r = centre[i]!.clone().applyMatrix4(toRoot); return Math.hypot(r.x - mouth.x, r.z - mouth.z) > JOIN_CLEAR; }) ?? -1;
      if (best >= 0) {
        skip = i => ownEnd === "end" ? i >= best : i < best;
        const next = centre[Math.max(0, Math.min(centre.length - 1, best + (ownEnd === "end" ? -8 : 8)))]!;
        joins.push({ to: centre[best]!, next, port: outPort });
      }
    }
    // The way in: cut where it first comes within SNAP of the mouth's berth, and run straight from there onto the berth.
    if (dir === "down" && inPort && ownEnd) {
      const order = centre.map((_, i) => i); if (ownEnd === "start") order.reverse();
      const ci = order.find(i => { const r = centre[i]!.clone().applyMatrix4(toRoot); return Math.hypot(r.x - inPort.berth.x, r.z - inPort.berth.z) < SNAP; });
      if (ci !== undefined) {
        skip = i => ownEnd === "end" ? i >= ci : i < ci;
        addPiece(centre[ci]!, berthAt(inPort, centre[ci]!), side[ci]!, side[ci]!, `${q(centre[ci]!)}|berth:${inPort.dir}`);
      }
    }
    for (let i = 0; i + 1 < centre.length; i++) {
      let a = centre[i]!, b = centre[i + 1]!;
      if (!wet[i] && !wet[i + 1]) continue;
      if (skip(i)) continue;
      if (wet[i] !== wet[i + 1]) {
        // Where it meets the shore, found by halving the piece; near a port it ends on the berth instead.
        let lo = wet[i] ? a : b, hi = wet[i] ? b : a;
        for (let k = 0; k < 14; k++) { const m = lo.clone().lerp(hi, 0.5); if (islandAt(m)) hi = m; else lo = m; }
        const r = lo.clone().applyMatrix4(toRoot), near = ports.find(p => Math.hypot(r.x - p.coast.x, r.z - p.coast.z) < SNAP);
        if (near) lo = berthAt(near, lo);
        if (wet[i]) b = lo; else a = lo;
      }
      addPiece(a, b, side[i]!, side[i + 1]!, [q(centre[i]!), q(centre[i + 1]!)].sort().join("|"));
    }
  });
  const seaDrop = drops ? drop / drops : 8;

  // Draw them in the plate's frame, lifted off the sea along the globe's normal.
  const group = new Group(); group.name = "mock-sea"; root.add(group);
  const local = (w: Vector3, up: number) => w.clone().addScaledVector(w.clone().normalize(), up).applyMatrix4(toRoot);
  const tone = new Color(SEA_HEX).lerp(new Color(LANE.ink), LANE.mix);
  const buf = { pos: [] as number[], col: [] as number[] };
  const push = (vs: Vector3[]) => { for (const p of vs) { buf.pos.push(p.x, p.y, p.z); buf.col.push(tone.r, tone.g, tone.b); } };
  for (const p of pieces.values()) {
    const h = widthOf(p.n) / 2;
    const A1 = local(p.a.clone().addScaledVector(p.sa, h), LIFT), A2 = local(p.a.clone().addScaledVector(p.sa, -h), LIFT);
    const B1 = local(p.b.clone().addScaledVector(p.sb, h), LIFT), B2 = local(p.b.clone().addScaledVector(p.sb, -h), LIFT);
    push([A1, A2, B1, A2, B2, B1]);
  }
  // The reach from Keys' berth out to the way out's line: offshore, rounding the island a few units off its coast.
  const catmull = (pts: P[]) => {
    const out: P[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(pts.length - 1, i + 2)]!, n = Math.max(4, Math.ceil(Math.hypot(p2.x - p1.x, p2.z - p1.z)));
      for (let k = 0; k < n; k++) { const t = k / n, t2 = t * t, t3 = t2 * t, f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3); out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) }); }
    }
    out.push(pts.at(-1)!); return out;
  };
  for (const j of joins) {
    const end = local(j.to, 0), endP = { x: end.x, z: end.z }, y = end.y + LIFT;
    const sea0 = { x: j.port.berth.x + j.port.u.x * 4, z: j.port.berth.z + j.port.u.z * 4 };
    const ring = own.flatMap(c => c.ring.map(p => new Vector3(p.x, 0, p.z).applyMatrix4(c.mesh.matrixWorld).applyMatrix4(toRoot))).map(w => ({ x: w.x, z: w.z }));
    const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length, cz = ring.reduce((s, p) => s + p.z, 0) / ring.length;
    const angle = (p: P) => Math.atan2(p.z - cz, p.x - cx);
    const reachAt = (t: number) => { let r = 0; for (const p of ring) { const d = Math.abs(((angle(p) - t + 3 * Math.PI) % (2 * Math.PI)) - Math.PI); if (d < 0.6) r = Math.max(r, Math.hypot(p.x - cx, p.z - cz)); } return r + OFFSHORE; };
    const t0 = angle(sea0), t1 = angle(endP);
    let dt = t1 - t0; while (dt > Math.PI) dt -= 2 * Math.PI; while (dt < -Math.PI) dt += 2 * Math.PI;
    const steps = Math.max(2, Math.ceil(Math.abs(dt) / 0.3)), round: P[] = [];
    for (let k = 1; k < steps; k++) { const t = t0 + dt * k / steps, r = reachAt(t); round.push({ x: cx + Math.cos(t) * r, z: cz + Math.sin(t) * r }); }
    const nx = local(j.next, 0);
    // From just off the port's front, so the way out visibly leaves the port.
    const front = { x: j.port.coast.x + j.port.u.x * 0.8, z: j.port.coast.z + j.port.u.z * 0.8 };
    const all = catmull([front, j.port.berth, sea0, ...round, endP, { x: nx.x, z: nx.z }]);
    let kEnd = 0, dEnd = Infinity; all.forEach((p, i) => { const dd = Math.hypot(p.x - endP.x, p.z - endP.z); if (dd < dEnd) { dEnd = dd; kEnd = i; } });
    const path = all.slice(0, kEnd + 1), h = WIDTHS[0]! / 2;
    path.forEach((p, i) => {
      if (i === 0) return;
      const a = path[i - 1]!, l = Math.hypot(p.x - a.x, p.z - a.z) || 1, n = { x: -(p.z - a.z) / l * h, z: (p.x - a.x) / l * h };
      push([new Vector3(a.x + n.x, y, a.z + n.z), new Vector3(a.x - n.x, y, a.z - n.z), new Vector3(p.x + n.x, y, p.z + n.z),
        new Vector3(a.x - n.x, y, a.z - n.z), new Vector3(p.x - n.x, y, p.z - n.z), new Vector3(p.x + n.x, y, p.z + n.z)]);
    });
  }
  {
    const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(buf.pos, 3)); g.setAttribute("color", new Float32BufferAttribute(buf.col, 3));
    const lineMesh = new Mesh(g, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, depthWrite: false, depthTest: true, transparent: true, opacity: 1, fog: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    lineMesh.renderOrder = 5; lineMesh.raycast = () => {}; group.add(lineMesh);
  }

  // ── The ports: solid shapes, shaded by the light as the gate posts are ─────────────────────────────────────────────
  const dot = (a: P, b: P) => a.x * b.x + a.z * b.z, black = new Color("#000");
  const shade = (base: Color, facing: P) => { const l = Math.hypot(facing.x, facing.z) || 1, k = (dot({ x: facing.x / l, z: facing.z / l }, light) + 1) / 2; return base.clone().multiplyScalar(post.wall.away + (post.wall.lit - post.wall.away) * k); };
  const sides = { pos: [] as number[], col: [] as number[] };
  const flat = (pts: P[], y: number | ((p: P) => number), c: Color, order: number, opacity = 1) => {
    const geo = new BufferGeometry(), ps: number[] = [], yy = typeof y === "number" ? () => y : y;
    for (let i = 1; i + 1 < pts.length; i++) for (const p of [pts[0]!, pts[i]!, pts[i + 1]!]) ps.push(p.x, yy(p), p.z);
    geo.setAttribute("position", new Float32BufferAttribute(ps, 3));
    const m = new Mesh(geo, new MeshBasicMaterial({ color: c, side: DoubleSide, depthWrite: opacity === 1, depthTest: true, transparent: true, opacity, fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    m.renderOrder = order; m.raycast = () => {}; group.add(m); return m;
  };
  /** A rectangle centred on c, `along` either way of u and `half` either way of n. */
  const rect = (c: P, u: P, n: P, along: number, half: number): P[] => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: c.x + u.x * along * i! + n.x * half * j!, z: c.z + u.z * along * i! + n.z * half * j! }));
  /** Upright walls round a foot, from y0 (or the ground under each corner) to y1, each face shaded by the light. */
  const walls = (foot: P[], y0: number | ((p: P) => number), y1: number, body: Color, skipFace?: (mid: P) => boolean) => {
    const cx = foot.reduce((s, p) => s + p.x, 0) / foot.length, cz = foot.reduce((s, p) => s + p.z, 0) / foot.length, lo = typeof y0 === "number" ? () => y0 : y0;
    for (let i = 0; i < foot.length; i++) {
      const a = foot[i]!, b = foot[(i + 1) % foot.length]!, mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      if (skipFace?.(mid)) continue;
      const face = shade(body, { x: mid.x - cx, z: mid.z - cz });
      for (const [p, top] of [[a, false], [b, false], [b, true], [a, false], [b, true], [a, true]] as [P, boolean][]) { sides.pos.push(p.x, top ? y1 : lo(p), p.z); sides.col.push(face.r, face.g, face.b); }
    }
  };
  /** Its shadow on the ground (or the sea), cast away from the light by its height. */
  const shadow = (foot: P[], tall: number, y: (p: P) => number) => {
    const away = { x: -light.x * tall * post.reach, z: -light.z * tall * post.reach };
    const pts = [...foot, ...foot.map(p => ({ x: p.x + away.x, z: p.z + away.z }))];
    // The hull of the foot and its cast copy.
    const c0 = pts.reduce((s, p) => ({ x: s.x + p.x / pts.length, z: s.z + p.z / pts.length }), { x: 0, z: 0 });
    pts.sort((p, r) => Math.atan2(p.z - c0.z, p.x - c0.x) - Math.atan2(r.z - c0.z, r.x - c0.x));
    flat([c0, ...pts, pts[0]!], p => y(p) + 0.05, black, 27, post.shadow * 1.6);
  };
  const body = new Color(post.body), ink = new Color(post.ink), paper = new Color(post.paper), roof = new Color(PORT.house.roof);
  const ground = (p: P) => heightAt(p), seaY = (p: P) => heightAt(p) - seaDrop;
  const portStats: Record<string, unknown>[] = [];
  for (const port of ports) {
    const { u, n, k } = port, top = heightAt(port.coast);
    // The building: a low block at the coast, where the road ends, its long side facing the land.
    const ha = PORT.house.along * k / 2, hh = PORT.house.half * k, tall = PORT.house.height * k;
    const hc = { x: port.coast.x - u.x * (ha + 0.15), z: port.coast.z - u.z * (ha + 0.15) }, house = rect(hc, u, n, ha, hh);
    shadow(house, tall, ground);
    walls(house, p => ground(p) - 0.1, top + tall, body);
    flat(house, top + tall, roof, 33);
    flat(rect(hc, u, n, ha * post.faceRatio, hh - ha * (1 - post.faceRatio)), top + tall + 0.02, paper, 34);
    // A door on the land side, where the road arrives.
    const door = rect({ x: hc.x - u.x * (ha + 0.02), z: hc.z - u.z * (ha + 0.02) }, u, n, 0.02, 0.32 * k);
    walls(door, p => ground(p), top + tall * 0.55, ink.clone().lerp(black, 0.2));
    // The towers: the gate posts' slate and ink top, twice as tall, with a wider cap.
    const ts = PORT.tower.side * k / 2, tt = PORT.tower.height * k;
    for (const sgn of [-1, 1]) {
      const tc = { x: hc.x + n.x * (hh + PORT.tower.apart * k + ts) * sgn, z: hc.z + n.z * (hh + PORT.tower.apart * k + ts) * sgn };
      const foot = rect(tc, u, n, ts, ts), cap = rect(tc, u, n, PORT.tower.cap * k / 2, PORT.tower.cap * k / 2);
      shadow(foot, tt, ground);
      walls(foot, p => ground(p) - 0.1, top + tt - PORT.tower.capDepth * k, body);
      walls(cap, top + tt - PORT.tower.capDepth * k, top + tt, ink.clone().lerp(body, 0.25));
      flat(cap, top + tt, ink, 33);
      flat(rect(tc, u, n, PORT.tower.cap * k / 2 * post.faceRatio, PORT.tower.cap * k / 2 * post.faceRatio), top + tt + 0.02, paper, 34);
    }
    portStats.push({ dir: port.dir, roadEndToCoast: +port.inland.toFixed(1) });
  }
  {
    const sg = new BufferGeometry(); sg.setAttribute("position", new Float32BufferAttribute(sides.pos, 3)); sg.setAttribute("color", new Float32BufferAttribute(sides.col, 3));
    const sm = new Mesh(sg, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, depthWrite: true, depthTest: true, fog: false })); sm.renderOrder = 32; sm.raycast = () => {}; group.add(sm);
  }
  // The white coastline breaks in front of each building, where the lanes come in.
  const cutCoast = () => {
    for (const c of own) {
      const geo = c.mesh.geometry; if (c.mesh.userData.gapFor === geo.uuid) continue;
      const at = geo.getAttribute("position") as BufferAttribute, index = geo.getIndex()!, keep: number[] = [];
      const open = (i: number) => { v.set(at.getX(i), at.getY(i), at.getZ(i)).applyMatrix4(c.mesh.matrixWorld).applyMatrix4(toRoot); return ports.some(p => Math.hypot(v.x - p.coast.x, v.z - p.coast.z) < PORT.house.half * p.k + 0.3); };
      for (let t = 0; t < index.count; t += 3) { const tri = [index.getX(t), index.getX(t + 1), index.getX(t + 2)]; if (!tri.some(open)) keep.push(...tri); }
      geo.setIndex(keep); c.mesh.userData.gapFor = geo.uuid;
    }
  };
  cutCoast();

  // The tan band under the selection's lanes is hidden where the lines now run; the map's other roads stay.
  const litLinks = new Set(seen);
  const hideBand = () => {
    state.scene.getObjectByName("pathways:cross-island")?.traverse(o => {
      if (!o.name.startsWith("pathway:") && !o.name.startsWith("pathway-halo:") && !o.name.startsWith("pathway-plumbing:")) return;
      const route = o.parent?.getObjectByName(o.name.replace(/^pathway(-halo|-plumbing)?:/, "pathway:"));
      const links = (route?.userData.links ?? []) as (string | { from: string; to: string })[];
      if (!links.some(k => litLinks.has(typeof k === "string" ? k : `${k.from}->${k.to}`))) return;
      if (!Object.getOwnPropertyDescriptor(o, "visible")?.get) Object.defineProperty(o, "visible", { get: () => false, set: () => {}, configurable: true });
    });
  };
  hideAll(); hideBand();
  state.invalidate();
  const stats = { sea: SEA, lanes, pieces: pieces.size, lane: LANE, seaDrop: +seaDrop.toFixed(2), ports: portStats };
  return { keep: () => { hideAll(); hideBand(); cutCoast(); state.invalidate(); }, stats };
}
