/**
 * Capability 3 · Story node render: the one capability open on the map (3.112), and its parts' marks as drawn (ADR-1339 D1,
 * arc_0c4277f81731). At the parts level the capability under the middle of the view opens; below it, or with no capability
 * there, none is. Its parts keep its health colour (question_211620bd75de): only their borders are drawn, as lines, with
 * their roads, junctions and gate posts, each kind one mesh however many parts (3.115). Where it opens, the island's roads
 * into it give way to its parts' from the border in, and its own junction to theirs; closed, every mark is as it was. A road
 * an import reaching round a part's front door rides on is drawn in a clash tint, with its gate's posts, and named with the
 * part it reaches when that is deeper than the parts shown (3.120).
 * Plain three.js, so the marks are read without a browser.
 */
import { BoxGeometry, BufferGeometry, CircleGeometry, Color, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, type Object3D, type Vector3 } from "three";
import { inTunnelMouth, type IslandRoads, type RoadSegment } from "../territories/island-roads.js";
import type { NestedLayout, PartCrossing } from "../territories/nested-territories.js";
import { insideOf, territoryAt, type Coast, type Point, type TerritoryMap } from "../territories/territories.js";
import { cutOpenings, dense, landColour, POST, ROAD, ribbon, TERRITORY_JUNCTION, type FillAt } from "./island-roads.js";
import type { CapabilityWord } from "@storytree/forest-world/scene";
import { clipToConvex, landTriangles, PARKED_FILL, segmentInConvex, WORD_FILL } from "./territory-land.js";
import type { Detail } from "./zoom-detail.js";

/** The capability open on the map, by its story. */
export type Opened = { readonly story: string; readonly capability: string } | undefined;

/** What opens at `level` with `under` beneath the middle of the view: the capability there, or the top part it is within
 * (3.118), at the parts level only, and only in Forest (the Library's islands are outlines, with no land to open). */
export function openedAt(level: Detail, under: { kind: string; id: string; capability?: string; within?: string } | undefined, mode: "forest" | "library" = "forest"): Opened {
  const open = under?.kind === "story" ? under.within ?? under.capability : undefined;
  return opensAt(level, mode) && open !== undefined ? { story: under!.id, capability: open } : undefined;
}

/** Whether anything opens at `level` in `mode`: at the parts level, in Forest. */
export const opensAt = (level: Detail, mode: "forest" | "library" = "forest"): boolean => mode === "forest" && level === "parts";

/** How often, in seconds, the map reads what lies under the middle of the view at the parts level: at most this often while
 * the eye moves, and this often while it rests, so a capability laid out under a still eye opens too. */
export const UNDER_READS = { moving: 0.2, resting: 1 } as const;

/** Whether to read what lies under the middle of the view `now`, the eye at `eye`, having last read it as `last`. */
export function readsUnder(now: number, eye: string, last: { readonly eye: string; readonly at: number }): boolean {
  const since = now - last.at;
  return since >= UNDER_READS.moving && (eye !== last.eye || since >= UNDER_READS.resting);
}

/** The names an island shows near: its capabilities' `plates`, but for the `open` one's, whose `parts` stand in for it once named. */
export function namesShown<P extends { readonly capability: string }>(plates: readonly P[], parts: readonly PartPlate[] | undefined, open: string | undefined): { plates: P[]; parts: readonly PartPlate[] } {
  return open === undefined || parts === undefined ? { plates: [...plates], parts: [] } : { plates: plates.filter((plate) => plate.capability !== open), parts };
}

/** A part's name where the map writes it, on the island's ground; a road's (`reach`, its `from->to` as `part`) names the part
 * deeper than those shown that an import on it reaches round a front door (3.120). */
export type PartPlate = { readonly part: string; readonly title: string; readonly x: number; readonly z: number; readonly reach?: true };

/** The capability open on the map, one at a time, and its parts' names once laid out; it tells its listeners only on a change. */
export class OpenedStore {
  private opened: Opened;
  private plates: { readonly story: string; readonly capability: string; readonly plates: readonly PartPlate[] } | undefined;
  private readonly listeners = new Set<() => void>();
  /** Opens `next` (none for undefined), closing whatever was open; whether that changed anything. */
  open(next: Opened): boolean {
    if (next?.story === this.opened?.story && next?.capability === this.opened?.capability) return false;
    this.opened = next;
    this.plates = undefined;
    this.told();
    return true;
  }
  /** The open capability's parts' names, once laid out. */
  name(story: string, capability: string, plates: readonly PartPlate[]): void {
    if (this.opened?.story !== story || this.opened.capability !== capability) return;
    this.plates = { story, capability, plates };
    this.told();
  }
  readonly get = (): Opened => this.opened;
  /** The names of the open capability's parts on `story`'s island, none while it is laid out or on another island. */
  readonly platesOn = (story: string): readonly PartPlate[] | undefined => this.plates?.story === story ? this.plates.plates : undefined;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private told(): void { for (const listener of this.listeners) listener(); }
}

