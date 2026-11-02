/**
 * The hedgerow mock's layer: what it adds on top of the real island, and nothing else. Every place comes from the
 * island's own territory map (forest's islandTerritories, cut to the plate's own coast): a hedge along each border
 * between two territories, a grassy track for each capability link, a wooden gate where a track goes through a hedge,
 * and a wrench hung on a territory's gate for the open increments that name it. Plain three.js, in the plate's own
 * frame (ground x, z; up is y), so it sits on the island exactly where the map's territories lie.
 */
import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, IcosahedronGeometry,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, Quaternion, TorusGeometry, Vector3,
} from "three";

export type Point = { x: number; z: number };
export type Border = { from: Point; to: Point; between: readonly [number, number] };
export type Cell = { site: Point; polygon: readonly Point[]; territory: number };
export type Land = { radius: number; territories: readonly { capability?: string; title?: string }[]; cells: readonly Cell[]; borders: readonly Border[] };

/** A capability link the layer draws: inside the island, or off its coast toward another story's island. */
export type Link = { id: string; from: string; to: string; toTitle: string; toStory?: { id: string; title: string; toward: Point } };
export type Want = { arc: string; arcTitle: string; increment: string; title: string; status: string };

/** The palette, soft and quiet: the hedge's greens, the track's grass and worn earth, the gate's wood, the wrench's iron. */
export const PALETTE = {
  hedge: "#8CC270", hedgeLight: "#A8D48A", hedgeDark: "#79AD62",
  track: "#D9CB9A", trackGrass: "#A9BC78",
  post: "#9C6B43", rail: "#D2A472",
  wrench: "#C9D2DA", wrenchTag: "#F2D16B",
} as const;

export type Picked =
  | { kind: "track"; links: string[] }
  | { kind: "gate"; links: string[]; between: [string | undefined, string | undefined] }
  | { kind: "wrench"; capability: string; sample: boolean };

export type Layer = { root: Group; picks: Object3D[]; labels: { text: string; at: Vector3; ground: Point }[]; gates: number; hedgeBushes: number; tracks: number };

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, z: a.z - b.z });
const len = (a: Point) => Math.hypot(a.x, a.z);
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
const key = (p: Point) => `${p.x.toFixed(4)},${p.z.toFixed(4)}`;

/** Where segments a-b and c-d cross, as the fraction along a-b, or undefined. */
function crossing(a: Point, b: Point, c: Point, d: Point): number | undefined {
  const r = sub(b, a), s = sub(d, c), denom = r.x * s.z - r.z * s.x;
  if (Math.abs(denom) < 1e-12) return undefined;
  const q = sub(c, a), t = (q.x * s.z - q.z * s.x) / denom, u = (q.x * r.z - q.z * r.x) / denom;
  return t > 1e-6 && t < 1 - 1e-6 && u >= 0 && u <= 1 ? t : undefined;
}

/** A territory's seat: the seed of its cell nearest the middle of its cells' seeds. Seeds are kept only on the land, while a
 * coastal cell's outline runs past the coast, so a seat always lies on the territory's own land. */
function seats(land: Land): Point[] {
  return land.territories.map((_, at) => {
    const sites = land.cells.filter(c => c.territory === at).map(c => c.site);
    if (sites.length === 0) return { x: NaN, z: NaN };
    const centre = { x: sites.reduce((n, p) => n + p.x, 0) / sites.length, z: sites.reduce((n, p) => n + p.z, 0) / sites.length };
    return [...sites].sort((p, q) => len(sub(p, centre)) - len(sub(q, centre)))[0]!;
  });
}

/**
 * The layer on `land`. `surface` lays a ground point on the plate, `onLand` says whether a ground point is on the island,
 * `ofCapability` finds a capability's territory index, `wants` the open increments naming each capability.
 */
