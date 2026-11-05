/**
 * Capability 3 · Story node render: each island's roads and gates as drawn (ADR-1236 D1 as narrowed by ADR-1253 D2, rollout 2 step 3),
 * round 11's `sand-faint` look: each road a sandy ribbon on the land, a step wider by the links it carries, its colour
 * mixed into the land under it so the joins stay one road; a disc at each junction; and at each gate a post standing
 * either side of its opening (3.78, step 3b), at each end of a tunnel under a third territory an arched portal (ADR-1253
 * D3), and each settlement its kind's symbol (3.79, step 4a), all following the island's relief. No arrowheads. Plain three.js, so the marks are read without a browser.
 */
import { BufferGeometry, CircleGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, type Object3D, type Vector3 } from "three";
import type { IslandRoads } from "../territories/island-roads.js";
import { LIGHT, type IslandRelief } from "../territories/island-relief.js";
import { settlementSymbols } from "./settlement-symbols.js";

type Point = { readonly x: number; readonly z: number };

/** The road's sand, mixed into the land under it at this share. */
export const ROAD = { colour: "#e2d3aa", alpha: 0.7 } as const;
/** An island's borders, quietened under the roads. */
export const QUIET_BORDER = { colour: "#f4f7f8", opacity: 0.4 } as const;
/** A gate post's ink and its paper face (round 6C's). */
export const POST = { ink: "#1b2024", paper: "#f3efe4" } as const;
/** A picked link's gold, and the thin dark edge it lies on so it holds on yellow land (the mock's PALETTE.lit and casing). */
export const LIT = { gold: "#ffd34d", edge: "#141a20", edgeOpacity: 0.75, edgeWidth: 0.6 } as const;
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
  const flat = (geometry: BufferGeometry, material: MeshBasicMaterial, name: string, order: number, into: Group = group, pickable = false) => {
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.renderOrder = order;
    if (!pickable) mesh.raycast = () => {};
    into.add(mesh);
    return mesh;
  };
  // Drawn with the see-through territory fills, after them, at full strength: an opaque mark would be drawn first and the fills laid over it.
  const material = (colour?: string | Color, opacity = 1) => new MeshBasicMaterial({ ...(colour === undefined ? { vertexColors: true } : { color: colour }), transparent: true, opacity, side: DoubleSide, forceSinglePass: true, depthWrite: false });
  // 3.81: a road takes a click, so a link can be picked by a road it runs along.
  roads.segments.forEach((segment, i) => {
    const mesh = flat(ribbon(dense(segment.pts), segment.width, onSurface, mix), material(), `road:${i}`, 3, group, true);
    mesh.userData = { road: true, links: segment.links, width: segment.width };
  });
  // 3.81: each road's gold on its dark edge, round at its ends so lit roads join, hidden until a pick lights it.
  const gold = material(LIT.gold), edge = material(LIT.edge, LIT.edgeOpacity), rim = LIT.edgeWidth * relief.scale;
  const lifted = (by: number) => (p: Point) => { const v = onSurface(p); v.y += by * relief.scale; return v; };
  const cap = (at: Point, radius: number, by: number, colour: MeshBasicMaterial, name: string, order: number, into: Group) => {
    const disc = new CircleGeometry(radius, 16).rotateX(-Math.PI / 2), corners = disc.getAttribute("position");
    for (let k = 0; k < corners.count; k++) { const placed = lifted(by)({ x: at.x + corners.getX(k), z: at.z + corners.getZ(k) }); corners.setXYZ(k, placed.x, placed.y, placed.z); }
    flat(disc, colour, name, order, into);
  };
  roads.segments.forEach((segment, i) => {
    const lit = new Group(), way = dense(segment.pts);
    lit.name = `road-lit:${i}`;
    lit.visible = false;
    flat(ribbon(way, segment.width + rim, lifted(0.02)), edge, `road-lit-edge:${i}`, 3.6, lit);
    flat(ribbon(way, segment.width, lifted(0.03)), gold, `road-lit-gold:${i}`, 3.7, lit);
    for (const end of [segment.pts[0]!, segment.pts.at(-1)!]) {
      cap(end, (segment.width + rim) / 2, 0.02, edge, `road-lit-edge-end:${i}`, 3.6, lit);
      cap(end, segment.width / 2, 0.03, gold, `road-lit-gold-end:${i}`, 3.7, lit);
    }
    group.add(lit);
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
  roads.gates.forEach((gate, i) => {
    // Each gate's own paper, so a pick can light one gate's faces gold (3.81).
    const faceMaterial = new MeshBasicMaterial({ color: POST.paper, transparent: true, opacity: 1, side: DoubleSide, forceSinglePass: true });
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
      // 3.81: a gate's posts take a click, so a link can be picked by the gate it enters by.
      const post = mesh(positions, colours, solidMaterial, `gate-post:${i}:${sign}`, 4, true);
      post.userData = { gate: true, entrances: gate.entrances, links: gate.links, standing: true, height: tall, base };
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

/** A tunnel portal's arch: its stone's colour, its band across, its mouth's darkness, and how deep it reaches by its width. */
export const PORTAL = { stone: "#f3efe4", band: 0.8, mouth: "#15191c", depth: 0.8 } as const;

/**
 * Each tunnel's portals (ADR-1253 D3): where a road goes under a third territory, an arch laid on that territory's land at
 * its border, as the eye sees a tunnel's mouth from above: a dark mouth reaching in from the border where the road ends,
 * ringed by a band of stone shaded by the light. A portal takes a click, and picks the links it carries.
 */
function tunnelPortals(group: Group, roads: IslandRoads, relief: IslandRelief, onGround: (p: Point) => Vector3): void {
  const at = (p: Point, d: Point, k: number): Point => ({ x: p.x + d.x * k, z: p.z + d.z * k });
  const mouth = new MeshBasicMaterial({ color: PORTAL.mouth, transparent: true, opacity: 1, side: DoubleSide, forceSinglePass: true, depthWrite: false });
  const arched = new MeshBasicMaterial({ color: shade(new Color(PORTAL.stone), LIGHT), transparent: true, opacity: 1, side: DoubleSide, forceSinglePass: true, depthWrite: false });
  roads.portals.forEach((portal, i) => {
    // On the land it goes under, just over its rim.
    const base = onGround(portal.at).y + relief.raise(at(portal.at, portal.into, 0.6 * relief.scale)) + 0.08 * relief.scale;
    const r = portal.width / 2, band = PORTAL.band * relief.scale;
    const arc = (radius: number, k: number) => { const a = k * Math.PI / 12, q = at(at(portal.at, portal.along, radius * Math.cos(a)), portal.into, radius * Math.sin(a) * PORTAL.depth); return [q.x, base, q.z]; };
    const inner: number[] = [], ring: number[] = [];
    for (let k = 0; k < 12; k++) {
      inner.push(portal.at.x, base, portal.at.z, ...arc(r, k), ...arc(r, k + 1));
      ring.push(...arc(r, k), ...arc(r + band, k), ...arc(r + band, k + 1), ...arc(r, k), ...arc(r + band, k + 1), ...arc(r, k + 1));
    }
    const made = (positions: number[], material: MeshBasicMaterial, name: string, order: number) => {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
      const mesh = new Mesh(geometry, material);
      mesh.name = name;
      mesh.renderOrder = order;
      group.add(mesh);
      return mesh;
    };
    made(inner, mouth, `tunnel-mouth:${i}`, 4).raycast = () => {};
    made(ring, arched, `tunnel-portal:${i}`, 4.1).userData = { portal: true, links: portal.links, base };
  });
}

/** What a pick on an island's roads lights (3.81): one or more links' whole ways, or one shared road. */
export type RoutePick = { readonly kind: "link" | "road"; readonly links: readonly string[] };

/**
 * What a click on `mark` picks, as the mock's overlay does: a road carrying one link picks that link; a gate picks the
 * pair it joins, the links whose gate it is (ADR-1253 D3); a tunnel's portal picks the links it carries; a shared road
 * picks that road. Anything else picks nothing.
 */
export function routeOf(mark: Object3D): RoutePick | undefined {
  const { road, gate, portal, links, entrances } = mark.userData as { road?: true; gate?: true; portal?: true; links?: readonly string[]; entrances?: readonly string[] };
  if (gate === true && entrances !== undefined && entrances.length > 0) return { kind: "link", links: entrances };
  if (portal === true && links !== undefined) return { kind: "link", links };
  if (road !== true || links === undefined) return undefined;
  return { kind: links.length === 1 ? "link" : "road", links };
}

/** The road segments and gates `pick` lights in `roads`: a link's every segment and its entrance gate, or the shared road. */
export function litRoute(roads: IslandRoads, pick: RoutePick | undefined): { segments: Set<number>; gates: Set<number> } {
  const segments = new Set<number>(), gates = new Set<number>();
  if (pick === undefined) return { segments, gates };
  const keys = new Set(pick.links), same = (links: readonly string[]) => links.length === keys.size && links.every((k) => keys.has(k));
  roads.segments.forEach((s, i) => { if (pick.kind === "link" ? s.links.some((k) => keys.has(k)) : same(s.links)) segments.add(i); });
  if (pick.kind === "link") roads.gates.forEach((g, i) => { if (g.entrances.some((k) => keys.has(k))) gates.add(i); });
  return { segments, gates };
}

/** Light `pick` in gold on the road marks `islandRoadMarks` drew for `roads`, putting out what was lit before (3.81). */
export function lightRoute(marks: Object3D, roads: IslandRoads, pick: RoutePick | undefined): void {
  const lit = litRoute(roads, pick);
  marks.traverse((object) => {
    const road = /^road-lit:(\d+)$/.exec(object.name), gate = /^gate-face:(\d+):/.exec(object.name);
    if (road !== null) object.visible = lit.segments.has(Number(road[1]));
    if (gate !== null) ((object as Mesh).material as MeshBasicMaterial).color.set(lit.gates.has(Number(gate[1])) ? LIT.gold : POST.paper);
  });
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

/** The segments of the border lines `borders` left once each opening (a gate's, or open road's) is cut out of the border it stands on. */
export function cutOpenings(borders: readonly { from: Point; to: Point }[], gates: readonly { readonly at: Point; readonly opening: number }[]): { from: Point; to: Point }[] {
  return borders.flatMap(({ from: a, to: b }) => {
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l < 1e-9) return [];
    const holes = gates.flatMap((g) => {
      const t = ((g.at.x - a.x) * (b.x - a.x) + (g.at.z - a.z) * (b.z - a.z)) / (l * l);
      const off = Math.hypot(a.x + t * (b.x - a.x) - g.at.x, a.z + t * (b.z - a.z) - g.at.z);
      return off < 1e-3 && t >= 0 && t <= 1 ? [[t - g.opening / 2 / l, t + g.opening / 2 / l] as const] : [];
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
