// The mock's only drawing: timber fences on the borders between the real island's territories, a five-bar farm gate
// where a pathway crosses one, pale dirt tracks for the links between capabilities, sand roads off the coast for the
// links to other stories, and a wrench per territory that open work names. Everything is placed from the real scene the
// desktop renderer drew (its territory meshes and its territory-borders line segments), never from a redrawing.
// `?real` leaves the island exactly as the map draws it today, file dots and all, for the side-by-side still.
import {
  AmbientLight, BoxGeometry, BufferGeometry, Color, DirectionalLight, ExtrudeGeometry, Float32BufferAttribute, Group, HemisphereLight,
  DoubleSide, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial, MeshStandardMaterial, Object3D, Quaternion, Raycaster, Shape, Vector2, Vector3,
  type LineSegments, type PerspectiveCamera, type Scene, type WebGLRenderer,
} from "three";
import data from "../data.json";

type P = { x: number; z: number };
type Globe = { scene: Scene; camera: PerspectiveCamera; gl: WebGLRenderer; invalidate: () => void };
type Contract = { id: string; title: string };

const REAL = new URLSearchParams(location.search).has("real");
const STORY = data.story.id;
/** The palette: weathered oak, its shadowed side, the dirt tracks, the sand roads and the wrench's steel. */
export const PALETTE = { post: "#6b4a2f", rail: "#9a6b43", gateBar: "#c79a63", track: "#bfa577", road: "#d4bc8c", steel: "#b9c2c9", steelDark: "#7d8790", light: "#ffd9a8", sky: "#ffe7c4", shade: "#5a4a3c" };
const FENCE = { height: 2.4, postEvery: 3.2, post: 0.42, rail: 0.22, gateWidth: 6.5 };
const TRACK_WIDTH = 2.0;
const LIFT = 0.06;

const caps = new Map(data.capabilities.map((c) => [c.id, c]));
const titleOf = (id: string) => caps.get(id)?.title ?? id;

const globe = () => (window as unknown as { __globe?: Globe }).__globe;

/** The real territories as triangles in the island's own frame (x, z across; y up), read from their meshes. */
function readLand(land: Object3D) {
  const territories = new Map<string, { tris: [Vector3, Vector3, Vector3][]; mesh: Mesh }>();
  for (const child of land.children) {
    if (!child.name.startsWith("territory:capability_")) continue;
    const mesh = child as Mesh;
    const pos = mesh.geometry.getAttribute("position");
    const index = mesh.geometry.getIndex();
    const at = (i: number) => new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    const tris: [Vector3, Vector3, Vector3][] = [];
    const count = index ? index.count : pos.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const [a, b, c] = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2];
      tris.push([at(a), at(b), at(c)]);
    }
    territories.set(child.name.slice("territory:".length), { tris, mesh });
  }
  const borders = land.getObjectByName("territory-borders") as LineSegments;
  const bp = borders.geometry.getAttribute("position");
  const segments: [Vector3, Vector3][] = [];
  for (let i = 0; i + 1 < bp.count; i += 2) segments.push([new Vector3(bp.getX(i), bp.getY(i), bp.getZ(i)), new Vector3(bp.getX(i + 1), bp.getY(i + 1), bp.getZ(i + 1))]);
  // The coastline, as the real coast mesh's own points.
  const coastMesh = land.parent?.parent?.getObjectByName("island-coast:0") as Mesh | undefined;
  const cp = coastMesh?.geometry.getAttribute("position");
  const coast: Vector3[] = [];
  if (cp) for (let i = 0; i < cp.count; i += 2) coast.push(new Vector3(cp.getX(i), cp.getY(i), cp.getZ(i)));
  return { territories, segments, coast };
}

function inTri(p: P, [a, b, c]: [Vector3, Vector3, Vector3]): number | undefined {
  const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
  if (Math.abs(d) < 1e-9) return undefined;
  const l1 = ((b.z - c.z) * (p.x - c.x) + (c.x - b.x) * (p.z - c.z)) / d;
  const l2 = ((c.z - a.z) * (p.x - c.x) + (a.x - c.x) * (p.z - c.z)) / d;
  const l3 = 1 - l1 - l2;
  return l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6 ? l1 * a.y + l2 * b.y + l3 * c.y : undefined;
}

