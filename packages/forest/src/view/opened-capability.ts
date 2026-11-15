/**
 * Capability 3 · Story node render: the one capability open on the map (3.112), and its parts' marks as drawn (ADR-1339 D1,
 * arc_0c4277f81731). At the parts level the capability under the middle of the view opens; below it, or with no capability
 * there, none is. Its parts keep its health colour (question_211620bd75de): only their borders are drawn, as lines, with
 * their roads, junctions and gate posts, each kind one mesh however many parts (3.115). Where it opens, the island's roads
 * into it give way to its parts' from the border in, and its own junction to theirs; closed, every mark is as it was.
 * Plain three.js, so the marks are read without a browser.
 */
import { BoxGeometry, BufferGeometry, CircleGeometry, Color, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, type Object3D, type Vector3 } from "three";
import { inTunnelMouth, type IslandRoads, type RoadSegment } from "../territories/island-roads.js";
import type { NestedLayout, PartCrossing } from "../territories/nested-territories.js";
import { insideOf, territoryAt, type Coast, type Point, type TerritoryMap } from "../territories/territories.js";
import { cutOpenings, dense, landColour, POST, ROAD, ribbon, TERRITORY_JUNCTION, type FillAt } from "./island-roads.js";
import { segmentInConvex } from "./territory-land.js";
import type { Detail } from "./zoom-detail.js";

/** The capability open on the map, by its story. */
export type Opened = { readonly story: string; readonly capability: string } | undefined;

/** What opens at `level` with `under` beneath the middle of the view: the capability there, at the parts level only. */
export function openedAt(level: Detail, under: { kind: string; id: string; capability?: string } | undefined): Opened {
  return level === "parts" && under?.kind === "story" && under.capability !== undefined ? { story: under.id, capability: under.capability } : undefined;
}

/** A part's name where the map writes it, on the island's ground. */
export type PartPlate = { readonly part: string; readonly title: string; readonly x: number; readonly z: number };

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
/** A part's border line, a little fainter than the island's. */
const PART_BORDER = { colour: "#f4f7f8", opacity: 0.7 } as const;

/**
 * The opened capability's marks (3.112): its parts' borders, cut to its land (`cells`, its convex cells on the island) and the
 * island's `coast`, with each gate's and open road's opening cut out; its parts' roads from where the island's roads cross its
 * border, with the island's roads it hid drawn again where they still run (`kept`); a junction where each part's roads meet;
 * and a post either side of each part gate. Each point is placed on the island's ground, raised over its relief, by `onSurface`.
 */
export function openedMarks(capability: string, layout: NestedLayout, inner: IslandRoads | undefined, kept: readonly RoadSegment[], cells: readonly (readonly Point[])[], coast: Coast | undefined, onSurface: (p: Point) => Vector3, fillAt: FillAt): Group {
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

  // Its roads, the island's it hid among them, as one mesh in the island roads' sand mixed into the land under them.
  const sand = new Color(ROAD.colour), under = landColour(fillAt), mix = (p: Point) => under(p).lerp(sand, ROAD.alpha);
  const ways = [...kept.map((s) => ({ pts: s.pts, width: s.width })), ...(inner?.segments ?? []).map((s) => ({ pts: s.pts.map(placed), width: s.width }))];
  flat(merged(ways.map(({ pts, width }) => ribbon(dense(pts), width, lifted, mix))), material(), "part-roads", 3.1);

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

  // A small post either side of each part gate's opening.
  const posts = (inner?.gates ?? []).filter((gate) => !inTunnelMouth(inner!, gate)).flatMap((gate) => [-1, 1].map((sign) => {
    const side = Math.max(0.15, gate.opening * 0.12), at = placed({ x: gate.at.x + gate.along.x * (gate.opening / 2 + side / 2) * sign, z: gate.at.z + gate.along.z * (gate.opening / 2 + side / 2) * sign });
    const v = lifted(at), post = new BoxGeometry(side, side * 2.2, side).toNonIndexed().translate(v.x, v.y + side * 1.1, v.z);
    post.deleteAttribute("normal"); post.deleteAttribute("uv");
    return post;
  }));
  flat(merged(posts), material(POST.ink), "part-gates", 3.3);
  group.userData = { capability, parts: map.territories.length, routed: inner !== undefined };
  return group;
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
