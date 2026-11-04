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
/** The lane's tone as drawn, for the legend. */
export const LANE_HEX = `#${new Color(SEA_HEX).lerp(new Color(LANE.ink), LANE.mix).getHexString()}`;
/** A line's width in ground units by how many lanes share its stretch: 1, 2-7, 8-31, 32 or more. */
const WIDTHS = [0.32, 0.5, 0.78, 1.15];
const widthOf = (n: number) => WIDTHS[n >= 32 ? 3 : n >= 8 ? 2 : n >= 2 ? 1 : 0]!;
const LIFT = 0.16;
/** A lane passing this near a berth (in ground units) ends on it. */
const SNAP = 10;
/** Polish round 3: the way in eases onto the mouth's berth over IN_STEPS pieces. `?inKink=1` draws it as before. */
const IN_STEPS = 10, IN_KINK = QUERY.get("inKink") === "1";
/** Polish round 1, tried and dropped (README): a port where lanes come ashore on the other islands (`?otherPorts=1`), lanes
 * within CLUSTER units of one another sharing it, drawn at OTHER_SCALE of Keys' size. */
const OTHER_PORTS = QUERY.get("otherPorts") === "1", CLUSTER = 10, OTHER_SCALE = 0.85;
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
  /** The selected island's landings, in its plate's frame: where the road ends, a point out to sea from it, the lanes that
   * come ashore there (`from->to`) and how many of them reach land here. Rollout 1: as many as the map docks lanes at. */
  docks: { at: P; sea: P; lanes: string[]; load: number }[];
  /** The ground's height in the plate's frame, and the light's direction on the ground (toward it). */
  heightAt: (p: P) => number; light: P;
  /** Rollout 1: the island's scale against The library's (layout-core.ts's islandScale): the ports and their reach scale by it. */
  scale?: number;
  post: { faceRatio: number; body: string; ink: string; paper: string; shadow: number; reach: number; wall: { lit: number; away: number } };
};
export type Sea = { keep(): void; stats: Record<string, unknown> };