function build(land: Object3D): Group {
  const { territories, segments, coast } = readLand(land);
  const ids = [...territories.keys()];
  const owner = (p: P): string | undefined => { for (const [id, t] of territories) for (const tri of t.tris) if (inTri(p, tri) !== undefined) return id; return undefined; };
  const heightAt = (p: P): number => { for (const t of territories.values()) for (const tri of t.tris) { const y = inTri(p, tri); if (y !== undefined) return y; } return 0.08; };

  // Which two territories each border segment parts: a step to either side of its middle.
  type Border = { a: Vector3; b: Vector3; pair: string; mid: Vector3; length: number };
  const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  const borders: Border[] = [];
  for (const [a, b] of segments) {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const along = new Vector2(b.x - a.x, b.z - a.z);
    const length = along.length();
    if (length < 1e-6) continue;
    along.normalize();
    const side = (s: number) => owner({ x: mid.x - along.y * s, z: mid.z + along.x * s });
    const left = side(0.6), right = side(-0.6);
    if (left === undefined || right === undefined || left === right) continue;
    borders.push({ a, b, mid, length, pair: pairKey(left, right) });
  }
  const neighbours = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const { pair } of borders) { const [x, y] = pair.split("|"); neighbours.get(x!)!.add(y!); neighbours.get(y!)!.add(x!); }

  // Each territory's seat: of its triangles' middles, the one farthest from its own borders and the coast.
  const seat = new Map<string, Vector3>();
  for (const [id, t] of territories) {
    const own = borders.filter(({ pair }) => pair.split("|").includes(id));
    let best: Vector3 | undefined, bestScore = -1;
    for (const tri of t.tris) {
      const c = tri[0].clone().add(tri[1]).add(tri[2]).divideScalar(3);
      let score = Infinity;
      for (const { a, b } of own) score = Math.min(score, distanceToSegment(c, a, b));
      for (const q of coast) score = Math.min(score, Math.hypot(q.x - c.x, q.z - c.z));
      if (score > bestScore) { bestScore = score; best = c; }
    }
    seat.set(id, best!);
  }

  // Inside one territory a track keeps to its own land: a walk over its triangles, then pulled straight wherever the
  // straight way stays inside, so a track crosses a fence only at a gate.
  const key = (v: Vector3) => `${v.x.toFixed(2)},${v.z.toFixed(2)}`;
  const walks = new Map<string, { mids: Vector3[]; next: number[][]; tris: [Vector3, Vector3, Vector3][] }>();
  for (const [id, t] of territories) {
    const mids = t.tris.map((tri) => tri[0].clone().add(tri[1]).add(tri[2]).divideScalar(3));
    const byVertex = new Map<string, number[]>();
    t.tris.forEach((tri, i) => { for (const v of tri) byVertex.set(key(v), [...(byVertex.get(key(v)) ?? []), i]); });
    const next = t.tris.map((tri, i) => [...new Set(tri.flatMap((v) => byVertex.get(key(v))!))].filter((j) => j !== i));
    walks.set(id, { mids, next, tris: t.tris });
  }
  const insideOf = (id: string, p: P) => walks.get(id)!.tris.some((tri) => inTri(p, tri) !== undefined);
  const clear = (id: string, a: Vector3, b: Vector3) => {
    const n = Math.max(2, Math.ceil(a.distanceTo(b) / 0.8));
    for (let i = 1; i < n; i++) {
      const p = a.clone().lerp(b, i / n);
      // Near an end that stands on a border (a gate, the coast), the way may graze it.
      if (Math.min(p.distanceTo(a), p.distanceTo(b)) < 1.6) continue;
      if (!insideOf(id, p)) return false;
    }
    return true;
  };
  const innerPath = (id: string, from: Vector3, to: Vector3): Vector3[] => {
    if (clear(id, from, to)) return [from, to];
    const { mids, next } = walks.get(id)!;
    const nearest = (p: Vector3) => mids.reduce((m, c, i) => (c.distanceTo(p) < mids[m]!.distanceTo(p) ? i : m), 0);
    const start = nearest(from), goal = nearest(to);
    const dist = new Map<number, number>([[start, 0]]), back = new Map<number, number>();
    const open = new Set([start]);
    while (open.size > 0) {
      const at = [...open].reduce((m, i) => (dist.get(i)! < dist.get(m)! ? i : m));
      open.delete(at);
      if (at === goal) break;
      for (const j of next[at]!) {
        const d = dist.get(at)! + mids[at]!.distanceTo(mids[j]!);
        if (d < (dist.get(j) ?? Infinity)) { dist.set(j, d); back.set(j, at); open.add(j); }
      }
    }
    const chain = [goal];
    while (chain[0] !== start && back.has(chain[0]!)) chain.unshift(back.get(chain[0]!)!);
    const raw = [from, ...chain.map((i) => mids[i]!), to];
    const pulled = [raw[0]!];
    let i = 0;
    while (i < raw.length - 1) {
      let j = raw.length - 1;
      while (j > i + 1 && !clear(id, raw[i]!, raw[j]!)) j--;
      pulled.push(raw[j]!);
      i = j;
    }
    return pulled;
  };
  const crosses = (p: Vector3, q: Vector3, a: Vector3, b: Vector3) => {
    const d = (u: Vector3, v: Vector3, w: Vector3) => (v.x - u.x) * (w.z - u.z) - (v.z - u.z) * (w.x - u.x);
    return d(p, q, a) * d(p, q, b) < 0 && d(a, b, p) * d(a, b, q) < 0;
  };
  const ungatedIn = (line: Vector3[]) => line.some((p, i) => i + 1 < line.length && borders.some((b) => crosses(p, line[i + 1]!, b.a, b.b)
    && ![...gates.values()].some((g) => g.at.distanceTo(p) < FENCE.gateWidth || g.at.distanceTo(line[i + 1]!) < FENCE.gateWidth)));
  // Rounded at the turns, unless rounding a tight turn would cut across a fence: then it keeps its corners.
  const lineThrough = (points: Vector3[]) => { const round = smooth(points); return ungatedIn(round) ? smooth(points, 0) : round; };
  const joined = (legs: Vector3[][]) => legs.reduce<Vector3[]>((all, leg) => [...all, ...(all.length > 0 ? leg.slice(1) : leg)], []);

  // A pathway per link: the fewest borders crossed, a gate on each, at the shared border nearest the straight way.
  const gates = new Map<string, { at: Vector3; dir: Vector2; links: { from: string; to: string }[]; roads: string[]; pair: string }>();
  const gateFor = (x: string, y: string) => {
    const key = pairKey(x, y);
    let gate = gates.get(key);
    if (gate === undefined) {
      const sx = seat.get(x)!, sy = seat.get(y)!;
      const middle = sx.clone().add(sy).multiplyScalar(0.5);
      const shared = borders.filter(({ pair }) => pair === key);
      const best = shared.reduce((m, s) => (s.mid.distanceTo(middle) - Math.min(s.length, FENCE.gateWidth) * 0.8 < m.mid.distanceTo(middle) - Math.min(m.length, FENCE.gateWidth) * 0.8 ? s : m));
      gate = { at: best.mid.clone(), dir: new Vector2(best.b.x - best.a.x, best.b.z - best.a.z).normalize(), links: [], roads: [], pair: key };
      gates.set(key, gate);
    }
    return gate;
  };
  const route = (from: string, to: string): string[] | undefined => {
    const back = new Map<string, string>([[from, from]]);
    const queue = [from];
    while (queue.length > 0) {
      const at = queue.shift()!;
      if (at === to) break;
      const next = [...neighbours.get(at)!].sort((p, q) => seat.get(p)!.distanceTo(seat.get(to)!) - seat.get(q)!.distanceTo(seat.get(to)!));
      for (const n of next) if (!back.has(n)) { back.set(n, at); queue.push(n); }
    }
    if (!back.has(to)) return undefined;
    const path = [to];
    while (path[0] !== from) path.unshift(back.get(path[0]!)!);
    return path;
  };

  const group = new Group();
  group.name = "timber-mock";
  const woodPost = new MeshLambertMaterial({ color: PALETTE.post });
  const woodRail = new MeshLambertMaterial({ color: PALETTE.rail });
  const woodGate = new MeshLambertMaterial({ color: PALETTE.gateBar });
  const trackMat = new MeshLambertMaterial({ color: PALETTE.track, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const roadMat = new MeshLambertMaterial({ color: PALETTE.road, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

  const tracks: { links: { from: string; to: string }[]; points: Vector3[]; route: string[] }[] = [];
  for (const link of data.links) {
    const way = route(link.from, link.to);
    if (way === undefined) continue;
    const legs: Vector3[][] = [];
    let at = seat.get(link.from)!;
    for (let i = 0; i + 1 < way.length; i++) {
      const gate = gateFor(way[i]!, way[i + 1]!);
      gate.links.push(link);
      legs.push(innerPath(way[i]!, at, gate.at));
      at = gate.at;
    }
    legs.push(innerPath(link.to, at, seat.get(link.to)!));
    tracks.push({ links: [link], points: joined(legs), route: way });
  }

  // Tracks: a pale ribbon through each link's points, rounded at the turns.
  for (const track of tracks) {
    const line = lineThrough(track.points);
    const mesh = new Mesh(ribbon(line, TRACK_WIDTH, heightAt), trackMat);
    mesh.name = `track:${track.links[0]!.from}->${track.links[0]!.to}`;
    mesh.userData = { kind: "track", links: track.links, route: track.route, points: line };
    group.add(mesh);
  }
  // A worn patch at each seat, where its tracks meet.
  for (const id of new Set(tracks.flatMap((t) => [t.links[0]!.from, t.links[0]!.to]))) {
    const s = seat.get(id)!;
    const patch = new Mesh(disc(2.2), trackMat);
    patch.position.set(s.x, heightAt(s) + LIFT, s.z);
    group.add(patch);
  }

  // Roads off the coast: the one link out, and a road per story whose capabilities call into this island.
  const middle = [...seat.values()].reduce((m, v) => m.add(v), new Vector3()).divideScalar(seat.size);
  const roads: { from: string; label: string; detail: unknown; spread: number }[] = [];
  for (const out of data.roadsOut) roads.push({ from: out.from, label: `${out.story} · ${out.title}`, detail: { kind: "road-out", ...out }, spread: 0 });
  const byStory = new Map<string, typeof data.roadsIn>();
  for (const r of data.roadsIn) byStory.set(r.story, [...(byStory.get(r.story) ?? []), r]);
  const used = new Map<string, number>();
  for (const [story, calls] of byStory) {
    const counts = new Map<string, number>();
    for (const c of calls) counts.set(c.to, (counts.get(c.to) ?? 0) + 1);
    const to = [...counts].sort((p, q) => q[1] - p[1])[0]![0];
    const n = used.get(to) ?? 0; used.set(to, n + 1);
    roads.push({ from: to, label: `${story} · ${calls.length} call${calls.length === 1 ? "" : "s"}`, detail: { kind: "road-in", story, calls }, spread: n });
  }
  const labels: { at: Vector3; text: string; detail: unknown }[] = [];
  // Where each territory meets the sea: the real coast's points, each owned by the land just inside it.
  const shore = new Map<string, Vector3[]>();
  for (const q of coast) {
    const inward = new Vector2(middle.x - q.x, middle.z - q.z).normalize();
    const id = owner({ x: q.x + inward.x * 1.5, z: q.z + inward.y * 1.5 });
    if (id !== undefined) shore.set(id, [...(shore.get(id) ?? []), q]);
  }
  const landed: Vector3[] = [];
  for (const road of roads) {
    // To the sea from the road's territory, through its neighbours' gates when it has no shore of its own.
    let way = [road.from];
    if (!shore.has(road.from)) {
      const routes = [...shore.keys()].map((c) => route(road.from, c)).filter((r): r is string[] => r !== undefined);
      way = routes.sort((p, q) => p.length - q.length)[0] ?? way;
    }
    const last = way[way.length - 1]!;
    const s0 = seat.get(last)!;
    const radial = new Vector2(s0.x - middle.x, s0.z - middle.z).normalize();
    const spots = (shore.get(last) ?? []).filter((q) => landed.every((l) => l.distanceTo(q) > 14));
    const coastAt = spots.reduce<Vector3 | undefined>((m, q) => {
      const score = (v: Vector3) => new Vector2(v.x - s0.x, v.z - s0.z).normalize().dot(radial) - v.distanceTo(s0) / 400;
      return m === undefined || score(q) > score(m) ? q : m;
    }, undefined) ?? s0;
    landed.push(coastAt);
    const out = new Vector2(coastAt.x - middle.x, coastAt.z - middle.z).normalize();
    const inner = new Vector3(coastAt.x - out.x * 2.5, 0, coastAt.z - out.y * 2.5);
    inner.y = heightAt(inner);
    const legs: Vector3[][] = [];
    let at = seat.get(road.from)!;
    for (let i = 0; i + 1 < way.length; i++) {
      const gate = gateFor(way[i]!, way[i + 1]!);
      gate.roads.push(road.label);
      legs.push(innerPath(way[i]!, at, gate.at));
      at = gate.at;
    }
    legs.push(innerPath(last, at, inner));
    const sea = new Vector3(coastAt.x + out.x * 14, coastAt.y, coastAt.z + out.y * 14);
    const points = [...joined(legs), coastAt.clone(), sea];
    const line = lineThrough(points);
    const mesh = new Mesh(ribbon(line, TRACK_WIDTH * 1.2, (p) => (owner(p) === undefined ? coastAt.y : heightAt(p))), roadMat);
    mesh.name = `road:${road.label}`;
    mesh.userData = { ...(road.detail as object), road: true, points: line };
    group.add(mesh);
    labels.push({ at: sea, text: road.label, detail: road.detail });
  }
  group.userData.labels = labels;

  // Fences: posts and two rails along every border, with a gap where a gate stands.
  const posts: Matrix4[] = [], rails: Matrix4[] = [];
  const gateList = [...gates.values()];
  for (const border of borders) {
    const gap = gateList.filter((g) => g.pair === border.pair && distanceToSegment(g.at, border.a, border.b) < 0.01);
    const cuts: [number, number][] = gap.map((g) => { const t = projectT(g.at, border.a, border.b) * border.length; return [t - FENCE.gateWidth / 2, t + FENCE.gateWidth / 2]; });
    const pieces = subtract([0, border.length], cuts);
    for (const [t0, t1] of pieces) {
      if (t1 - t0 < 0.3) continue;
      const n = Math.max(1, Math.round((t1 - t0) / FENCE.postEvery));
      const at = (t: number) => border.a.clone().lerp(border.b, t / border.length);
      for (let i = 0; i <= n; i++) posts.push(box(at(t0 + ((t1 - t0) * i) / n), FENCE.post, FENCE.height, FENCE.post, border, heightAt));
      const a = at(t0), b = at(t1);
      for (const h of [0.95, 1.85]) rails.push(beam(a, b, h, FENCE.rail, heightAt));
    }
  }
  group.add(instanced(new BoxGeometry(1, 1, 1), woodPost, posts, "fence-posts"));
  group.add(instanced(new BoxGeometry(1, 1, 1), woodRail, rails, "fence-rails"));

  // Gates: two stout posts and a five-bar gate with its brace, pickable as one.
  for (const gate of gateList) {
    const g = new Group();
    g.name = `gate:${gate.pair}`;
    g.userData = { kind: "gate", pair: gate.pair, links: gate.links, roads: gate.roads };
    const y = heightAt(gate.at);
    g.position.set(gate.at.x, y, gate.at.z);
    g.rotation.y = -Math.atan2(gate.dir.y, gate.dir.x);
    const w = FENCE.gateWidth, h = FENCE.height + 0.2;
    for (const s of [-1, 1]) { const p = new Mesh(new BoxGeometry(0.7, h + 0.6, 0.7), woodPost); p.position.set((s * w) / 2, (h + 0.6) / 2, 0); g.add(p); }
    const leaf = new Group();
    leaf.position.x = -w / 2 + 0.35;
    // Swung a little open, as a farm gate left on its latch.
    leaf.rotation.y = -0.35;
    for (let i = 0; i < 5; i++) { const bar = new Mesh(new BoxGeometry(w - 0.8, 0.22, 0.22), woodGate); bar.position.set((w - 0.8) / 2, 0.45 + (i * (h - 0.7)) / 4, 0); leaf.add(bar); }
    for (const x of [0.1, w - 0.9]) { const stile = new Mesh(new BoxGeometry(0.3, h - 0.4, 0.26), woodGate); stile.position.set(x, (h - 0.4) / 2 + 0.25, 0); leaf.add(stile); }
    const brace = new Mesh(new BoxGeometry(Math.hypot(w - 1, h - 0.8), 0.2, 0.2), woodGate);
    brace.position.set((w - 0.8) / 2, h / 2, 0.05);
    brace.rotation.z = Math.atan2(h - 0.8, w - 1);
    leaf.add(brace);
    g.add(leaf);
    // An invisible block makes the whole gate easy to click.
    const hit = new Mesh(new BoxGeometry(w + 1.5, h + 1.5, 3), new MeshLambertMaterial({ visible: false }));
    hit.position.y = h / 2;
    g.add(hit);
    group.add(g);
  }

  // Wrenches: one per territory that open work names, on that territory's busiest gate.
  const wanted = new Map<string, typeof data.openWork>();
  for (const w of data.openWork) for (const c of w.capabilities) wanted.set(c, [...(wanted.get(c) ?? []), w]);
  for (const [id, work] of wanted) {
    const own = gateList.filter((g) => g.pair.split("|").includes(id)).sort((p, q) => q.links.length - p.links.length)[0];
    const at = own?.at ?? seat.get(id)!;
    const wrench = spanner();
    wrench.name = `wrench:${id}`;
    wrench.userData = { kind: "wrench", capability: id, work };
    wrench.position.set(at.x, heightAt(at) + FENCE.height + 1.5, at.z);
    wrench.scale.setScalar(2.2);
    group.add(wrench);
  }

  // Warm late-afternoon light, low from the west, for the timber and the steel; the land's own fills are unlit, as drawn.
  const sun = new DirectionalLight(PALETTE.light, 1.5);
  sun.position.set(-120, 60, 40);
  group.add(sun, sun.target, new HemisphereLight(PALETTE.sky, PALETTE.shade, 0.8), new AmbientLight("#fff1dc", 0.25));
  // Checked, not assumed: how often a drawn track or road crosses a fence away from a gate.
  let ungated = 0;
  for (const mesh of group.children.filter((c) => c.userData.kind === "track" || c.userData.road)) {
    const line = (mesh.userData.points as Vector3[]);
    for (let i = 0; i + 1 < line.length; i++) for (const border of borders) {
      if (!crosses(line[i]!, line[i + 1]!, border.a, border.b)) continue;
      if (gateList.some((g) => g.at.distanceTo(line[i]!) < FENCE.gateWidth || g.at.distanceTo(line[i + 1]!) < FENCE.gateWidth)) continue;
      ungated++; (group.userData.ungated ??= []).push(mesh.name);
    }
  }
  group.userData.summary = { ungatedCrossings: ungated, ungatedOn: group.userData.ungated ?? [],  fences: borders.length, posts: posts.length, gates: gates.size, tracks: tracks.length, roads: roads.length, wrenches: wanted.size,
    links: data.links.length, unrouted: data.links.length - tracks.length, adjacentLinks: tracks.filter((t) => t.route.length === 2).length };
  return group;
}

// ---- small geometry helpers ----
function distanceToSegment(p: Vector3, a: Vector3, b: Vector3): number {
  const t = projectT(p, a, b);
  const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
  return Math.hypot(p.x - x, p.z - z);
}
function projectT(p: Vector3, a: Vector3, b: Vector3): number {
  const dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz;
  return l === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l));
}
function subtract([s, e]: [number, number], cuts: [number, number][]): [number, number][] {
  let parts: [number, number][] = [[s, e]];
  for (const [c0, c1] of cuts) parts = parts.flatMap(([p0, p1]) => (c1 <= p0 || c0 >= p1 ? [[p0, p1]] : [...(c0 > p0 ? [[p0, c0]] : []), ...(c1 < p1 ? [[c1, p1]] : [])]) as [number, number][]);
  return parts;
}
function box(at: Vector3, w: number, h: number, d: number, border: { a: Vector3; b: Vector3 }, heightAt: (p: P) => number): Matrix4 {
  const angle = -Math.atan2(border.b.z - border.a.z, border.b.x - border.a.x);
  return new Matrix4().compose(new Vector3(at.x, heightAt(at) + h / 2, at.z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle), new Vector3(w, h, d));
}
function beam(a: Vector3, b: Vector3, h: number, t: number, heightAt: (p: P) => number): Matrix4 {
  const ya = heightAt(a) + h, yb = heightAt(b) + h;
  const from = new Vector3(a.x, ya, a.z), to = new Vector3(b.x, yb, b.z);
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const dir = to.clone().sub(from);
  const q = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), dir.clone().normalize());
  return new Matrix4().compose(mid, q, new Vector3(dir.length(), t, t * 0.7));
}
function instanced(geometry: BufferGeometry, material: MeshLambertMaterial, matrices: Matrix4[], name: string): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.name = name;
  mesh.userData = { kind: "fence" };
  mesh.computeBoundingSphere();
  return mesh;
}
function smooth(points: Vector3[], rounds = 2): Vector3[] {
  // Chaikin's corner cutting, twice: the tracks bend at their seats and gates instead of kinking.
  let p = points;
  for (let k = 0; k < rounds; k++) {
    const next = [p[0]!];
    for (let i = 0; i + 1 < p.length; i++) { next.push(p[i]!.clone().lerp(p[i + 1]!, 0.25), p[i]!.clone().lerp(p[i + 1]!, 0.75)); }
    next.push(p[p.length - 1]!);
    p = next;
  }
  // Densified, so the ribbon follows the land's relief.
  const dense: Vector3[] = [];
  for (let i = 0; i + 1 < p.length; i++) { const n = Math.max(1, Math.ceil(p[i]!.distanceTo(p[i + 1]!) / 1.5)); for (let j = 0; j < n; j++) dense.push(p[i]!.clone().lerp(p[i + 1]!, j / n)); }
  dense.push(p[p.length - 1]!);
  return dense;
}
function ribbon(points: Vector3[], width: number, heightAt: (p: P) => number): BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)]!, b = points[Math.min(points.length - 1, i + 1)]!;
    const d = new Vector2(b.x - a.x, b.z - a.z).normalize();
    const y = heightAt(p) + LIFT;
    pos.push(p.x - d.y * width / 2, y, p.z + d.x * width / 2, p.x + d.y * width / 2, y, p.z - d.x * width / 2);
    if (i > 0) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // A flat ribbon faces up whichever way it was wound.
  const n = g.getAttribute("normal"); for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}
