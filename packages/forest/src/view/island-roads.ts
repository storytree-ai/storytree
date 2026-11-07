/**
 * Capability 3 · Story node render: each island's roads and gates as drawn (ADR-1236 D1 as narrowed by ADR-1253 D2, rollout 2 step 3),
 * round 11's `sand-faint` look: each road a sandy ribbon on the land, a step wider by the links it carries, its colour
 * mixed into the land under it so the joins stay one road; a disc at each junction; and at each gate a post standing
 * either side of its opening (3.78, step 3b), at each end of a tunnel under a third territory a standing arched portal
 * set back from the border (ADR-1253 D3, question_921aee319481), and each settlement its kind's symbol (3.79, step 4a), all following the island's relief; a picked gate's gold ring
 * (3.88). No arrowheads. Plain three.js, so the marks are read without a browser.
 */
import { BufferGeometry, CircleGeometry, Color, DoubleSide, Float32BufferAttribute, FrontSide, Group, Mesh, MeshBasicMaterial, type Object3D, Vector3 } from "three";
import { inTunnelMouth, MOUTH_ROOM, type IslandRoads } from "../territories/island-roads.js";
import { LIGHT, type IslandRelief } from "../territories/island-relief.js";
import { hollowRing, PICK_GOLD, RING_LEAST_PX } from "./open-work.js";
import { settlementSymbols } from "./settlement-symbols.js";

type Point = { readonly x: number; readonly z: number };

/** The road's sand, mixed into the land under it at this share. */
export const ROAD = { colour: "#e2d3aa", alpha: 0.7 } as const;
/** An island's borders, quietened under the roads. */
export const QUIET_BORDER = { colour: "#f4f7f8", opacity: 0.4 } as const;
/** A gate post's ink and its paper face (round 6C's). */
export const POST = { ink: "#1b2024", paper: "#f3efe4" } as const;
/** A pick's gold: a picked gate's ring (3.88), as a selected capability's (3.91). */
export const LIT = { gold: PICK_GOLD } as const;
/** The island's bare ground as it shows on the page under the see-through fills (the mock's round 11 still). */
export const GROUND = "#686d70";

/** The fill a point of the land shows: a territory's colour at its opacity, or none on open land. */
export type FillAt = (p: Point) => { colour: Color; opacity: number } | undefined;

/** The colour each point of the land shows: its territory's fill over the island's bare ground, or the bare ground. */
export function landColour(fillAt: FillAt): (p: Point) => Color {
  const ground = new Color(GROUND);
  return (p) => { const f = fillAt(p); return f === undefined ? ground.clone() : ground.clone().lerp(f.colour, f.opacity); };
}

/** A standing face's shade, turned away from the light and toward it (round 11's walls and posts). */
export const WALL_SHADE = { lit: 0.84, away: 0.56 } as const;

/** A colour `c` on a standing face looking `facing` on the ground, shaded by how far it turns to the light. */
export function shade(c: Color, facing: Point): Color {
  const l = Math.hypot(facing.x, facing.z) || 1, k = ((facing.x * LIGHT.x + facing.z * LIGHT.z) / l + 1) / 2;
  return c.clone().multiplyScalar(WALL_SHADE.away + (WALL_SHADE.lit - WALL_SHADE.away) * k);
}

/**
 * The roads, junctions and gate posts of `roads`, each point placed on the island's open land by `onGround` and raised
 * as far as the land under it stands in `relief` (3.78), the posts standing up from it.
 */
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
  // Drawn with the see-through territory fills, after them, at full strength: an opaque mark would be drawn first and the fills laid over it.
  const material = (colour?: string | Color, opacity = 1) => new MeshBasicMaterial({ ...(colour === undefined ? { vertexColors: true } : { color: colour }), transparent: true, opacity, side: DoubleSide, forceSinglePass: true, depthWrite: false });
  // A road takes no click, so a click on it picks the land under it (3.15, Mick 2026-11-07: "I don't think we should ever have
  // highlighting or selection of the roads, because we have the gates").
  roads.segments.forEach((segment, i) => {
    const mesh = flat(ribbon(dense(segment.pts), segment.width, onSurface, mix), material(), `road:${i}`, 3);
    mesh.userData = { links: segment.links, width: segment.width };
  });
  roads.junctions.forEach(({ at, width }, i) => {
    const disc = new CircleGeometry(width / 2, 16).rotateX(-Math.PI / 2);
    const corners = disc.getAttribute("position");
    for (let k = 0; k < corners.count; k++) {
      const placed = onSurface({ x: at.x + corners.getX(k), z: at.z + corners.getZ(k) });
      corners.setXYZ(k, placed.x, placed.y, placed.z);
    }
    flat(disc, material(mix(at)), `road-junction:${i}`, 3);
  });
  standingPosts(group, roads, relief, onGround, under);
  tunnelPortals(group, roads, relief, onGround);
  // 3.79: each settlement its kind's symbol, laid flat just over the roads.
  group.add(settlementSymbols(roads, onSurface, 0.05 * relief.scale));
  // 3.88: where a picked gate's ring goes, flat over the plateaus' tops, so it reads round posts on any land.
  const rings = new Group();
  rings.name = "gate-ring";
  rings.userData = { relief, onSurface: (p: Point) => { const v = onGround(p); v.y += relief.height + 0.05 * relief.scale; return v; } };
  group.add(rings);
  return group;
}

