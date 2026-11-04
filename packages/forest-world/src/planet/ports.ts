/**
 * Capability 4 · The planet. The selected island's ports, and its lit lanes ending just off them (ADR-1236 D1, rollout 2
 * step 5), ported from the capability tree mock's rules (docs/design/capability-tree-3d/q-all-islands/tools/sea.ts and
 * docks.ts):
 * - a port at each dock the selection's lanes come ashore at on the selected island, docks within a port's width of a
 *   busier one sharing its port, sized by the island's land against The library's (a port carrying one lane smaller);
 * - each lane, in or out, leaving its line where it first comes near the berth just off the port's coast and easing onto
 *   it straight in from the sea, so it never joins the road ashore;
 * - the port a low building where the road ends and two capped towers either side in the gate posts' slate and ink,
 *   twice as tall, each face shaded by one light; no jetty.
 */
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import type { CoastPoint } from '../coast-clip.js';
import type { ForestScene } from '../scene.js';
import { onIslandSurface } from './island-surface.js';
import { laneRoutes, type LaneRoute, type LitLink } from './lanes.js';
import type { PlanetPathways } from './pathways.js';
import { plateTransform, type PlanetSpot } from './planet.js';

type P = { x: number; z: number };

/** The port in ground units at The library's size (the mock's): the berth off the coast its lanes end on, the building,
 * the towers. A port carrying one lane is `small` of that. */
export const PORT = {
  berth: 3,
  house: { along: 2.4, half: 2.0, height: 1.6 },
  tower: { side: 1.4, height: 3.3, cap: 1.75, capDepth: 0.35, apart: 0.6 },
  small: 0.8,
} as const;
/** The library's land, at which packages/forest lays every island out (link-layout's LIBRARY_LAND): a port's size goes
 * with its island's land against it, as the island's roads and gates do. */
const LIBRARY_LAND = 24105;
/** In ground units at The library's size: docks this near a busier one share its port; a lane leaves its line for the
 * berth where it first comes this near it; a port faces the way its lanes come in, read this far out along them. */
const MERGE = 8, SNAP = 10, OUT = 10;
/** The eased way onto the berth, in pieces. */
const IN_STEPS = 10;

export interface SeaPort {
  /** Its dock on the coast, in the plate's frame, where the island's road ends. */
  dock: CoastPoint;
  /** Out to sea from the dock, and along the coast. */
  out: P; across: P;
  /** Its size against a port of The library's. */
  size: number;
  /** Just off the coast in front of it, where its lanes end. */
  berth: P;
  /** The lit links whose lanes end on its berth. */
  links: string[];
}
export interface SelectedIsland { story: string; spot: PlanetSpot; radius: number }

/** The island a selection's lanes are lit for: the one holding a lit link's own end (`from` going up, `to` going down). */
export function litIsland(scene: ForestScene, lit: readonly LitLink[]): string | undefined {
  const lane = lit[0];
  if (lane === undefined) return undefined;
  const own = lane.dir === 'up' ? lane.from : lane.to;
  return scene.islands.find(island => island.story === own || island.trees.some(tree => tree.capability === own))?.story;
}