function disc(r: number): BufferGeometry {
  const pos = [0, 0, 0], idx: number[] = [];
  for (let i = 0; i <= 20; i++) { const a = (i / 20) * Math.PI * 2; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); if (i > 0) idx.push(0, i + 1, i); }
  const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const normals = new Float32Array(pos.length); for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  g.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  return g;
}
/** A plain open-ended spanner in steel: a handle and a C-shaped jaw, standing up so it reads from any angle. */
function spanner(): Group {
  const R = 2.1, r = 1.1, open = 0.75;
  const jaw = new Shape();
  jaw.absarc(0, 0, R, Math.PI / 2 + open, Math.PI / 2 - open + Math.PI * 2, false);
  jaw.absarc(0, 0, r, Math.PI / 2 - open + Math.PI * 2, Math.PI / 2 + open, true);
  const g = new Group();
  const steel = new MeshStandardMaterial({ color: PALETTE.steel, metalness: 0.5, roughness: 0.38, emissive: new Color("#3a2a18"), emissiveIntensity: 0.3 });
  const head = new Mesh(new ExtrudeGeometry(jaw, { depth: 0.6, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 1 }), steel);
  head.position.set(0, 7.2, -0.3);
  const handle = new Mesh(new BoxGeometry(1.1, 6.4, 0.6), steel);
  handle.position.y = 3.4;
  const tool = new Group();
  tool.add(head, handle);
  tool.rotation.z = 0.45;
  g.add(tool);
  const hit = new Mesh(new BoxGeometry(4.5, 10, 2.5), new MeshLambertMaterial({ visible: false }));
  hit.position.y = 5;
  g.add(hit);
  return g;
}