/** Whether road link `key` (an inside link `from->to`, a sea road's `arrive:k->to` or `from->leave:k`) has `capability` at an end. */
export const touches = (key: string, capability: string): boolean => key.startsWith(`${capability}->`) || key.endsWith(`->${capability}`);

/** The stretches of `pts` on the land of `map`'s territory `at` (`inside`), or off it. */
function stretches(pts: readonly Point[], map: TerritoryMap, at: number, inside: boolean): Point[][] {
  const here = map.territories[at];
  const out: Point[][] = [];
  let run: Point[] = [];
  for (const p of dense(pts)) {
    if ((territoryAt(map, p.x, p.z) === here) === inside) run.push(p);
    else { if (run.length > 1) out.push(run); run = []; }
  }
  if (run.length > 1) out.push(run);
  return out;
}

/** What opening `capability` hides of the island's road marks (`roads`, drawn by islandRoadMarks into `marks`): each road
 * carrying a link of its, the junctions on its land that only its roads meet at, and its own junction; with the stretches of
 * those roads still drawn, drawn again by its opened marks (off its land, or on it where the road carries another's link). */
export function hiddenByOpening(map: TerritoryMap, roads: IslandRoads, capability: string): { roads: number[]; junctions: number[]; kept: RoadSegment[] } {
  const at = map.territories.findIndex((t) => t.capability === capability);
  const hidden = roads.segments.flatMap((segment, i) => segment.links.some((key) => touches(key, capability)) ? [i] : []);
  const kept = hidden.flatMap((i) => {
    const segment = roads.segments[i]!, others = segment.links.some((key) => !touches(key, capability));
    return others ? [segment] : stretches(segment.pts, map, at, false).map((pts) => ({ ...segment, pts }));
  });
  const ending = (p: Point) => roads.segments.filter((s) => [s.pts[0]!, s.pts.at(-1)!].some((q) => Math.hypot(p.x - q.x, p.z - q.z) < 1e-6));
  const junctions = roads.junctions.flatMap(({ at: p }, i) => territoryAt(map, p.x, p.z) === map.territories[at] && ending(p).every((s) => s.links.every((key) => touches(key, capability))) ? [i] : []);
  return { roads: hidden, junctions, kept };
}

/**
 * The island's marks under `land` that opening `capability` hides, hidden; and a way to show them again. Hidden marks keep
 * their geometry, so closing it shows the island exactly as it was.
 */
export function hideForOpening(land: Object3D, map: TerritoryMap, roads: IslandRoads, capability: string): () => void {
  const { roads: hiddenRoads, junctions } = hiddenByOpening(map, roads, capability);
  const marks = [...hiddenRoads.map((i) => `road:${i}`), ...junctions.map((i) => `road-junction:${i}`), `territory-junction:${capability}`]
    .flatMap((name) => { const mark = land.getObjectByName(name); return mark === undefined || !mark.visible ? [] : [mark]; });
  for (const mark of marks) mark.visible = false;
  return () => { for (const mark of marks) mark.visible = true; };
}

/** How far above the land under them the opened capability's marks are drawn, so they lie on the island's roads. */
const LIFT = 0.02;
/** A road an import reaching round a part's front door rides on, and its gate's posts (3.120). */
export const CLASH = { colour: "#e8873a" } as const;
/** A part's border line, a little fainter than the island's. */
const PART_BORDER = { colour: "#f4f7f8", opacity: 0.7 } as const;

/**
 * The opened capability's marks (3.112): its parts' borders, cut to its land (`cells`, its convex cells on the island) and the
 * island's `coast`, with each gate's and open road's opening cut out; its parts' roads from where the island's roads cross its
 * border, with the island's roads it hid drawn again where they still run (`kept`); a junction where each part's roads meet;
 * and a post either side of each part gate. Each point is placed on the island's ground, raised over its relief, by `onSurface`.
 * Parts that are capabilities with `words` of their own (a top part's, 3.118) are filled each by its own word, as one mesh
 * that picks the capability under it (`userData.faces`, by face), and their roads are mixed into that fill. A road carrying
 * a key of `clashes` (an import reaching round a part's front door, 3.120) and the posts of its gates are drawn in its tint.
 */
