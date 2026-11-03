/** The sea lane, round 12's first look (`?sea=<key>`): at sea every route is one thin quiet cartographer's line, as charts draw
 * shipping lanes, and the two options differ only in how that line meets the island's sandy trunk.
 * - the line: the map's own lanes (pathways:selection-lanes, each lane's userData naming its ends) followed piece by piece,
 *   each stretch drawn once however many lanes share it, a step wider where it carries more (1, 2-7, 8-31, 32+ links; the
 *   widest is the trunk's own 1.3), in the trunk's sand for the way in and a pale sea-grey teal for the way out, mixed
 *   opaque into the sea so shared stretches show no knots; it stops at every island's coast. The map's purple and teal
 *   lanes, their glow, their end pips and the tan band they ride (pathways:cross-island) are hidden under it;
 * - `station`: one small landing mark on the shore where the line ends and the trunk begins: a flat ink-edged square, its
 *   face in the line's tone, turned to the line, like a cable landing station or a port symbol on a chart;
 * - `gap`: the island's white coastline breaks where the line comes in, with a standing gate post either side at the shore
 *   (round 11's posts, entrance size), so the coast itself is the story's front door;
 * - `map`: the map's own lanes, as round 11 drew them. */
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, Vector3,
  type BufferAttribute, type Object3D } from "three";
import type { RootState } from "@react-three/fiber";

type P = { x: number; z: number };
export type SeaKey = "station" | "gap" | "map";
const QUERY = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
export const SEA: SeaKey = (["station", "gap", "map"] as const).find(k => k === QUERY.get("sea")) ?? "station";