// ---- the page: wait for the real island, lay the timber on it, and answer clicks ----
const panel = document.createElement("aside");
panel.className = "timber-panel";
panel.hidden = true;
const labelHost = document.createElement("div");
labelHost.className = "timber-labels";
const legend = document.createElement("div");
legend.className = "timber-legend";
let layer: Group | undefined;
let zoomed = false;
/** Closer in on a wide window; a narrow one (the story panel's 30rem) keeps the whole island across its width. */
const ZOOM = 1.35 * Math.min(1, innerWidth / innerHeight / 1.5);
let labelEls: { el: HTMLButtonElement; at: Vector3 }[] = [];

function escape(text: string): string { return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!); }
function contractList(list: Contract[]): string { return list.length === 0 ? "<p class=\"timber-none\">No contracts yet.</p>" : `<ol class="timber-contracts">${list.map((k) => `<li>${escape(k.title)}</li>`).join("")}</ol>`; }
function show(html: string): void { panel.innerHTML = `<button type="button" class="timber-close" aria-label="Close">×</button>${html}`; panel.hidden = false; panel.querySelector(".timber-close")!.addEventListener("click", () => { panel.hidden = true; }); }

function showTerritory(id: string): void {
  const c = caps.get(id)!;
  const word = c.parked ? "parked" : c.word;
  show(`<p class="timber-kicker">Territory · ${escape(word ?? "")} · ${c.lines.toLocaleString()} lines in ${c.files} files</p><h2>${escape(c.title)}</h2><p>${escape(c.description ?? "")}</p><h3>Contracts (${c.contracts.length})</h3>${contractList(c.contracts)}`);
}
function showLinks(kind: "track" | "gate", links: { from: string; to: string }[], route?: string[]): void {
  const called = [...new Set(links.map((l) => l.to))];
  const head = kind === "gate"
    ? `<p class="timber-kicker">Farm gate · ${links.length} pathway${links.length === 1 ? "" : "s"} through it</p><h2>${links.map((l) => `${escape(titleOf(l.from))} → ${escape(titleOf(l.to))}`).join("<br>")}</h2>`
    : `<p class="timber-kicker">Pathway</p><h2>${escape(titleOf(links[0]!.from))} → ${escape(titleOf(links[0]!.to))}</h2>${route && route.length > 2 ? `<p class="timber-note">These two do not touch: the track runs through ${route.slice(1, -1).map((r) => escape(titleOf(r))).join(", ")} and ${route.length - 1} gates.</p>` : ""}`;
  show(head + called.map((id) => `<h3>${escape(titleOf(id))} promises (${caps.get(id)!.contracts.length})</h3>${contractList(caps.get(id)!.contracts)}`).join(""));
}
function showRoad(detail: { kind: string; [k: string]: unknown }): void {
  if (detail.kind === "road-out") {
    const d = detail as unknown as (typeof data.roadsOut)[number];
    show(`<p class="timber-kicker">Road off the coast · to another story</p><h2>${escape(titleOf(d.from))} → ${escape(d.story ?? "")} · ${escape(d.title)}</h2><h3>${escape(d.title)} promises (${d.contracts.length})</h3>${contractList(d.contracts)}`);
  } else {
    const d = detail as unknown as { story: string; calls: typeof data.roadsIn };
    const called = [...new Set(d.calls.map((c) => c.to))];
    show(`<p class="timber-kicker">Road onto the island · ${d.calls.length} call${d.calls.length === 1 ? "" : "s"} from another story</p><h2>${escape(d.story)} calls in</h2><ul class="timber-calls">${d.calls.map((c) => `<li>${escape(c.fromTitle)} → ${escape(titleOf(c.to))}</li>`).join("")}</ul>${called.map((id) => `<h3>${escape(titleOf(id))} promises (${caps.get(id)!.contracts.length})</h3>${contractList(caps.get(id)!.contracts)}`).join("")}`);
  }
}
function showWrench(id: string, work: typeof data.openWork): void {
  const arcs = new Map<string, typeof data.openWork>();
  for (const w of work) arcs.set(w.arcTitle, [...(arcs.get(w.arcTitle) ?? []), w]);
  show(`<p class="timber-kicker">Wrench · open work wants ${escape(titleOf(id))}</p><h2>${arcs.size} arc${arcs.size === 1 ? "" : "s"}, ${work.length} increment${work.length === 1 ? "" : "s"}</h2>${[...arcs].map(([arc, list]) => `<h3>${escape(arc)}</h3><ul class="timber-calls">${list.map((w) => `<li>${escape(w.title)} <span class="timber-status">${escape(w.status)}</span></li>`).join("")}</ul>`).join("")}`);
}