export function hedgerowLayer({ land, surface, onLand, territoryAt, links, wants, sample }: {
  land: Land; surface: (p: Point, lift?: number) => Vector3; onLand: (p: Point) => boolean; territoryAt: (p: Point) => number | undefined;
  links: readonly Link[]; wants: Readonly<Record<string, readonly Want[]>>; sample?: string | undefined;
}): Layer {
  const R = land.radius;
  const bush = R * 0.017, trackWidth = R * 0.024, gateHalf = trackWidth * 1.3;
  const root = new Group(); root.name = "hedgerow-mock";
  const picks: Object3D[] = [], labels: Layer["labels"] = [];
  const at = new Map(land.territories.flatMap((t, i) => t.capability === undefined ? [] : [[t.capability, i] as const]));
  const seat = seats(land);

  // Hedges stand on the borders between two territories (the coast keeps the map's own edge). A border's ends name the two
  // cells it lies between; the hedge is between those cells' territories.
  const owner = new Map(land.cells.map((c, i) => [(c as { index?: number }).index ?? i, c.territory]));
  const borders = land.borders.filter(b => len(sub(b.to, b.from)) > 1e-9)
    .map(b => ({ ...b, between: [owner.get(b.between[0]) ?? -1, owner.get(b.between[1]) ?? -1] as const }));
  const pair = (i: number, j: number) => i < j ? `${i}|${j}` : `${j}|${i}`;
  const adjacent = new Map<number, Map<number, Border[]>>();
  for (const b of borders) {
    const [i, j] = b.between;
    if (i < 0 || j < 0) continue;
    for (const [p, q] of [[i, j], [j, i]] as const) {
      const row = adjacent.get(p) ?? new Map<number, Border[]>();
      row.set(q, [...(row.get(q) ?? []), b]);
      adjacent.set(p, row);
    }
  }

  // Gates: one per place a track passes a hedge, shared by every track that passes there.
  type Gate = { at: Point; along: Point; between: [number, number]; links: Set<string> };
  const gates = new Map<string, Gate>();
  const gateOn = (between: [number, number], point: Point, along: Point, link: string): Point => {
    const near = [...gates.values()].find(g => pair(...g.between) === pair(...between) && len(sub(g.at, point)) < gateHalf * 3);
    if (near) { near.links.add(link); return near.at; }
    const gate = { at: point, along, between, links: new Set([link]) };
    gates.set(`${key(point)}`, gate);
    return point;
  };

  /** The way from territory a to b through neighbouring territories, shortest by seat-to-seat distance. */
  const route = (a: number, b: number): number[] | undefined => {
    const dist = new Map([[a, 0]]), back = new Map<number, number>(), open = new Set([a]);
    while (open.size > 0) {
      const here = [...open].sort((p, q) => dist.get(p)! - dist.get(q)!)[0]!;
      open.delete(here);
      if (here === b) break;
      for (const next of adjacent.get(here)?.keys() ?? []) {
        const d = dist.get(here)! + len(sub(seat[here]!, seat[next]!));
        if (d < (dist.get(next) ?? Infinity)) { dist.set(next, d); back.set(next, here); open.add(next); }
      }
    }
    if (!dist.has(b)) return undefined;
    const way = [b];
    while (way[0] !== a) way.unshift(back.get(way[0]!)!);
    return way;
  };

  /** The gate between neighbours p and q: on their shared hedge, nearest the line between their seats. */
  const gateBetween = (p: number, q: number, link: string): Point => {
    const shared = adjacent.get(p)!.get(q)!;
    const mid = lerp(seat[p]!, seat[q]!, 0.5);
    const best = shared.map(b => {
      const d = sub(b.to, b.from), l = len(d);
      // Keep a gate clear of the hedge's corners where it can.
      const t = Math.min(Math.max(((mid.x - b.from.x) * d.x + (mid.z - b.from.z) * d.z) / (l * l), Math.min(0.5, gateHalf / l)), Math.max(0.5, 1 - gateHalf / l));
      const point = lerp(b.from, b.to, t);
      return { b, point, score: len(sub(point, mid)) - l * 0.15 };
    }).sort((x, y) => x.score - y.score)[0]!;
    const d = sub(best.b.to, best.b.from), l = len(d);
    return gateOn([p, q], best.point, { x: d.x / l, z: d.z / l }, link);
  };

  // Tracks: each link's way as points on the ground, kept per stretch so a stretch two links share is drawn once.
  const stretches = new Map<string, { a: Point; b: Point; links: Set<string> }>();
  const addStretch = (a: Point, b: Point, link: string) => {
    const k = [key(a), key(b)].sort().join("~");
    const s = stretches.get(k) ?? { a, b, links: new Set<string>() };
    s.links.add(link); stretches.set(k, s);
  };
  const firstGate = new Map<string, Point>();
  for (const link of links) {
    const a = at.get(link.from);
    if (a === undefined) continue;
    const ways: Point[] = [seat[a]!];
    if (!link.toStory) {
      const b = at.get(link.to);
      if (b === undefined || b === a) continue;
      const way = route(a, b);
      if (!way) continue;
      // Through each territory on the way by its seat, so the track stays on that territory's land between its gates.
      for (let i = 1; i < way.length; i++) ways.push(gateBetween(way[i - 1]!, way[i]!, link.id), seat[way[i]!]!);
    } else {
      // Off the coast: to the coast facing the other story's island, along the territories' own gates to the territory that
      // holds that stretch of coast, then a short road off it.
      const dir = link.toStory.toward, l = len(dir), u = { x: dir.x / l, z: dir.z / l };
      const centre = { x: 0, z: 0 };
      let coastAt = centre;
      for (let s = 0; s < R * 3 && onLand(coastAt); s += R * 0.005) coastAt = { x: u.x * s, z: u.z * s };
      const inside = { x: coastAt.x - u.x * R * 0.02, z: coastAt.z - u.z * R * 0.02 };
      const t = territoryAt(inside) ?? a;
      const way = route(a, t) ?? [a];
      for (let i = 1; i < way.length; i++) ways.push(gateBetween(way[i - 1]!, way[i]!, link.id), seat[way[i]!]!);
      const last = ways[ways.length - 1]!;
      const hits = borders.flatMap(b => {
        const c = crossing(last, coastAt, b.from, b.to);
        if (c === undefined || b.between[0] < 0 || b.between[1] < 0) return [];
        const d = sub(b.to, b.from), bl = len(d);
        return [{ c, b, along: { x: d.x / bl, z: d.z / bl } }];
      }).sort((p, q) => p.c - q.c);
      for (const h of hits) ways.push(gateOn([h.b.between[0], h.b.between[1]], lerp(last, coastAt, h.c), h.along, link.id));
      const out = { x: coastAt.x + u.x * R * 0.07, z: coastAt.z + u.z * R * 0.07 };
      ways.push(coastAt, out);
      const label = labels.find(x => len(sub(x.ground, out)) < R * 0.02);
      if (label) label.text += `\n${link.toTitle} · ${link.toStory.title}`;
      else labels.push({ text: `${link.toTitle} · ${link.toStory.title}`, at: surface(out, R * 0.01), ground: out });
    }
    if (ways.length > 1 && !firstGate.has(link.from) && ways.length > 2) firstGate.set(link.from, ways[1]!);
    for (let i = 1; i < ways.length; i++) addStretch(ways[i - 1]!, ways[i]!, link.id);
  }

  // The hedges, as rounded bushes along each border, leaving a gap at each gate.
  const gateList = [...gates.values()];
  const places: { p: Point; s: number; h: number }[] = [];
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const b of borders) {
    if (b.between[0] < 0 || b.between[1] < 0) continue;
    const d = sub(b.to, b.from), l = len(d), n = Math.max(1, Math.round(l / (bush * 1.15)));
    for (let i = 0; i <= n; i++) {
      const p = lerp(b.from, b.to, i / n);
      if (gateList.some(g => len(sub(g.at, p)) < gateHalf)) continue;
      places.push({ p, s: bush * (0.85 + rand() * 0.35), h: 0.75 + rand() * 0.3 });
    }
  }
  const bushGeometry = new IcosahedronGeometry(1, 1);
  const hedges = new InstancedMesh(bushGeometry, new MeshLambertMaterial({ color: "#ffffff" }), places.length);
  hedges.name = "hedgerows";
  const m = new Matrix4(), up = new Vector3(0, 1, 0), one = new Quaternion();
  const shades = [PALETTE.hedge, PALETTE.hedgeLight, PALETTE.hedgeDark].map(c => new Color(c));
  places.forEach(({ p, s, h }, i) => {
    const centre = surface(p).addScaledVector(up, s * h * 0.8);
    m.compose(centre, one, new Vector3(s, s * h, s));
    hedges.setMatrixAt(i, m);
    hedges.setColorAt(i, shades[i % 7 === 0 ? 1 : i % 5 === 0 ? 2 : 0]!.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.05));
  });
  hedges.raycast = () => {};
  root.add(hedges);

  // The tracks: worn earth with a grass strip down the middle, laid flat just above the territories.
  const ribbon = (width: number, lift: number) => {
    const positions: number[] = [];
    for (const { a, b } of stretches.values()) {
      const d = sub(b, a), l = len(d); if (l < 1e-9) continue;
      const n = { x: -d.z / l * width / 2, z: d.x / l * width / 2 };
      const steps = Math.max(1, Math.ceil(l / (R * 0.05)));
      for (let i = 0; i < steps; i++) {
        const p = lerp(a, b, i / steps), q = lerp(a, b, (i + 1) / steps);
        const c = [{ x: p.x + n.x, z: p.z + n.z }, { x: p.x - n.x, z: p.z - n.z }, { x: q.x - n.x, z: q.z - n.z }, { x: q.x + n.x, z: q.z + n.z }].map(o => surface(o, lift));
        for (const v of [c[0]!, c[1]!, c[2]!, c[0]!, c[2]!, c[3]!]) positions.push(v.x, v.y, v.z);
      }
      // A round end at each stretch's ends, so stretches meet without a notch.
      for (const o of [a, b]) for (let k = 0; k < 12; k++) {
        const t0 = k / 12 * Math.PI * 2, t1 = (k + 1) / 12 * Math.PI * 2, r = width / 2;
        for (const v of [surface(o, lift), surface({ x: o.x + Math.cos(t0) * r, z: o.z + Math.sin(t0) * r }, lift), surface({ x: o.x + Math.cos(t1) * r, z: o.z + Math.sin(t1) * r }, lift)]) positions.push(v.x, v.y, v.z);
      }
    }
    const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(positions, 3));
    return g;
  };
  const flat = (colour: string, order: number) => new MeshBasicMaterial({ color: colour, side: DoubleSide, depthWrite: false, transparent: true, opacity: 1, forceSinglePass: true, polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -order });
  const track = new Mesh(ribbon(trackWidth, R * 0.004), flat(PALETTE.track, 2)); track.name = "tracks"; track.renderOrder = 3; track.raycast = () => {};
  const grass = new Mesh(ribbon(trackWidth * 0.32, R * 0.005), flat(PALETTE.trackGrass, 3)); grass.name = "track-grass"; grass.renderOrder = 4; grass.raycast = () => {};
  root.add(track, grass);
  // One invisible pick per stretch, a little wider than the track, so a click names the links it carries.
  for (const s of stretches.values()) {
    const g = new BufferGeometry();
    const d = sub(s.b, s.a), l = len(d); if (l < 1e-9) continue;
    const n = { x: -d.z / l * trackWidth * 0.8, z: d.x / l * trackWidth * 0.8 };
    const c = [{ x: s.a.x + n.x, z: s.a.z + n.z }, { x: s.a.x - n.x, z: s.a.z - n.z }, { x: s.b.x - n.x, z: s.b.z - n.z }, { x: s.b.x + n.x, z: s.b.z + n.z }].map(o => surface(o, R * 0.006));
    g.setAttribute("position", new Float32BufferAttribute([c[0]!, c[1]!, c[2]!, c[0]!, c[2]!, c[3]!].flatMap(v => [v.x, v.y, v.z]), 3));
    const pick = new Mesh(g, new MeshBasicMaterial({ visible: false, side: DoubleSide }));
    pick.userData = { kind: "track", links: [...s.links] } satisfies Picked;
    root.add(pick); picks.push(pick);
  }

  // The gates: two posts, two rails and a brace, in the gap the hedge leaves, facing along the hedge.
  const wood = new MeshLambertMaterial({ color: PALETTE.post }), rails = new MeshLambertMaterial({ color: PALETTE.rail });
  const postGeometry = new BoxGeometry(1, 1, 1);
  const gateMesh = (gate: Gate) => {
    const g = new Group();
    const base = surface(gate.at);
    g.position.copy(base);
    g.quaternion.setFromAxisAngle(up, -Math.atan2(gate.along.z, gate.along.x));
    const post = bush * 0.5, height = bush * 2.8, span = gateHalf * 0.92;
    for (const side of [-1, 1]) {
      const p = new Mesh(postGeometry, wood); p.scale.set(post, height, post); p.position.set(side * span, height / 2, 0); g.add(p);
    }
    for (const y of [0.35, 0.78]) {
      const r = new Mesh(postGeometry, rails); r.scale.set(span * 2, post * 0.55, post * 0.5); r.position.set(0, height * y, 0); g.add(r);
    }
    const brace = new Mesh(postGeometry, rails);
    brace.scale.set(Math.hypot(span * 2, height * 0.43), post * 0.45, post * 0.45);
    brace.position.set(0, height * 0.565, 0); brace.rotation.z = Math.atan2(height * 0.43, span * 2); g.add(brace);
    const pick = new Mesh(postGeometry, new MeshBasicMaterial({ visible: false }));
    pick.scale.set(span * 2.4, height * 1.3, bush * 1.6); pick.position.set(0, height * 0.6, 0);
    const title = (i: number) => land.territories[i]?.capability;
    pick.userData = { kind: "gate", links: [...gate.links], between: [title(gate.between[0]), title(gate.between[1])] } satisfies Picked;
    g.add(pick); picks.push(pick);
    return g;
  };
  for (const gate of gateList) root.add(gateMesh(gate));

  // Wrenches: one per territory that open increments name (or the labelled sample), hung on its gate, else on a stake at its seat.
  const iron = new MeshLambertMaterial({ color: PALETTE.wrench });
  const wrenched = Object.keys(wants).filter(c => (wants[c] ?? []).length > 0 && at.has(c));
  const hung = [...wrenched.map(c => ({ c, sample: false })), ...(sample !== undefined && at.has(sample) ? [{ c: sample, sample: true }] : [])];
  for (const { c, sample: isSample } of hung) {
    const t = at.get(c)!;
    const gate = firstGate.get(c) ?? gateList.find(g => g.between.includes(t))?.at;
    const where = gate ?? seat[t]!;
    const w = new Group();
    w.position.copy(surface(where));
    const size = bush * 3.4;
    if (!gate) {
      const stake = new Mesh(postGeometry, wood); stake.scale.set(bush * 0.28, size * 1.5, bush * 0.28); stake.position.y = size * 0.75; w.add(stake);
    }
    const spanner = new Group();
    const handle = new Mesh(postGeometry, iron); handle.scale.set(size * 0.22, size * 1.2, size * 0.12); spanner.add(handle);
    const jaw = new Mesh(new TorusGeometry(size * 0.3, size * 0.1, 8, 16, Math.PI * 1.45), iron);
    jaw.position.y = size * 0.78; jaw.rotation.z = -Math.PI * 0.225 + Math.PI / 2; spanner.add(jaw);
    const ring = new Mesh(new TorusGeometry(size * 0.2, size * 0.08, 8, 16), iron); ring.position.y = -size * 0.72; spanner.add(ring);
    const tag = new Mesh(new CylinderGeometry(size * 0.18, size * 0.18, size * 0.05, 12), new MeshLambertMaterial({ color: PALETTE.wrenchTag }));
    tag.rotation.x = Math.PI / 2; tag.position.set(size * 0.25, -size * 0.35, 0); spanner.add(tag);
    spanner.position.set(0, size * 1.55, 0);
    spanner.rotation.z = 0.35;
    w.add(spanner);
    const pick = new Mesh(postGeometry, new MeshBasicMaterial({ visible: false }));
    pick.scale.set(size * 1.4, size * 2.6, size); pick.position.copy(spanner.position);
    pick.userData = { kind: "wrench", capability: c, sample: isSample } satisfies Picked;
    w.add(pick); picks.push(pick);
    root.add(w);
    if (isSample) labels.push({ text: "sample wrench", at: surface(where, size * 3.2), ground: where });
  }
  return { root, picks, labels, gates: gateList.length, hedgeBushes: places.length, tracks: stretches.size };
}
