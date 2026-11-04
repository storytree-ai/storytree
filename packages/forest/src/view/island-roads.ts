/**
 * Capability 3 · Story node render: the selected island's roads and gates as drawn (ADR-1236 D1, rollout 2 step 3),
 * round 11's `sand-faint` look: each road a sandy ribbon on the land, a step wider by the links it carries, its colour
 * mixed into the land under it so the joins stay one road; a disc at each junction; and at each gate a flat ink post
 * with a paper face either side of its opening (the mock's flat posts). No arrowheads. Plain three.js, so the marks
 * are read without a browser.
 */
import { BufferGeometry, CircleGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, type Vector3 } from "three";
import type { IslandRoads } from "../territories/island-roads.js";

type Point = { readonly x: number; readonly z: number };

/** The road's sand, mixed into the land under it at this share. */
export const ROAD = { colour: "#e2d3aa", alpha: 0.7 } as const;
/** The borders on the selected island, quietened under the roads. */
export const QUIET_BORDER = { colour: "#f4f7f8", opacity: 0.4 } as const;
/** A gate post's ink and its paper face (round 6C's). */
const POST = { ink: "#1b2024", paper: "#f3efe4" } as const;
/** The island's bare ground as it shows on the page under the see-through fills (the mock's round 11 still). */
const GROUND = "#686d70";

/** The fill a point of the land shows: a territory's colour at its opacity, or none on open land. */
export type FillAt = (p: Point) => { colour: Color; opacity: number } | undefined;

/** The roads, junctions and gate posts of `roads`, each point placed on the island by `onSurface`. */
export function islandRoadMarks(roads: IslandRoads, onSurface: (p: Point) => Vector3, fillAt: FillAt): Group {
  const group = new Group();
  group.name = "island-roads";
  const ground = new Color(GROUND), sand = new Color(ROAD.colour);
  const under = (p: Point) => { const f = fillAt(p); return f === undefined ? ground.clone() : ground.clone().lerp(f.colour, f.opacity); };
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
  const material = (colour?: string | Color) => new MeshBasicMaterial({ ...(colour === undefined ? { vertexColors: true } : { color: colour }), transparent: true, opacity: 1, side: DoubleSide, forceSinglePass: true, depthWrite: false });
  roads.segments.forEach((segment, i) => {
    const mesh = flat(ribbon(dense(segment.pts), segment.width, onSurface, mix), material(), `road:${i}`, 3);
    mesh.userData = { road: true, links: segment.links, width: segment.width };
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
  const ink = material(POST.ink), paper = material(POST.paper);
  roads.gates.forEach((gate, i) => {
    for (const side of [-1, 1]) {
      const c = { x: gate.at.x + gate.along.x * (gate.opening / 2 + gate.post / 2) * side, z: gate.at.z + gate.along.z * (gate.opening / 2 + gate.post / 2) * side };
      const square = (size: number) => ribbon([{ x: c.x - gate.along.x * size / 2, z: c.z - gate.along.z * size / 2 }, { x: c.x + gate.along.x * size / 2, z: c.z + gate.along.z * size / 2 }], size, onSurface);
      flat(square(gate.post), ink, `gate-post:${i}:${side}`, 4).userData = { gate: true, entrance: gate.entrance, links: gate.links };
      flat(square(gate.face), paper, `gate-face:${i}:${side}`, 5);
    }
  });
  return group;
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

/** The segments of the border lines `borders` left once each gate's opening is cut out of the border it stands on. */
export function cutOpenings(borders: readonly { from: Point; to: Point }[], gates: IslandRoads["gates"]): { from: Point; to: Point }[] {
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