export function openedMarks(capability: string, layout: NestedLayout, inner: IslandRoads | undefined, kept: readonly RoadSegment[], cells: readonly (readonly Point[])[], coast: Coast | undefined, onSurface: (p: Point) => Vector3, fillAt: FillAt, words: ReadonlyMap<string, { readonly status?: CapabilityWord; readonly parked?: true; readonly title?: string; readonly description?: string }> = new Map(), clashes: Readonly<Record<string, readonly string[]>> = {}): Group {
  const group = new Group();
  group.name = `opened-capability:${capability}`;
  const { centre, map } = layout;
  const placed = (p: Point): Point => ({ x: p.x + centre.x, z: p.z + centre.z });
  const lifted = (p: Point) => { const v = onSurface(p); v.y += LIFT; return v; };
  const flat = (geometry: BufferGeometry, material: MeshBasicMaterial, name: string, order: number) => {
    const mesh = new Mesh(geometry, material);
    mesh.name = name; mesh.renderOrder = order; mesh.raycast = () => {};
    group.add(mesh);
  };
  const material = (colour?: string) => new MeshBasicMaterial({ ...(colour === undefined ? { vertexColors: true } : { color: colour }), transparent: true, opacity: 1, side: DoubleSide, forceSinglePass: true, depthWrite: false });

  // Its parts' borders: only between two parts, cut to the capability's land.
  const between = map.borders.filter((b) => map.cells[b.between[0]]!.territory >= 0 && map.cells[b.between[1]]!.territory >= 0)
    .map((b) => ({ from: placed(b.from), to: placed(b.to) }))
    .flatMap(({ from, to }) => cells.flatMap((cell) => segmentInConvex(from, to, cell)))
    .flatMap(({ from, to }) => coast === undefined ? [{ from, to }] : insideOf(from, to, coast));
  const openings = inner === undefined ? [] : [...inner.gates, ...inner.passes].map((g) => ({ at: placed(g.at), opening: g.opening }));
  const lines = cutOpenings(between, openings);
  const borders = new BufferGeometry();
  borders.setAttribute("position", new Float32BufferAttribute(lines.flatMap(({ from, to }) => [lifted(from), lifted(to)]).flatMap((v) => [v.x, v.y, v.z]), 3));
  const drawnBorders = new LineSegments(borders, new LineBasicMaterial({ color: PART_BORDER.colour, transparent: true, opacity: PART_BORDER.opacity, depthWrite: false }));
  drawnBorders.name = "part-borders";
  drawnBorders.renderOrder = 3.2;
  drawnBorders.raycast = () => {};
  group.add(drawnBorders);

  // Its parts that are capabilities, each filled by its own word over the island's ground, cut to the capability's land.
  const partFill = (territory: number) => {
    const share = map.territories[territory], word = share?.capability === undefined ? undefined : words.get(share.capability);
    if (word === undefined) return undefined;
    const fill = word.parked === true ? PARKED_FILL : WORD_FILL[word.status ?? "untested"];
    return { colour: new Color(fill.colour), opacity: fill.opacity };
  };
  const nearest = (p: Point) => { const at = { x: p.x - centre.x, z: p.z - centre.z }; let best = -1, d = Infinity; for (const cell of map.cells) { const dd = (cell.site.x - at.x) ** 2 + (cell.site.z - at.z) ** 2; if (dd < d) { d = dd; best = cell.territory; } } return best; };
  const filled = (p: Point) => { const at = nearest(p); return at < 0 ? undefined : partFill(at); };
  if (words.size > 0) group.add(partFills(capability, map.cells.flatMap((cell) => {
    const fill = cell.territory < 0 ? undefined : partFill(cell.territory);
    return fill === undefined ? [] : [{ polygon: cell.polygon.map(placed), part: map.territories[cell.territory]!.capability!, colour: landColour(() => fill)(cell.site) }];
  }), cells, coast, lifted, Object.fromEntries([...words].map(([part, { title, description }]) => [part, { ...(title === undefined ? {} : { title }), ...(description === undefined ? {} : { description }) }]))));

  // Its roads, the island's it hid among them, as one mesh in the island roads' sand mixed into the land under them.
  const sand = new Color(ROAD.colour), under = landColour((p) => filled(p) ?? fillAt(p)), mix = (p: Point) => under(p).lerp(sand, ROAD.alpha);
  const clashing = (keys: readonly string[]) => keys.some((key) => Object.hasOwn(clashes, key)), tint = new Color(CLASH.colour);
  const ways = [...kept.map((s) => ({ pts: s.pts, width: s.width, clash: false })), ...(inner?.segments ?? []).map((s) => ({ pts: s.pts.map(placed), width: s.width, clash: clashing(s.links) }))];
  flat(merged(ways.map(({ pts, width, clash }) => ribbon(dense(pts), width, lifted, clash ? () => tint : mix))), material(), "part-roads", 3.1);

  // A junction wherever its roads meet, and where each part's roads end, a little wider than the widest there.
  const discs: { at: Point; width: number }[] = (inner?.junctions ?? []).map(({ at, width }) => ({ at: placed(at), width }));
  for (const [, { at }] of inner?.settlements ?? new Map()) {
    const ending = (inner?.segments ?? []).filter((s) => [s.pts[0]!, s.pts.at(-1)!].some((p) => Math.hypot(p.x - at.x, p.z - at.z) < 1e-6));
    if (ending.length) discs.push({ at: placed(at), width: Math.max(...ending.map((s) => s.width)) * TERRITORY_JUNCTION });
  }
  flat(merged(discs.map(({ at, width }) => {
    const disc = new CircleGeometry(width / 2, 16).rotateX(-Math.PI / 2).toNonIndexed(), corners = disc.getAttribute("position"), colour = mix(at), colours: number[] = [];
    for (let k = 0; k < corners.count; k++) {
      const v = lifted({ x: at.x + corners.getX(k), z: at.z + corners.getZ(k) });
      corners.setXYZ(k, v.x, v.y, v.z);
      colours.push(colour.r, colour.g, colour.b);
    }
    disc.setAttribute("color", new Float32BufferAttribute(colours, 3));
    return disc;
  })), material(), "part-junctions", 3.15);

  // A small post either side of each part gate's opening, tinted where a clash's road enters by it.
  const ink = new Color(POST.ink);
  const posts = (inner?.gates ?? []).filter((gate) => !inTunnelMouth(inner!, gate)).flatMap((gate) => [-1, 1].map((sign) => {
    const side = Math.max(0.15, gate.opening * 0.12), at = placed({ x: gate.at.x + gate.along.x * (gate.opening / 2 + side / 2) * sign, z: gate.at.z + gate.along.z * (gate.opening / 2 + side / 2) * sign });
    const v = lifted(at), post = new BoxGeometry(side, side * 2.2, side).toNonIndexed().translate(v.x, v.y + side * 1.1, v.z), colour = clashing(gate.entrances) ? tint : ink;
    post.deleteAttribute("normal"); post.deleteAttribute("uv");
    post.setAttribute("color", new Float32BufferAttribute(Array.from({ length: post.getAttribute("position").count }, () => [colour.r, colour.g, colour.b]).flat(), 3));
    return post;
  }));
  flat(merged(posts), material(), "part-gates", 3.3);
  const clashRoads = [...new Set((inner?.segments ?? []).flatMap((s) => s.links.filter((key) => Object.hasOwn(clashes, key))))].sort();
  group.userData = { capability, parts: map.territories.length, routed: inner !== undefined, clashRoads };
  return group;
}