/** The sea as it shows on the page under the lines, and the two tones mixed into it. */
const SEA_HEX = "#17222b";
const TONE = { down: { ink: "#e2d3aa", mix: 0.7 }, up: { ink: "#a9d2d8", mix: 0.68 } } as const;
/** A line's width in ground units by the links its stretch carries: 1, 2-7, 8-31, 32 or more. */
const WIDTHS = [0.34, 0.55, 0.85, 1.3];
const widthOf = (n: number) => WIDTHS[n >= 32 ? 3 : n >= 8 ? 2 : n >= 2 ? 1 : 0]!;
const LIFT = 0.16;
/** How far from the mouth the way out's reach from Keys joins its line, in ground units. */
const JOIN_CLEAR = 80;
/** In `gap`, the coastline's opening either side of the line, beyond its half width, in ground units. */
const GAP = 2.2;
/** A line that comes ashore this near a landing (in ground units) ends on the landing itself. */
const SNAP = 9;
/** How far off the coast the reach from Keys' landfall rounds the island, in ground units. */
const OFFSHORE = 6;
/** Within this many ground units of a landing the line is drawn over everything, so it climbs the shore unbroken. */
const NEAR = 14;

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
  /** The selected island's landings, in its plate's frame: the mouth (the trunk's start) and the way out to Keys. */
  docks: { at: P; sea?: P; dir: "down" | "up" }[];
  /** The ground's height in the plate's frame, and the light's direction on the ground (toward it). */
  heightAt: (p: P) => number; light: P;
  post: { side: number; height: number; faceRatio: number; body: string; ink: string; paper: string; shadow: number; reach: number; wall: { lit: number; away: number } };
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

  // The lanes, piece by piece in world space: each stretch once per colour, with how many lanes share it.
  type Piece = { a: Vector3; b: Vector3; sa: Vector3; sb: Vector3; dir: "up" | "down"; n: number; shore?: "a" | "b" };
  const pieces = new Map<string, Piece>();
  const q = (w: Vector3) => `${w.x.toFixed(2)},${w.y.toFixed(2)},${w.z.toFixed(2)}`;
  const seen = new Set<string>();
  const joins: { to: Vector3; next: Vector3; dock: SeaInput["docks"][number] }[] = [];
  let lanes = 0;
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
    // The way out: the map sends it from the mouth, but the island's own road leaves at Keys' landfall, so the line is
    // taken from the nearest point of its way to Keys' offshore point, and a new reach joins it to Keys' landfall.
    let skip = (_i: number) => false;
    const outDock = docks.find(d => d.dir === "up" && d.sea);
    if (dir === "up" && outDock) {
      const ownEnd = islandAt(centre.at(-1)!)?.story === story ? "end" : islandAt(centre[0]!)?.story === story ? "start" : undefined;
      if (ownEnd) {
        // The join: the first point of its way, walking out from the island, well clear of the mouth.
        const mouth = docks.find(d => d.dir === "down")?.at ?? outDock.at;
        const order = centre.map((_, i) => i); if (ownEnd === "end") order.reverse();
        const best = order.find(i => { if (!wet[i]) return false; const r = centre[i]!.clone().applyMatrix4(toRoot); return Math.hypot(r.x - mouth.x, r.z - mouth.z) > JOIN_CLEAR; }) ?? -1;
        if (best >= 0) {
          skip = i => ownEnd === "end" ? i >= best : i < best;
          const next = centre[Math.max(0, Math.min(centre.length - 1, best + (ownEnd === "end" ? -8 : 8)))]!;
          joins.push({ to: centre[best]!, next, dock: outDock });
        }
      }
    }
    // The way in: the map's lane runs on along the coast to its own dock, so it is cut where it first comes within SNAP
    // of the mouth and runs straight from there onto the mouth, where the trunk begins.
    const inDock = docks.find(d => d.dir === "down");
    if (dir === "down" && inDock) {
      const ownEnd = islandAt(centre.at(-1)!)?.story === story ? "end" : islandAt(centre[0]!)?.story === story ? "start" : undefined;
      if (ownEnd) {
        const order = centre.map((_, i) => i); if (ownEnd === "start") order.reverse();
        const ci = order.find(i => { const r = centre[i]!.clone().applyMatrix4(toRoot); return Math.hypot(r.x - inDock.at.x, r.z - inDock.at.z) < SNAP; });
        if (ci !== undefined) {
          skip = i => ownEnd === "end" ? i >= ci : i < ci;
          const at = new Vector3(inDock.at.x, heightAt(inDock.at), inDock.at.z).applyMatrix4(root.matrixWorld), k = `${dir}|${q(centre[ci]!)}|mouth`, was = pieces.get(k);
          if (was) was.n++; else pieces.set(k, { a: centre[ci]!, b: at, sa: side[ci]!, sb: side[ci]!, dir, n: 1, shore: "b" });
        }
      }
    }
    for (let i = 0; i + 1 < centre.length; i++) {
      let a = centre[i]!, b = centre[i + 1]!, shore: Piece["shore"];
      if (!wet[i] && !wet[i + 1]) continue;
      if (skip(i)) continue;
      if (wet[i] !== wet[i + 1]) {
        // Where it meets the shore, found by halving the piece.
        let lo = wet[i] ? a : b, hi = wet[i] ? b : a;
        for (let k = 0; k < 14; k++) { const m = lo.clone().lerp(hi, 0.5); if (islandAt(m)) hi = m; else lo = m; }
        // A line coming ashore near a landing ends on it, where the trunk begins.
        const r = lo.clone().applyMatrix4(toRoot), near = docks.find(d => Math.hypot(r.x - d.at.x, r.z - d.at.z) < SNAP);
        if (near) lo = new Vector3(near.at.x, heightAt(near.at), near.at.z).applyMatrix4(root.matrixWorld);
        if (wet[i]) { b = lo; shore = "b"; } else { a = lo; shore = "a"; }
      }
      const k = `${dir}|${[q(centre[i]!), q(centre[i + 1]!)].sort().join("|")}`, was = pieces.get(k);
      if (was) was.n++; else pieces.set(k, { a, b, sa: side[i]!, sb: side[i + 1]!, dir, n: 1, ...shore ? { shore } : {} });
    }
  });

  // Draw them in the plate's frame, lifted off the sea along the globe's normal.
  const group = new Group(); group.name = "mock-sea"; root.add(group);
  const local = (w: Vector3, up: number) => w.clone().addScaledVector(w.clone().normalize(), up).applyMatrix4(toRoot);
  const sea = new Color(SEA_HEX), tone = { down: sea.clone().lerp(new Color(TONE.down.ink), TONE.down.mix), up: sea.clone().lerp(new Color(TONE.up.ink), TONE.up.mix) };
  // Two meshes: the open sea, depth tested so an island's cliff hides the sea behind it, and the last reach to each
  // landing, drawn over everything so the line climbs the shore unbroken.
  const buf = { far: { pos: [] as number[], col: [] as number[] }, near: { pos: [] as number[], col: [] as number[] } };
  const push = (vs: Vector3[], c: Color, near = false) => { const b = near ? buf.near : buf.far; for (const p of vs) { b.pos.push(p.x, p.y, p.z); b.col.push(c.r, c.g, c.b); } };
  const nearDock = (w: Vector3) => { const r = w.clone().applyMatrix4(toRoot); return docks.some(d => Math.hypot(r.x - d.at.x, r.z - d.at.z) < NEAR); };
  const own = coasts.filter(c => c.story === story);
  for (const p of pieces.values()) {
    const h = widthOf(p.n) / 2, c = tone[p.dir], near = nearDock(p.a) || nearDock(p.b);
    const A1 = local(p.a.clone().addScaledVector(p.sa, h), LIFT), A2 = local(p.a.clone().addScaledVector(p.sa, -h), LIFT);
    const B1 = local(p.b.clone().addScaledVector(p.sb, h), LIFT), B2 = local(p.b.clone().addScaledVector(p.sb, -h), LIFT);
    push([A1, A2, B1, A2, B2, B1], c, near);
  }
  // The reach from Keys' landfall out to the way out's line: offshore, pushed off the island wherever it would cross it.
  const toWorld = root.matrixWorld;
  /** Open sea at p and for 6 units round it. */
  const wetLocal = (p: P, y: number) => [[0, 0], ...Array.from({ length: 8 }, (_, k) => [6 * Math.cos(k * Math.PI / 4), 6 * Math.sin(k * Math.PI / 4)])]
    .every(([dx, dz]) => !islandAt(new Vector3(p.x + dx!, y, p.z + dz!).applyMatrix4(toWorld)));
  const catmull = (pts: P[]) => {
    const out: P[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(pts.length - 1, i + 2)]!, n = Math.max(4, Math.ceil(Math.hypot(p2.x - p1.x, p2.z - p1.z)));
      for (let k = 0; k < n; k++) { const t = k / n, t2 = t * t, t3 = t2 * t, f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3); out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) }); }
    }
    out.push(pts.at(-1)!); return out;
  };
  for (const j of joins) {
    const end = local(j.to, 0), endP = { x: end.x, z: end.z }, y0 = heightAt(j.dock.at), y1 = end.y;
    const out = { x: j.dock.sea!.x - j.dock.at.x, z: j.dock.sea!.z - j.dock.at.z }, ol = Math.hypot(out.x, out.z) || 1;
    const sea0 = { x: j.dock.at.x + out.x / ol * 4, z: j.dock.at.z + out.z / ol * 4 };
    // Round the island a few units off its coast (the coast pushed out, sampled every few units), from abreast of the
    // landfall to abreast of the join, the shorter way round, then on into the line along its own direction.
    const ring = own.flatMap(c => c.ring.map(p => new Vector3(p.x, 0, p.z).applyMatrix4(c.mesh.matrixWorld).applyMatrix4(toRoot)))
      .map(w => ({ x: w.x, z: w.z }));
    const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length, cz = ring.reduce((s, p) => s + p.z, 0) / ring.length;
    const angle = (p: P) => Math.atan2(p.z - cz, p.x - cx);
    /** The coast's farthest reach from its middle at each bearing, pushed out by OFFSHORE. */
    const reachAt = (t: number) => { let r = 0; for (const p of ring) { const d = Math.abs(((angle(p) - t + 3 * Math.PI) % (2 * Math.PI)) - Math.PI); if (d < 0.6) r = Math.max(r, Math.hypot(p.x - cx, p.z - cz)); } return r + OFFSHORE; };
    const t0 = angle(sea0), t1 = angle(endP);
    let dt = t1 - t0; while (dt > Math.PI) dt -= 2 * Math.PI; while (dt < -Math.PI) dt += 2 * Math.PI;
    const steps = Math.max(2, Math.ceil(Math.abs(dt) / 0.3)), round: P[] = [];
    for (let k = 1; k < steps; k++) { const t = t0 + dt * k / steps, r = reachAt(t); round.push({ x: cx + Math.cos(t) * r, z: cz + Math.sin(t) * r }); }
    const nx = local(j.next, 0), nextP = { x: nx.x, z: nx.z };
    const all = catmull([j.dock.at, sea0, ...round, endP, nextP]);
    let kEnd = 0, dEnd = Infinity; all.forEach((p, i) => { const dd = Math.hypot(p.x - endP.x, p.z - endP.z); if (dd < dEnd) { dEnd = dd; kEnd = i; } });
    const path = all.slice(0, kEnd + 1);
    const h = WIDTHS[0]! / 2, c = tone.up, yAt = (i: number) => (i < 4 ? y0 + (y1 - y0) * i / 4 : y1) + LIFT;
    path.forEach((p, i) => {
      if (i === 0) return;
      const a = path[i - 1]!, l = Math.hypot(p.x - a.x, p.z - a.z) || 1, n = { x: -(p.z - a.z) / l * h, z: (p.x - a.x) / l * h };
      const ya = yAt(i - 1), yb = yAt(i);
      const A1 = new Vector3(a.x + n.x, ya, a.z + n.z), A2 = new Vector3(a.x - n.x, ya, a.z - n.z), B1 = new Vector3(p.x + n.x, yb, p.z + n.z), B2 = new Vector3(p.x - n.x, yb, p.z - n.z);
      push([A1, A2, B1, A2, B2, B1], c, i < NEAR);
    });
  }
  for (const [which, b] of Object.entries(buf)) {
    const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(b.pos, 3)); g.setAttribute("color", new Float32BufferAttribute(b.col, 3));
    const lineMesh = new Mesh(g, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, depthWrite: false, depthTest: which === "far", transparent: true, opacity: 1, fog: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    lineMesh.renderOrder = which === "far" ? 5 : 6; lineMesh.raycast = () => {}; group.add(lineMesh);
  }

  // Where the lines come ashore on the selected island: one landfall per dock, as wide as the widest line reaching it.
  const landfalls = docks.map(d => {
    let width = 0, along = d.sea ? { x: d.sea.x - d.at.x, z: d.sea.z - d.at.z } : { x: 1, z: 0 }, nearest = Infinity;
    for (const p of pieces.values()) if (p.dir === d.dir) for (const [end, other] of [[p.a, p.b], [p.b, p.a]] as const) {
      const w = end.clone().applyMatrix4(toRoot), dd = Math.hypot(w.x - d.at.x, w.z - d.at.z);
      if (dd < 8) width = Math.max(width, widthOf(p.n));
      if (p.shore && dd < 6 && dd < nearest) { nearest = dd; const o = other.clone().applyMatrix4(toRoot); along = { x: o.x - w.x, z: o.z - w.z }; }
    }
    const l = Math.hypot(along.x, along.z) || 1;
    return { ...d, width: width || WIDTHS[0]!, seaward: { x: along.x / l, z: along.z / l } };
  });

  const flat = (pts: P[], up: number, c: Color, order: number, opts: { depth?: boolean } = {}) => {
    const geo = new BufferGeometry(), ps: number[] = [];
    for (let i = 1; i + 1 < pts.length; i++) for (const p of [pts[0]!, pts[i]!, pts[i + 1]!]) ps.push(p.x, heightAt(p) + up, p.z);
    geo.setAttribute("position", new Float32BufferAttribute(ps, 3));
    const m = new Mesh(geo, new MeshBasicMaterial({ color: c, side: DoubleSide, depthWrite: !!opts.depth, depthTest: !!opts.depth, transparent: true, opacity: 1, fog: false }));
    m.renderOrder = order; m.raycast = () => {}; group.add(m); return m;
  };
  const square = (c: P, u: P, half: number): P[] => { const n = { x: -u.z, z: u.x }; return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: c.x + (u.x * i! + n.x * j!) * half, z: c.z + (u.z * i! + n.z * j!) * half })); };

  const stats: Record<string, unknown> = { sea: SEA, lanes, pieces: pieces.size, landfalls: landfalls.map(l => ({ dir: l.dir, width: l.width })) };
  if (SEA === "station") {
    // A flat landing mark on the shore, turned to the line: an ink edge, its face in the line's tone.
    for (const l of landfalls) {
      const half = l.dir === "down" ? 1.05 : 0.8;
      flat(square(l.at, l.seaward, half + 0.28), LIFT + 0.05, new Color(post.ink), 30);
      flat(square(l.at, l.seaward, half), LIFT + 0.07, tone[l.dir].clone().lerp(new Color(post.paper), 0.35), 31);
    }
  } else {
    // A gate in the coast: the white line cut where the line comes in, a standing post either side at the shore.
    const cutCoast = () => {
      for (const c of own) {
        const geo = c.mesh.geometry; if (c.mesh.userData.gapFor === geo.uuid) continue;
        const at = geo.getAttribute("position") as BufferAttribute, index = geo.getIndex()!, keep: number[] = [];
        const open = (i: number) => { v.set(at.getX(i), at.getY(i), at.getZ(i)).applyMatrix4(c.mesh.matrixWorld).applyMatrix4(toRoot); return landfalls.some(l => Math.hypot(v.x - l.at.x, v.z - l.at.z) < l.width / 2 + GAP + 0.3); };
        for (let t = 0; t < index.count; t += 3) { const tri = [index.getX(t), index.getX(t + 1), index.getX(t + 2)]; if (!tri.some(open)) keep.push(...tri); }
        geo.setIndex(keep); c.mesh.userData.gapFor = geo.uuid;
      }
    };
    cutCoast();
    const dot = (a: P, b: P) => a.x * b.x + a.z * b.z, body = new Color(post.body), ink = new Color(post.ink), black = new Color("#000");
    const shade = (facing: P) => { const l = Math.hypot(facing.x, facing.z) || 1, k = (dot({ x: facing.x / l, z: facing.z / l }, light) + 1) / 2; return body.clone().multiplyScalar(post.wall.away + (post.wall.lit - post.wall.away) * k); };
    const sides: number[] = [], sideCol: number[] = [];
    for (const l of landfalls) {
      const along = { x: -l.seaward.z, z: l.seaward.x }, s = l.dir === "down" ? post.side : post.side * 0.85, tall = l.dir === "down" ? post.height : post.height * 0.85;
      for (const sgn of [-1, 1]) {
        const c = { x: l.at.x + along.x * (l.width / 2 + GAP + s / 2) * sgn, z: l.at.z + along.z * (l.width / 2 + GAP + s / 2) * sgn };
        const foot = square(c, l.seaward, s / 2), base = heightAt(c);
        // Its shadow, then its four sides, then its ink top with a paper face.
        const away = { x: -light.x * tall * post.reach, z: -light.z * tall * post.reach };
        flat([...foot.map(p => ({ x: p.x + away.x, z: p.z + away.z }))], 0.04, new Color(SEA_HEX).lerp(black, post.shadow), 28);
        for (let i = 0; i < 4; i++) {
          const a = foot[i]!, b = foot[(i + 1) % 4]!, face = shade({ x: (a.x + b.x) / 2 - c.x, z: (a.z + b.z) / 2 - c.z });
          for (const [p, up] of [[a, 0], [b, 0], [b, tall], [a, 0], [b, tall], [a, tall]] as [P, number][]) { sides.push(p.x, base + up, p.z); sideCol.push(face.r, face.g, face.b); }
        }
        flat(foot, tall, ink, 33, { depth: true }).position.y = 0;
        flat(square(c, l.seaward, s / 2 * post.faceRatio), tall + 0.02, new Color(post.paper), 34, { depth: true });
      }
    }
    const sg = new BufferGeometry(); sg.setAttribute("position", new Float32BufferAttribute(sides, 3)); sg.setAttribute("color", new Float32BufferAttribute(sideCol, 3));
    const sm = new Mesh(sg, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, depthWrite: true, depthTest: true, fog: false })); sm.renderOrder = 32; sm.raycast = () => {}; group.add(sm);
    stats.gap = true;
    const keepGap = cutCoast; (stats as { keepGap?: () => void }).keepGap = keepGap;
  }

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
  const keepGap = (stats as { keepGap?: () => void }).keepGap; delete stats.keepGap;
  state.invalidate();
  return { keep: () => { hideAll(); hideBand(); keepGap?.(); state.invalidate(); }, stats };
}