/** The selection's lanes and the selected island's ports: with no island selected, every lane runs dock to dock. */
export function seaLanes(plan: PlanetPathways, lit: readonly LitLink[], selected: SelectedIsland | undefined): { lanes: LaneRoute[]; ports: SeaPort[] } {
  const lanes = laneRoutes(plan, lit), plate = selected && plan.plates.get(selected.story);
  if (selected === undefined || plate === undefined) return { lanes, ports: [] };
  const scale = Math.sqrt(landArea(plate.coast) / LIBRARY_LAND);
  const transform = plateTransform(selected.spot, selected.radius), at = new Vector3(...transform.position), back = transform.quaternion.clone().invert();
  const toLocal = (w: Vector3) => w.clone().sub(at).applyQuaternion(back);
  const toWorld = (l: Vector3) => l.clone().applyQuaternion(transform.quaternion).add(at);
  const docks = plan.docks.filter(dock => dock.story === selected.story);
  // Each lane coming ashore here, in the plate's frame, walked from its far end in to this island's dock.
  const ashore = lanes.flatMap((lane, i) => {
    const key = `${lane.from}->${lane.to}`, dock = docks.find(d => d.links.includes(key));
    if (dock === undefined) return [];
    const inward = lane.points.at(-1)!.distanceTo(dock.point) <= lane.points[0]!.distanceTo(dock.point);
    const walk = lane.points.map((_, k) => inward ? k : lane.points.length - 1 - k);
    return [{ i, key, dock, walk, local: lane.points.map(toLocal) }];
  });
  // The docks lanes land at, busiest first; one within a port's width of a busier one gives its lanes to that one's port.
  const landing = docks.map(dock => ({ dock, here: ashore.filter(a => a.dock === dock) })).filter(d => d.here.length > 0)
    .sort((a, b) => b.here.length - a.here.length);
  const kept: { dock: (typeof docks)[number]; here: typeof ashore; links: string[] }[] = [];
  for (const d of landing) {
    const near = kept.find(k => Math.hypot(k.dock.local.x - d.dock.local.x, k.dock.local.z - d.dock.local.z) < MERGE * scale);
    if (near) near.links.push(...d.here.map(a => a.key));
    else kept.push({ ...d, links: d.here.map(a => a.key) });
  }
  const ports = kept.map(({ dock, here, links }): SeaPort => {
    // Out to sea: toward where its own lanes are OUT units back from it.
    let ox = 0, oz = 0;
    for (const a of here) {
      let walked = 0, k = a.walk.length - 1;
      while (k > 0 && walked < OUT * scale) { walked += a.local[a.walk[k]!]!.distanceTo(a.local[a.walk[k - 1]!]!); k--; }
      const p = a.local[a.walk[k]!]!, l = Math.hypot(p.x - dock.local.x, p.z - dock.local.z) || 1;
      ox += (p.x - dock.local.x) / l; oz += (p.z - dock.local.z) / l;
    }
    const ol = Math.hypot(ox, oz), out = ol > 1e-9 ? { x: ox / ol, z: oz / ol } : unit(dock.local);
    return { dock: dock.local, out, across: { x: -out.z, z: out.x }, size: (links.length > 1 ? 1 : PORT.small) * scale,
      berth: { x: dock.local.x + out.x * PORT.berth * scale, z: dock.local.z + out.z * PORT.berth * scale }, links };
  });
  // Each lane leaves its line where it first comes near its port's berth, easing off it (tangent where it leaves) and
  // onto the berth straight in from the sea (polish round 3), as wide as the stretch it leaves.
  const ended = [...lanes];
  for (const a of ashore) {
    const port = ports.find(p => p.links.includes(a.key))!, lane = lanes[a.i]!;
    const off = (k: number) => { const p = a.local[a.walk[k]!]!; return Math.hypot(p.x - port.berth.x, p.z - port.berth.z); };
    let ci = a.walk.findIndex((_, k) => off(k) < SNAP * scale);
    if (ci < 0) ci = a.walk.reduce((best, _, k) => off(k) < off(best) ? k : best, 0);
    const r0 = a.local[a.walk[ci]!]!, rb = new Vector3(port.berth.x, r0.y, port.berth.z), width = lane.widths[a.walk[ci]!]!;
    const points = a.walk.slice(0, ci + 1).map(k => lane.points[k]!), widths = a.walk.slice(0, ci + 1).map(k => lane.widths[k]!);
    const prev = ci > 0 ? a.local[a.walk[ci - 1]!]! : undefined, tl = prev ? Math.hypot(r0.x - prev.x, r0.z - prev.z) : 0;
    const d = Math.hypot(rb.x - r0.x, rb.z - r0.z) * 0.4;
    const t = prev && tl > 1e-9 ? { x: (r0.x - prev.x) / tl, z: (r0.z - prev.z) / tl } : { x: -port.out.x, z: -port.out.z };
    const c1 = { x: r0.x + t.x * d, z: r0.z + t.z * d }, c2 = { x: rb.x + port.out.x * d, z: rb.z + port.out.z * d };
    for (let k = 1; k <= IN_STEPS; k++) {
      const u = k / IN_STEPS, w = [(1 - u) ** 3, 3 * u * (1 - u) ** 2, 3 * u * u * (1 - u), u ** 3] as const;
      points.push(toWorld(new Vector3(w[0] * r0.x + w[1] * c1.x + w[2] * c2.x + w[3] * rb.x, r0.y, w[0] * r0.z + w[1] * c1.z + w[2] * c2.z + w[3] * rb.z)));
      widths.push(width);
    }
    // Back in the lane's own order: from the dock of the island built on.
    if (a.walk[0] !== 0) { points.reverse(); widths.reverse(); }
    const length = points.slice(1).reduce((sum, p, k) => sum + p.distanceTo(points[k]!), 0);
    ended[a.i] = { ...lane, points, widths, length, width: Math.min(...widths) };
  }
  return { lanes: ended, ports };
}