/**
 * 3.120: the names of the roads an import reaching round a part's front door rides on (`clashes`, by the road's `from->to`),
 * where the part it reaches lies deeper than the parts `layout` shows: "into" that part, by its path within the part the road
 * goes to, at the road's gate into it, else midway along its longest stretch; placed on the island like the parts' names.
 */
export function reachPlates(layout: NestedLayout, inner: IslandRoads, clashes: Readonly<Record<string, readonly string[]>>): PartPlate[] {
  const shown = new Set(layout.map.territories.flatMap(({ capability }) => capability === undefined ? [] : [capability]));
  const length = (pts: readonly Point[]) => pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - pts[i]!.x, p.z - pts[i]!.z), 0);
  return Object.entries(clashes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).flatMap(([key, parts]): PartPlate[] => {
    const to = key.slice(key.indexOf("->") + 2), deeper = parts.filter((part) => !shown.has(part));
    if (deeper.length === 0) return [];
    const gate = inner.gates.find((g) => g.entrances.includes(key));
    const longest = inner.segments.filter((s) => s.links.includes(key)).sort((a, b) => length(b.pts) - length(a.pts))[0];
    const at = gate?.at ?? (longest === undefined ? undefined : midway(longest.pts, length(longest.pts) / 2));
    if (at === undefined) return [];
    const title = `into ${deeper.map((part) => (part.startsWith(`${to}/`) ? part.slice(to.length + 1) : part)).join(", ")}`;
    return [{ part: key, title, x: at.x + layout.centre.x, z: at.z + layout.centre.z, reach: true }];
  });
}