/** A standing post's paper face across its top, and its shadow's darkness and reach by its height (round 11's). */
const STANDING = { faceRatio: 0.62, body: "#9aa2a8", shadow: 0.22, reach: 0.8 } as const;

/**
 * The gates' posts standing up (round 11's relief): either side of each opening a slate post shaded by the light, an ink
 * top with a paper face, and a soft shadow on the land away from the light; at a gate with a ramp the posts stand beside
 * it, on the plateau's edge.
 */
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
      // 3.88: a gate's posts take a click, so a gate can be picked, and the pair it joins.
      const post = mesh(positions, colours, solidMaterial, `gate-post:${i}:${sign}`, 4, true);
      post.userData = { gate: true, index: i, between: gate.between, entrances: gate.entrances, links: gate.links, standing: true, height: tall, base };
      const face = square(side * STANDING.faceRatio / 2);
      mesh([face[0]!, face[1]!, face[2]!, face[0]!, face[2]!, face[3]!].flatMap((q) => v(q, tall + 0.02 * relief.scale)), undefined, faceMaterial, `gate-face:${i}:${sign}`, 5);
      // Its shadow: the footprint swept away from the light, flat on the land beside it.
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

/** A tunnel portal's arch: its stone's colour, its headwall's band over the mouth and how far it reaches either side by
 * that band, and how high the mouth's sides stand before the arch springs, as shares of the mouth's half-width, its
 * mouth's darkness, how far back its face leans by its height, reaching at most
 * this share of its tunnel's length in, how far in under it its road's floor shows, by that lean and how far its coping
 * runs back into the rise, by its band. */
export const PORTAL = { stone: "#f3efe4", band: 0.28, wing: 2.2, spring: 0.12, mouth: "#15191c", lean: 1.0, most: 0.3, floor: 0.7, dusk: 0.8, lip: 2.2 } as const;
/** A portal's road's half-width, from the portal's width (its road's and the room either side, island-roads.ts's MOUTH). */
const roadHalf = (width: number, scale: number) => (width - MOUTH_ROOM * scale) / 2;

/**
 * Each tunnel's portals (ADR-1253 D3, question_921aee319481): where a road goes under a third territory, a stone headwall
 * standing at its mouth, set back from the border, leaning into the end of the rise over the tunnel: a dark arched mouth a
 * little wider than the road, its sides standing and its top round, its road running on into the dark, in a square face of
 * stone shaded by where it faces, its coping running back into the rise. A portal standing as its road's gate takes a click
 * as that gate (3.88); any other takes none, so the land under it is picked.
 */