function pick(event: PointerEvent): boolean {
  const g = globe();
  if (!g || !layer) return false;
  const box = g.gl.domElement.getBoundingClientRect();
  const ndc = new Vector2(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
  const ray = new Raycaster();
  ray.setFromCamera(ndc, g.camera);
  const hits = ray.intersectObject(layer, true).filter((h) => h.object.type !== "InstancedMesh");
  const kindOf = (o: Object3D | null): Object3D | undefined => { for (let x = o; x; x = x.parent) if (x.userData.kind || x.userData.road) return x; return undefined; };
  const found = hits.map((h) => kindOf(h.object)).filter((x): x is Object3D => x !== undefined);
  // The nearest thing under the pointer answers.
  const first = found[0];
  const wrench = first?.userData.kind === "wrench" ? first : undefined;
  if (wrench) { showWrench(wrench.userData.capability, wrench.userData.work); return true; }
  const gate = first?.userData.kind === "gate" ? first : undefined;
  if (gate) {
    showLinks("gate", gate.userData.links);
    const roads = gate.userData.roads as string[];
    if (roads.length > 0) panel.querySelector("h2")!.insertAdjacentHTML("afterend", `<p class="timber-note">Also on the way to the sea: ${roads.map(escape).join("; ")}</p>`);
    return true;
  }
  const road = first?.userData.road ? first : undefined;
  if (road) { showRoad(road.userData as { kind: string }); return true; }
  const tracks = found.filter((x) => x.userData.kind === "track");
  if (tracks.length > 0) {
    if (tracks.length === 1) showLinks("track", tracks[0]!.userData.links, tracks[0]!.userData.route);
    else showLinks("gate", [...new Map(tracks.flatMap((t) => t.userData.links).map((l: { from: string; to: string }) => [`${l.from}${l.to}`, l])).values()]);
    if (tracks.length > 1) panel.querySelector(".timber-kicker")!.textContent = `${tracks.length} pathways share this stretch of track`;
    return true;
  }
  const land = g.scene.getObjectByName(`planet:${STORY}`)?.getObjectByName("territory-land");
  const t = land ? ray.intersectObject(land, true).find((h) => h.object.name.startsWith("territory:capability_")) : undefined;
  if (t) { showTerritory(t.object.name.slice("territory:".length)); return true; }
  return false;
}

let down: { x: number; y: number } | undefined;
window.addEventListener("pointerdown", (e) => { down = e.target instanceof HTMLCanvasElement && e.button === 0 && !e.ctrlKey ? { x: e.clientX, y: e.clientY } : undefined; }, true);
window.addEventListener("pointerup", (e) => {
  if (REAL || !down || !(e.target instanceof HTMLCanvasElement)) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = undefined;
  if (moved > 5) return;
  if (pick(e)) {
    // The map's own click would open the story panel: this mock answers instead, and the map forgets the press.
    e.stopImmediatePropagation();
    e.target.dispatchEvent(new PointerEvent("pointercancel", { pointerId: e.pointerId, bubbles: true }));
  }
}, true);

function attach(): void {
  const g = globe();
  const planet = g?.scene.getObjectByName(`planet:${STORY}`);
  const land = planet?.getObjectByName("territory-land");
  const borders = land?.getObjectByName("territory-borders") as LineSegments | undefined;
  if (!g || !land || !borders || borders.geometry.drawRange.count !== Infinity) return;
  const dots = planet!.getObjectByName("file-circles");
  if (!REAL && dots && dots.visible) { dots.visible = false; g.invalidate(); }
  if (REAL) {
    // The map as drawn today, at the same framing as the mock, so the two differ only by what the mock adds.
    if (!zoomed) { zoomed = true; g.camera.zoom *= ZOOM; g.camera.updateProjectionMatrix(); g.invalidate(); document.body.dataset.timber = "ready"; }
    return;
  }
  if (layer && layer.parent === land.parent) return;
  layer?.removeFromParent();
  layer = build(land);
  land.parent!.add(layer);
  labelEls.forEach(({ el }) => el.remove());
  labelEls = (layer.userData.labels as { at: Vector3; text: string; detail: { kind: string } }[]).map(({ at, text, detail }) => {
    const el = document.createElement("button");
    el.type = "button"; el.className = `timber-label ${detail.kind}`; el.textContent = detail.kind === "road-out" ? `→ ${text}` : `← ${text}`;
    el.addEventListener("click", () => showRoad(detail));
    labelHost.append(el);
    return { el, at: at.clone().add(new Vector3(0, 1.5, 0)) };
  });
  (window as unknown as { __timber?: unknown }).__timber = layer.userData.summary;
  document.body.dataset.timber = "ready";
  // Closer in than the globe opens, as the story's panel would show its one island.
  if (!zoomed) { zoomed = true; g.camera.zoom *= ZOOM; g.camera.updateProjectionMatrix(); }
  g.invalidate();
}

function placeLabels(): void {
  const g = globe();
  if (g && layer && layer.parent) {
    const box = g.gl.domElement.getBoundingClientRect();
    for (const { el, at } of labelEls) {
      const p = layer.localToWorld(at.clone()).project(g.camera);
      el.style.left = `${box.left + ((p.x + 1) / 2) * box.width}px`;
      el.style.top = `${box.top + ((1 - p.y) / 2) * box.height}px`;
      el.hidden = p.z > 1;
    }
    // The wrench turns to face the viewer, so it never reads edge-on.
    const eye = layer.worldToLocal(g.camera.getWorldPosition(new Vector3()));
    let turned = false;
    for (const w of layer.children.filter((c) => c.userData.kind === "wrench")) {
      const angle = Math.atan2(eye.x - w.position.x, eye.z - w.position.z);
      if (Math.abs(angle - w.rotation.y) > 0.01) { w.rotation.y = angle; turned = true; }
    }
    if (turned) g.invalidate();
    // Labels that would overlap step down below the one already there.
    const placed: DOMRect[] = [];
    for (const { el } of [...labelEls].sort((a, b) => parseFloat(a.el.style.top) - parseFloat(b.el.style.top))) {
      let r = el.getBoundingClientRect();
      for (let guard = 0; guard < 8 && placed.some((q) => r.left < q.right && r.right > q.left && r.top < q.bottom && r.bottom > q.top); guard++) {
        el.style.top = `${parseFloat(el.style.top) + r.height + 3}px`;
        r = el.getBoundingClientRect();
      }
      placed.push(r);
    }
  }
  requestAnimationFrame(placeLabels);
}

function start(): void {
  document.body.classList.add(REAL ? "timber-real" : "timber");
  if (!REAL) {
    legend.innerHTML = `<strong>The library</strong><span>Timber fences between capabilities · farm gates where a path crosses · click a field, a track, a gate, a road or the wrench</span><span class="timber-measured">Measured ${escape(data.measuredAt.slice(0, 10))} from the real library and code</span>`;
    document.body.append(labelHost, panel, legend);
  }
  setInterval(attach, 300);
  requestAnimationFrame(placeLabels);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