/** The point `along` the way of `pts`. */
function midway(pts: readonly Point[], along: number): Point {
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1]!, pts[i]!], l = Math.hypot(b.x - a.x, b.z - a.z);
    if (along <= l) return { x: a.x + (b.x - a.x) * (along / (l || 1)), z: a.z + (b.z - a.z) * (along / (l || 1)) };
    along -= l;
  }
  return pts.at(-1)!;
}

/**
 * One mesh filling each of `pieces` (a part's cell, placed on the island, its colour) where it lies on the opened
 * capability's land (`cells`, cut to `coast`), drawn under its borders and roads; a ray on it picks the part's capability,
 * by the face it meets (`userData.faces`), within the opened one (`userData.within`), and is named by `named`.
 */
function partFills(capability: string, pieces: readonly { polygon: readonly Point[]; part: string; colour: Color }[], cells: readonly (readonly Point[])[], coast: Coast | undefined, lifted: (p: Point) => Vector3, named: Readonly<Record<string, { title?: string; description?: string }>>): Mesh {
  const land = coast === undefined ? cells.map((cell) => [...cell]) : landTriangles(coast).flatMap((triangle) => cells.map((cell) => clipToConvex(triangle, cell))).filter((piece) => piece.length >= 3);
  const box = (loop: readonly Point[]) => ({ x0: Math.min(...loop.map((p) => p.x)), x1: Math.max(...loop.map((p) => p.x)), z0: Math.min(...loop.map((p) => p.z)), z1: Math.max(...loop.map((p) => p.z)) });
  const boxes = land.map(box);
  const positions: number[] = [], colours: number[] = [], faces: string[] = [];
  for (const { polygon, part, colour } of pieces) {
    const b = box(polygon);
    land.forEach((ground, at) => {
      const g = boxes[at]!;
      if (g.x0 > b.x1 || g.x1 < b.x0 || g.z0 > b.z1 || g.z1 < b.z0) return;
      const piece = clipToConvex(polygon, ground);
      if (piece.length < 3) return;
      const corners = piece.map(lifted);
      for (let i = 1; i < corners.length - 1; i++) {
        for (const corner of [corners[0]!, corners[i]!, corners[i + 1]!]) { positions.push(corner.x, corner.y, corner.z); colours.push(colour.r, colour.g, colour.b); }
        faces.push(part);
      }
    });
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, side: DoubleSide, forceSinglePass: true, depthWrite: false }));
  mesh.name = "part-fills";
  mesh.renderOrder = 3.05;
  mesh.userData = { faces, within: capability, named };
  return mesh;
}

/** Non-indexed geometries with the same attributes as one. */
function merged(geometries: readonly BufferGeometry[]): BufferGeometry {
  const flat = geometries.map((g) => (g.index === null ? g : g.toNonIndexed()));
  const out = new BufferGeometry();
  const names = flat.length === 0 ? ["position"] : Object.keys(flat[0]!.attributes);
  for (const name of names) {
    const size = flat[0]?.getAttribute(name).itemSize ?? 3;
    out.setAttribute(name, new Float32BufferAttribute(flat.flatMap((g) => Array.from(g.getAttribute(name).array as ArrayLike<number>)), size));
  }
  for (const g of geometries) g.dispose();
  return out;
}

/** Lets go of every geometry and material under `marks`. */
export function disposeOpened(marks: Object3D): void {
  marks.traverse((object) => {
    const mark = object as { geometry?: { dispose(): void }; material?: { dispose(): void } };
    mark.geometry?.dispose();
    mark.material?.dispose();
  });
}

/**
 * 3.114: each of the island's gate marks under `marks` on `capability`'s border carries how many of its part roads it rolls
 * up, by capability (`userData.partRoads`), from its `crossings`, read without laying the parts out.
 */
export function rollUp(marks: Object3D, capability: string, crossings: readonly PartCrossing[]): void {
  const counts = new Map(crossings.flatMap((crossing) => crossing.gate === undefined ? [] : [[crossing.gate, crossing.links.length] as const]));
  marks.traverse((mark) => {
    const { gate, index } = mark.userData as { gate?: true; index?: number };
    if (gate !== true || index === undefined || !counts.has(index)) return;
    mark.userData.partRoads = { ...(mark.userData.partRoads as Record<string, number> | undefined), [capability]: counts.get(index)! };
  });
}