const unit = (p: P): P => { const l = Math.hypot(p.x, p.z) || 1; return { x: p.x / l, z: p.z / l }; };

/** The island's land: its outer rings less its lakes. */
function landArea(coast: readonly (readonly CoastPoint[])[]): number {
  const area = (ring: readonly CoastPoint[]) => Math.abs(ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]!; return sum + p.x * q.z - q.x * p.z; }, 0)) / 2;
  return coast.reduce((sum, ring) => sum + (coast.filter(other => other !== ring && inside(ring[0]!, other)).length % 2 === 0 ? area(ring) : -area(ring)), 0);
}
function inside(p: P, ring: readonly P[]): boolean {
  let into = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) into = !into;
  }
  return into;
}

/** The port's look (the mock's): the gate posts' slate body, ink top and paper face, the building's roof, how lit a face
 * turned to the light is and one turned away, and a shadow's darkness and reach by height. */
const LOOK = { body: '#9aa2a8', ink: '#1b2024', paper: '#f3efe4', roof: '#2a3036', face: 0.62, lit: 0.84, away: 0.56, shadow: 0.35, reach: 0.8 } as const;
/** The light on the ground, from the upper left of the page at rest (the plate's -x and -z). */
const LIGHT = unit({ x: -1, z: -1 });

/** Every port of `ports` on its island, in the plate's frame, standing on the land of a globe of `radius`. */
export function portMarks(ports: readonly SeaPort[], radius: number): Group {
  const group = new Group();
  group.name = 'sea-ports';
  const surface = onIslandSurface(radius), ground = (p: P) => surface(p).y;
  const black = new Color('#000'), body = new Color(LOOK.body), ink = new Color(LOOK.ink), paper = new Color(LOOK.paper), roof = new Color(LOOK.roof);
  const shade = (base: Color, facing: P) => { const f = unit(facing), k = (f.x * LIGHT.x + f.z * LIGHT.z + 1) / 2; return base.clone().multiplyScalar(LOOK.away + (LOOK.lit - LOOK.away) * k); };
  /** A rectangle centred on c, `along` either way of u and `half` either way of n. */
  const rect = (c: P, u: P, n: P, along: number, half: number): P[] =>
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: c.x + u.x * along * i! + n.x * half * j!, z: c.z + u.z * along * i! + n.z * half * j! }));
  ports.forEach((port, i) => {
    const { out: u, across: n, size: k } = port, top = ground(port.dock);
    const part = (name: string) => {
      const pos: number[] = [], col: number[] = [];
      const tri = (pts: [number, number, number][], c: Color) => { for (const p of pts) { pos.push(...p); col.push(c.r, c.g, c.b); } };
      return {
        /** A flat face at height y. */
        flat(pts: P[], y: number, c: Color) { for (let j = 1; j + 1 < pts.length; j++) tri([pts[0]!, pts[j]!, pts[j + 1]!].map(p => [p.x, y, p.z]), c); },
        /** Upright walls round a foot, from just under the ground at each corner to y1, each face shaded by the light. */
        walls(foot: P[], y0: number | undefined, y1: number, c: Color) {
          const cx = foot.reduce((s, p) => s + p.x, 0) / foot.length, cz = foot.reduce((s, p) => s + p.z, 0) / foot.length;
          const lo = (p: P) => y0 ?? ground(p) - 0.1;
          foot.forEach((a, j) => {
            const b = foot[(j + 1) % foot.length]!, face = shade(c, { x: (a.x + b.x) / 2 - cx, z: (a.z + b.z) / 2 - cz });
            tri([[a.x, lo(a), a.z], [b.x, lo(b), b.z], [b.x, y1, b.z], [a.x, lo(a), a.z], [b.x, y1, b.z], [a.x, y1, a.z]], face);
          });
        },
        done() {
          const geometry = new BufferGeometry();
          geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
          geometry.setAttribute('color', new Float32BufferAttribute(col, 3));
          const mesh = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }));
          mesh.name = name;
          mesh.renderOrder = 6;
          mesh.raycast = () => {};
          group.add(mesh);
        },
      };
    };
    /** Its shadow on the land, cast away from the light by its height. */
    const shadow = (name: string, foot: P[], tall: number) => {
      const away = { x: -LIGHT.x * tall * LOOK.reach, z: -LIGHT.z * tall * LOOK.reach };
      const pts = [...foot, ...foot.map(p => ({ x: p.x + away.x, z: p.z + away.z }))];
      const c = pts.reduce((s, p) => ({ x: s.x + p.x / pts.length, z: s.z + p.z / pts.length }), { x: 0, z: 0 });
      pts.sort((p, q) => Math.atan2(p.z - c.z, p.x - c.x) - Math.atan2(q.z - c.z, q.x - c.x));
      const pos: number[] = [];
      pts.forEach((p, j) => { const q = pts[(j + 1) % pts.length]!; for (const v of [c, p, q]) pos.push(v.x, ground(v) + 0.05, v.z); });
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
      const mesh = new Mesh(geometry, new MeshBasicMaterial({ color: black, transparent: true, opacity: LOOK.shadow, depthWrite: false, side: DoubleSide }));
      mesh.name = name;
      mesh.renderOrder = 5;
      mesh.raycast = () => {};
      group.add(mesh);
    };
    // The building: a low block where the road ends, its long side to the land, a door on the land side.
    const ha = PORT.house.along * k / 2, hh = PORT.house.half * k, tall = PORT.house.height * k;
    const hc = { x: port.dock.x - u.x * (ha + 0.15), z: port.dock.z - u.z * (ha + 0.15) }, foot = rect(hc, u, n, ha, hh);
    shadow(`port-shadow:${i}:house`, foot, tall);
    const house = part(`port-house:${i}`);
    house.walls(foot, undefined, top + tall, body);
    house.flat(foot, top + tall, roof);
    house.flat(rect(hc, u, n, ha * LOOK.face, hh - ha * (1 - LOOK.face)), top + tall + 0.02, paper);
    house.walls(rect({ x: hc.x - u.x * (ha + 0.02), z: hc.z - u.z * (ha + 0.02) }, u, n, 0.02, 0.32 * k), undefined, top + tall * 0.55, ink.clone().lerp(black, 0.2));
    house.done();
    // The towers: the gate posts' slate and ink top, twice as tall, with a wider cap.
    const ts = PORT.tower.side * k / 2, tt = PORT.tower.height * k, cap = PORT.tower.cap * k / 2, capFrom = top + tt - PORT.tower.capDepth * k;
    for (const side of [-1, 1]) {
      const reach = (hh + PORT.tower.apart * k + ts) * side, tc = { x: hc.x + n.x * reach, z: hc.z + n.z * reach };
      const base = rect(tc, u, n, ts, ts), capped = rect(tc, u, n, cap, cap);
      shadow(`port-shadow:${i}:tower:${side}`, base, tt);
      const tower = part(`port-tower:${i}:${side}`);
      tower.walls(base, undefined, capFrom, body);
      tower.walls(capped, capFrom, top + tt, ink.clone().lerp(body, 0.25));
      tower.flat(capped, top + tt, ink);
      tower.flat(rect(tc, u, n, cap * LOOK.face, cap * LOOK.face), top + tt + 0.02, paper);
      tower.done();
    }
  });
  return group;
}