export function seaLayer({ state, root, story, docks, heightAt, light, post, scale = 1 }: SeaInput): Sea {
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
    const k = (d.load > 1 ? 1 : PORT.small) * scale, coast = { x: d.at.x + u.x * t, z: d.at.z + u.z * t };
    const berth = { x: coast.x + u.x * PORT.berth * scale, z: coast.z + u.z * PORT.berth * scale };
    return { ...d, u, n: { x: -u.z, z: u.x }, k, coast, inland: t, berth };
  });

  // The lanes, piece by piece in world space: each stretch once, in and out alike, with how many lanes share it.
  type Piece = { a: Vector3; b: Vector3; sa: Vector3; sb: Vector3; n: number };
  const pieces = new Map<string, Piece>();
  const q = (w: Vector3) => `${w.x.toFixed(2)},${w.y.toFixed(2)},${w.z.toFixed(2)}`;
  const seen = new Set<string>();
  let lanes = 0, drop = 0, drops = 0;
  /** Polish round 3: each eased curve onto the berth, and the stretch of lane it leaves. */
  const feeds: { curve: string; from: string }[] = [];
  /** Polish round 1: where a lane comes ashore on another island, its port goes there too. */
  const landfalls: { end: Vector3; coast: (typeof coasts)[number] }[] = [];
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
    // The way in: cut where it first comes within SNAP of the mouth's berth, and run straight from there onto the berth.
    // Rollout 1: every lane, in or out, at the port of the dock the map lands it at (round 1 re-routed The library's one
    // way out from the mouth to Keys' landfall; the map now lands it there itself).
    const inPort = ports.find(p => p.lanes.includes(key));
    if (inPort && ownEnd) {
      const order = centre.map((_, i) => i); if (ownEnd === "start") order.reverse();
      const ci = order.find(i => { const r = centre[i]!.clone().applyMatrix4(toRoot); return Math.hypot(r.x - inPort.berth.x, r.z - inPort.berth.z) < SNAP * scale; });
      if (ci !== undefined) {
        skip = i => ownEnd === "end" ? i >= ci : i < ci;
        if (IN_KINK || ci === 0 || ci === centre.length - 1) addPiece(centre[ci]!, berthAt(inPort, centre[ci]!), side[ci]!, side[ci]!, `${q(centre[ci]!)}|berth:${ports.indexOf(inPort)}`);
        else {
          // Polish round 3: the way in left its line at a corner and ran straight onto the berth. It now eases off the line
          // (a cubic, tangent to the lane where it leaves it) and comes onto the berth straight in from the sea.
          const r0 = centre[ci]!.clone().applyMatrix4(toRoot), rb = berthAt(inPort, centre[ci]!).applyMatrix4(toRoot);
          const prev = centre[ownEnd === "end" ? ci - 1 : ci + 1]!.clone().applyMatrix4(toRoot);
          const tl = Math.hypot(r0.x - prev.x, r0.z - prev.z) || 1, t = { x: (r0.x - prev.x) / tl, z: (r0.z - prev.z) / tl };
          const d = Math.hypot(rb.x - r0.x, rb.z - r0.z) * 0.4;
          const c1 = { x: r0.x + t.x * d, z: r0.z + t.z * d }, c2 = { x: rb.x + inPort.u.x * d, z: rb.z + inPort.u.z * d };
          const flat = Array.from({ length: IN_STEPS + 1 }, (_, k) => {
            const u = k / IN_STEPS, w = [(1 - u) ** 3, 3 * u * (1 - u) ** 2, 3 * u * u * (1 - u), u ** 3];
            return new Vector3(w[0]! * r0.x + w[1]! * c1.x + w[2]! * c2.x + w[3]! * rb.x, r0.y + (rb.y - r0.y) * u, w[0]! * r0.z + w[1]! * c1.z + w[2]! * c2.z + w[3]! * rb.z);
          });
          const curve = flat.map(r => r.clone().applyMatrix4(toWorld));
          curve[0] = centre[ci]!.clone();
          // Its side at each point: square to it on the plate, carried into world space as the lane's own sides are.
          const sideAt = (k: number) => {
            const a = flat[Math.max(0, k - 1)]!, b = flat[Math.min(IN_STEPS, k + 1)]!, l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
            const off = flat[k]!.clone().add(new Vector3(-(b.z - a.z) / l, 0, (b.x - a.x) / l)).applyMatrix4(toWorld);
            return off.sub(flat[k]!.clone().applyMatrix4(toWorld)).normalize();
          };
          for (let k = 0; k < IN_STEPS; k++) addPiece(curve[k]!, curve[k + 1]!, sideAt(k), sideAt(k + 1), `${q(centre[ci]!)}|berth:${ports.indexOf(inPort)}:${k}`);
          feeds.push({ curve: `${q(centre[ci]!)}|berth:${ports.indexOf(inPort)}:`, from: [q(centre[ci]!), q(centre[ownEnd === "end" ? ci - 1 : ci + 1]!)].sort().join("|") });
        }
      }
    }
    // Where it first touches the island at its far end (another story's), walking in from the sea: it ends there, at a
    // port, rather than skimming that island's coast to the capability it calls (the map's lanes hug a coast on their way).
    const landAt = new Set<number>();
    let cutFar = (_i: number) => false;
    const far = (c: Vector3) => { const at = islandAt(c); return at && at.story !== story ? at : undefined; };
    if (OTHER_PORTS) {
      const atEnd = far(centre.at(-1)!), atStart = far(centre[0]!);
      if (atEnd) { const j = centre.findIndex((c, i) => i + 1 < centre.length && wet[i] && !wet[i + 1] && islandAt(centre[i + 1]!) === atEnd); if (j >= 0) { landAt.add(j); cutFar = i => i > j; } }
      if (atStart) { let j = -1; for (let i = centre.length - 2; i >= 0; i--) if (wet[i + 1] && !wet[i] && islandAt(centre[i]!) === atStart) { j = i; break; } if (j >= 0) { landAt.add(j); const was = cutFar; cutFar = i => was(i) || i < j; } }
    }
    for (let i = 0; i + 1 < centre.length; i++) {
      let a = centre[i]!, b = centre[i + 1]!;
      if (!wet[i] && !wet[i + 1]) continue;
      if (skip(i) || cutFar(i)) continue;
      if (wet[i] !== wet[i + 1]) {
        // Where it meets the shore, found by halving the piece; near a port it ends on the berth instead.
        let lo = wet[i] ? a : b, hi = wet[i] ? b : a;
        for (let k = 0; k < 14; k++) { const m = lo.clone().lerp(hi, 0.5); if (islandAt(m)) hi = m; else lo = m; }
        const r = lo.clone().applyMatrix4(toRoot), near = ports.find(p => Math.hypot(r.x - p.coast.x, r.z - p.coast.z) < SNAP * scale);
        if (near) lo = berthAt(near, lo);
        if (wet[i]) b = lo; else a = lo;
        const key = [q(centre[i]!), q(centre[i + 1]!)].sort().join("|"), land = !near && landAt.has(i) ? islandAt(hi) : undefined;
        addPiece(a, b, side[i]!, side[i + 1]!, key);
        if (land && land.story !== story && OTHER_PORTS) { const p = pieces.get(key)!; landfalls.push({ end: p.a.distanceTo(lo) < p.b.distanceTo(lo) ? p.a : p.b, coast: land }); }
        continue;
      }
      addPiece(a, b, side[i]!, side[i + 1]!, [q(centre[i]!), q(centre[i + 1]!)].sort().join("|"));
    }
  });
  // The curve onto the berth is as wide as the stretch of lane it leaves, so it does not swell just off the port.
  for (const f of feeds) { const n = pieces.get(f.from)?.n; if (n) for (let k = 0; k < IN_STEPS; k++) { const p = pieces.get(f.curve + k); if (p) p.n = n; } }
  const seaDrop = drops ? drop / drops : 8;

  // Polish round 1: the other islands' ports. Lanes that come ashore near one another on an island share one port, on its
  // coast facing straight out to sea, built in that island's own frame; each lane there ends just off its front.
  type OtherPort = { coast: (typeof coasts)[number]; at: P; u: P; n: P; k: number; top: number; berth: P; lanes: number };
  const otherPorts: OtherPort[] = [];
  for (const c of new Set(landfalls.map(l => l.coast))) {
    const here = landfalls.filter(l => l.coast === c).map(l => ({ l, p: l.end.clone().applyMatrix4(c.inverse) }));
    const at = c.mesh.geometry.getAttribute("position") as BufferAttribute;
    let top = 0; for (let i = 0; i < at.count; i++) top += at.getY(i); top /= at.count || 1;
    const groups: (typeof here)[] = [];
    for (const h of here) { const g = groups.find(g => g.some(o => Math.hypot(o.p.x - h.p.x, o.p.z - h.p.z) < CLUSTER)); if (g) g.push(h); else groups.push([h]); }
    for (const g of groups) {
      const m = { x: g.reduce((s, h) => s + h.p.x, 0) / g.length, z: g.reduce((s, h) => s + h.p.z, 0) / g.length };
      // The nearest point of the coast, and the way out to sea from it.
      let best = { d: Infinity, p: m, t: { x: 1, z: 0 } };
      for (let i = 0; i < c.ring.length; i++) {
        const a = c.ring[i]!, b = c.ring[(i + 1) % c.ring.length]!, ab = { x: b.x - a.x, z: b.z - a.z }, l2 = ab.x * ab.x + ab.z * ab.z || 1;
        const t = Math.max(0, Math.min(1, ((m.x - a.x) * ab.x + (m.z - a.z) * ab.z) / l2)), p = { x: a.x + ab.x * t, z: a.z + ab.z * t }, d = Math.hypot(p.x - m.x, p.z - m.z);
        if (d < best.d) best = { d, p, t: { x: ab.x / Math.sqrt(l2), z: ab.z / Math.sqrt(l2) } };
      }
      // The coast's normal, averaged over a few units either way so a crinkle in the coast does not turn the port.
      let u = { x: -best.t.z, z: best.t.x };
      if (inPolygon({ x: best.p.x + u.x * 0.5, z: best.p.z + u.z * 0.5 }, c.ring)) u = { x: -u.x, z: -u.z };
      const k = PORT.small * OTHER_SCALE, berth = { x: best.p.x + u.x * PORT.berth * k, z: best.p.z + u.z * PORT.berth * k };
      otherPorts.push({ coast: c, at: best.p, u, n: { x: -u.z, z: u.x }, k, top, berth, lanes: g.length });
      for (const h of g) { h.p.x = berth.x; h.p.z = berth.z; h.l.end.copy(h.p.applyMatrix4(c.mesh.matrixWorld)); }
    }
  }

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
  {
    const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(buf.pos, 3)); g.setAttribute("color", new Float32BufferAttribute(buf.col, 3));
    const lineMesh = new Mesh(g, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, depthWrite: false, depthTest: true, transparent: true, opacity: 1, fog: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    lineMesh.renderOrder = 5; lineMesh.raycast = () => {}; group.add(lineMesh);
  }

  // ── The ports: solid shapes, shaded by the light as the gate posts are ─────────────────────────────────────────────
  const dot = (a: P, b: P) => a.x * b.x + a.z * b.z, black = new Color("#000");
  const shade = (base: Color, facing: P) => { const l = Math.hypot(facing.x, facing.z) || 1, k = (dot({ x: facing.x / l, z: facing.z / l }, light) + 1) / 2; return base.clone().multiplyScalar(post.wall.away + (post.wall.lit - post.wall.away) * k); };
  let sides = { pos: [] as number[], col: [] as number[] }, into: Object3D = group;
  const flat = (pts: P[], y: number | ((p: P) => number), c: Color, order: number, opacity = 1) => {
    const geo = new BufferGeometry(), ps: number[] = [], yy = typeof y === "number" ? () => y : y;
    for (let i = 1; i + 1 < pts.length; i++) for (const p of [pts[0]!, pts[i]!, pts[i + 1]!]) ps.push(p.x, yy(p), p.z);
    geo.setAttribute("position", new Float32BufferAttribute(ps, 3));
    const m = new Mesh(geo, new MeshBasicMaterial({ color: c, side: DoubleSide, depthWrite: opacity === 1, depthTest: true, transparent: true, opacity, fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    m.renderOrder = order; m.raycast = () => {}; into.add(m); return m;
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
  /** One port at a coast point, its walls into `sides` and its flats into `into`. */
  const drawPort = (port: { u: P; n: P; k: number; coast: P }, top: number, ground: (p: P) => number) => {
    const { u, n, k } = port;
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
  };
  const flushSides = () => {
    const sg = new BufferGeometry(); sg.setAttribute("position", new Float32BufferAttribute(sides.pos, 3)); sg.setAttribute("color", new Float32BufferAttribute(sides.col, 3));
    const sm = new Mesh(sg, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, depthWrite: true, depthTest: true, fog: false })); sm.renderOrder = 32; sm.raycast = () => {}; into.add(sm);
    sides = { pos: [], col: [] };
  };
  for (const port of ports) { drawPort(port, heightAt(port.coast), ground); portStats.push({ lanes: port.load, roadEndToCoast: +port.inland.toFixed(1) }); }
  flushSides();
  // The other islands' ports, each in its island's frame (the coast's own, carried into the plate's).
  for (const c of new Set(otherPorts.map(p => p.coast))) {
    const frame = new Group(); frame.matrixAutoUpdate = false; frame.matrix.copy(toRoot).multiply(c.mesh.matrixWorld); frame.matrixWorldNeedsUpdate = true;
    group.add(frame); into = frame;
    for (const p of otherPorts.filter(o => o.coast === c)) drawPort({ ...p, coast: p.at }, p.top, () => p.top);
    flushSides();
  }
  into = group;
  // The white coastline breaks in front of each building, where the lanes come in.
  const cutCoast = () => {
    for (const c of own) {
      const geo = c.mesh.geometry; if (c.mesh.userData.gapFor === geo.uuid) continue;
      const at = geo.getAttribute("position") as BufferAttribute, index = geo.getIndex()!, keep: number[] = [];
      const open = (i: number) => { v.set(at.getX(i), at.getY(i), at.getZ(i)).applyMatrix4(c.mesh.matrixWorld).applyMatrix4(toRoot); return ports.some(p => Math.hypot(v.x - p.coast.x, v.z - p.coast.z) < PORT.house.half * p.k + 0.3); };
      for (let t = 0; t < index.count; t += 3) { const tri = [index.getX(t), index.getX(t + 1), index.getX(t + 2)]; if (!tri.some(open)) keep.push(...tri); }
      geo.setIndex(keep); c.mesh.userData.gapFor = geo.uuid;
    }
    for (const c of new Set(otherPorts.map(p => p.coast))) {
      const geo = c.mesh.geometry; if (c.mesh.userData.gapFor === geo.uuid) continue;
      const at = geo.getAttribute("position") as BufferAttribute, index = geo.getIndex(), keep: number[] = [], mine = otherPorts.filter(p => p.coast === c);
      if (!index) continue;
      const open = (i: number) => mine.some(p => Math.hypot(at.getX(i) - p.at.x, at.getZ(i) - p.at.z) < PORT.house.half * p.k + 0.3);
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
  const stats = { sea: SEA, lanes, pieces: pieces.size, lane: LANE, seaDrop: +seaDrop.toFixed(2), ports: portStats, otherPorts: otherPorts.map(p => ({ story: p.coast.story, lanes: p.lanes })) };
  return { keep: () => { hideAll(); hideBand(); cutCoast(); state.invalidate(); }, stats };
}