function tunnelPortals(group: Group, roads: IslandRoads, relief: IslandRelief, onGround: (p: Point) => Vector3): void {
  const mouth = new MeshBasicMaterial({ color: PORTAL.mouth, transparent: true, opacity: 1, side: FrontSide, forceSinglePass: true, depthWrite: false });
  roads.portals.forEach((portal, i) => {
    // At the foot of the rise, lower than it, its face leaning back into it.
    const r = portal.width / 2, band = r * PORTAL.band, spring = r * PORTAL.spring, tall = spring + r + band;
    // Leaning no further in than a share of its tunnel, so the two mouths of a short one stand apart.
    const tunnel = relief.tunnels.find((t) => [t.pts[0]!, t.pts.at(-1)!].some((q) => Math.hypot(q.x - portal.at.x, q.z - portal.at.z) < 1e-6));
    const run = tunnel === undefined ? Infinity : tunnel.pts.reduce((s, q, k) => (k ? s + Math.hypot(q.x - tunnel.pts[k - 1]!.x, q.z - tunnel.pts[k - 1]!.z) : 0), 0);
    const base = onGround(portal.at).y + relief.raise(portal.at) + 0.02 * relief.scale, lean = Math.min(PORTAL.lean, run * PORTAL.most / tall);
    // A point of the arch's face: `u` across the mouth, `v` up it.
    const face = (u: number, v: number) => {
      const g = onGround({ x: portal.at.x + portal.along.x * u + portal.into.x * v * lean, z: portal.at.z + portal.along.z * u + portal.into.z * v * lean });
      return [g.x, base + v, g.z];
    };
    // The outline of an arch `w` in half-width: up its one side, round its top, down the other.
    const outline = (w: number) => [[-w, 0], [-w, spring], ...Array.from({ length: 13 }, (_, k) => { const a = Math.PI - k * Math.PI / 12; return [w * Math.cos(a), spring + w * Math.sin(a)]; }), [w, 0]] as [number, number][];
    const inner = outline(r), dark: number[] = [], ring: number[] = [], colours: number[] = [];
    const stone = new Color(PORTAL.stone), front = shade(stone, { x: -portal.into.x, z: -portal.into.z }), top = stone.clone().multiplyScalar(WALL_SHADE.lit + 0.1);
    // Each face wound to look out of the rise along the road, so from behind, as the eye sees a mouth facing away, only the
    // coping over it shows.
    const out = new Vector3(-portal.into.x, 0.2, -portal.into.z);
    const wound = (a: number[], b: number[], c: number[]) => {
      const n = new Vector3(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!).cross(new Vector3(c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!));
      return n.dot(out) >= 0 ? [...a, ...b, ...c] : [...a, ...c, ...b];
    };
    const tri = (into: number[], a: number[], b: number[], c: number[]) => into.push(...wound(a, b, c));
    const quad = (a: number[], b: number[], c: number[], d: number[], colour: Color) => { tri(ring, a, b, c); tri(ring, a, c, d); for (let k = 0; k < 6; k++) colours.push(colour.r, colour.g, colour.b); };
    // Its headwall: a square face of stone round the arch, `wide` either side and up to `high`, each point of the arch matched
    // to where the ray from the arch's centre through it meets the face's edge.
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
    // The corners the rays miss, between the arch's top and the face's upper corners.
    for (const side of [-1, 1]) {
      const corner = face(side * wide, high), atTop = edge([0, spring + r]), atSide = edge([side * r * Math.SQRT1_2, spring + r * Math.SQRT1_2]);
      tri(ring, corner, face(atTop[0], atTop[1]), face(atSide[0], atSide[1]));
      for (let k = 0; k < 3; k++) colours.push(front.r, front.g, front.b);
    }
    // Its coping: the headwall's top, running back into the rise, a straight bar of stone across the road from above.
    const back = (u: number, v: number) => { const q = face(u, v); return [q[0]! + portal.into.x * band * PORTAL.lip, q[1]!, q[2]! + portal.into.z * band * PORTAL.lip]; };
    // Its top faces up, so it shows from either side.
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
    // The road running on into the dark, its sand darkening under the arch and fading out into the mouth.
    const half = Math.min(r * 0.8, roadHalf(portal.width, relief.scale)), deep = Math.max(...inner.map(([, v]) => v)) * lean * PORTAL.floor;
    const ground = (u: number, w: number) => { const g = onGround({ x: portal.at.x + portal.along.x * u + portal.into.x * w, z: portal.at.z + portal.along.z * u + portal.into.z * w }); return [g.x, base + 0.01 * relief.scale, g.z]; };
    const lit = new Color(ROAD.colour).lerp(new Color(PORTAL.mouth), 0.45);
    // It darkens on the road a little way out of the mouth too, so a mouth facing away still shows its road going under.
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

/** A picked gate: its place in the island's gates, and the two sides it joins (3.88). */
export type GatePick = { readonly gate: number; readonly between: readonly [string, string] };

/**
 * What a click on `mark` picks: a gate (its posts, or a portal standing as its road's gate) picks itself and the pair of
 * capabilities it joins, whichever way their links run (3.88, Mick 2026-11-05: "the gate should show the circle when i select
 * this"). Anything else picks nothing of its own.
 */
export function gateOf(mark: Object3D): GatePick | undefined {
  const { gate, index, between } = mark.userData as { gate?: true; index?: number; between?: readonly [string, string] };
  return gate === true && index !== undefined && between !== undefined ? { gate: index, between } : undefined;
}

/** A picked gate's ring's room round its posts' outer corners (beside a ramp, set back off it), as a share of their reach. */
const GATE_RING_ROOM = 1.3;

/**
 * Ring `pick` on the road marks `islandRoadMarks` drew for `roads`, putting out the ring drawn before: a hollow gold ring round
 * its posts, drawn for an eye at `zoom` (CSS px per ground unit), whose line `sizeOpenWork` keeps one width on screen at any
 * other, as the selected arc's rings do (3.88).
 */
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

/** A way resampled every half unit, so its colour follows the land under it. */
function dense(pts: readonly Point[]): Point[] {
  const out: Point[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n });
  }
  return out;
}

/** A flat ribbon `width` wide along `points` on the surface, coloured per point by `colourAt` when given. */
function ribbon(points: readonly Point[], width: number, onSurface: (p: Point) => Vector3, colourAt?: (p: Point) => Color): BufferGeometry {
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

/** The segments of the border lines `borders` left once each opening (a gate's, or open road's) is cut out of them: every
 * border line within half its opening of where it stands, so one at a corner is open on both lines that meet there. */
export function cutOpenings(borders: readonly { from: Point; to: Point }[], gates: readonly { readonly at: Point; readonly opening: number }[]): { from: Point; to: Point }[] {
  return borders.flatMap(({ from: a, to: b }) => {
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l < 1e-9) return [];
    const holes = gates.flatMap((g) => {
      // Where the line meets the circle of half the opening round the gate.
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

/** The fill each point of `map`'s land shows in `land` (its territories as `territoryLand` drew them): the nearest cell's. */
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
