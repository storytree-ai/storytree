/** Round 12's sea lanes, option A (`?sea=harbour` or `?sea=pier`): the owner's direction (2026-11-03) is that the line at sea
 * stays a plain cartographer's line ("cartographers often draw shipping lanes with just a simple line ... maybe its the
 * coast connection that needs to work not the lane"), so the two options differ only in how that line meets the island.
 *
 * At sea, both options: the map's lanes (purple and teal) and its tan road band under them are hidden for the selection,
 * and each road segment the selection's links travel (the map's own `pathway:` segments, which name the links they carry)
 * is drawn ONCE as a thin line in the sandy track's colour mixed into the sea, so routes share a line until they part, a
 * step heavier where it carries more (the same steps as the roads ashore, so the line arriving at the mouth is exactly as
 * heavy as the trunk it becomes). In is a solid line, out a dashed one, both the same quiet colour.
 *
 * The way out: the map sends the one link out (Connection by address calls Keys) through the mouth, while round 11's roads
 * ashore send it to its own landfall on the west coast. Here the dashed line leaves from that landfall instead, rounding
 * the island offshore to join the map's own route out where it is nearest, so each road ashore has its own line at sea.
 *
 * The landing, where the line meets the sandy trunk (the strongest part of each option):
 * - `harbour`: a small stone quay standing out from the open land's edge, its top the sandy track's colour, and one thin
 *   breakwater arm curling round in front of it. The line comes in past the arm's head and rises onto the quay's face,
 *   and the trunk starts on the quay.
 * - `pier`: a narrow jetty on thin piles reaching straight out from the open land, a small T at its head. The line runs
 *   in to the head and onto the deck, and the trunk runs the length of the deck to the shore.
 * Keys' landfall gets the same mark, smaller. */
import { BufferGeometry, CircleGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, Vector3, type Object3D } from "three";
import type { RootState } from "@react-three/fiber";

type P = { x: number; z: number };
export type SeaKind = "harbour" | "pier";
export type SeaContext = {
  state: RootState; root: Object3D; group: Group; kind: SeaKind;
  harbour: { dock: P; sea: P }; keys: { dock: P; sea: P };
  onLand(p: P): boolean; heightAt(p: P): number;
  /** A colour shaded for a face looking `facing` on the ground (the overlay's light). */
  shade(c: Color, facing: P): Color;
  /** The colour the sandy track shows at a point ashore. */
  track(p: P): Color;
  /** The trunk's width for n links (the overlay's sandy track steps). */
  trackWidth(n: number): number;
};

/** The sea as the page shows it, and the open land (both read off round 11's stills). */
const SEA = new Color("#18242d"), SAND = new Color("#e2d3aa");
/** The line at sea: the sand mixed this far into the sea; dashes for the way out. */
const LINE = { mix: 0.56, dash: 2.2, gap: 1.5, lift: 0.18 };
/** The line's width by load, the roads ashore's steps (1, 2-3, 4-7, 8+), and one finer step below them for the long
 * single-link routes far out. */
const widthAt = (n: number, track: (n: number) => number) => n >= 100 ? track(n) : n >= 32 ? 1.05 : n >= 8 ? 0.82 : n >= 2 ? 0.6 : 0.42;
/** How far before the landing the line rises from the sea onto the structure's top. */
const RISE = 9;

const d2 = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
const nrm = (a: P): P => { const l = Math.hypot(a.x, a.z) || 1; return { x: a.x / l, z: a.z / l }; };
const at = (p: P, d: P, k: number): P => ({ x: p.x + d.x * k, z: p.z + d.z * k });
const perp = (a: P): P => ({ x: -a.z, z: a.x });
const smoothstep = (t: number) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };

/** Catmull-Rom through `pts`, about a point per unit. */
function smooth(pts: Vector3[]): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(pts.length - 1, i + 2)]!, n = Math.max(3, Math.ceil(p1.distanceTo(p2)));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t, f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push(new Vector3(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z)));
    }
  }
  out.push(pts.at(-1)!.clone());
  return out;
}

export function seaLayer(ctx: SeaContext) {
  const { state, root, group } = ctx;
  const scene = state.scene;
  const inverse = new Matrix4().copy(root.matrixWorld).invert();
  const hide = (o: Object3D) => { if (!Object.getOwnPropertyDescriptor(o, "visible")?.get) Object.defineProperty(o, "visible", { get: () => false, set: () => {}, configurable: true }); };

  // The selection's links, from the map's own lanes (their userData names each end and the direction).
  const dirOf = new Map<string, "up" | "down">();
  scene.getObjectByName("pathways:selection-lanes")?.traverse(o => { if (o.name.startsWith("lane:")) dirOf.set(`${o.userData.from}->${o.userData.to}`, o.userData.dir); });
  /** Hides the map's lanes, their end pips, and its road band under every segment the selection travels; again whenever it redraws. */
  const hideMaps = () => {
    scene.getObjectByName("pathways:selection-lanes")?.traverse(o => { if (o.name.startsWith("lane")) hide(o); });
    scene.getObjectByName("pathways:cross-island")?.traverse(o => {
      if (!o.name.startsWith("pathway:")) return;
      if (!(o.userData.links as string[]).some(l => dirOf.has(l))) return;
      for (const sibling of o.parent!.children) hide(sibling);
    });
    state.invalidate();
  };
  hideMaps();

  // Each segment the selection travels, its centre line in the island's frame, and what it carries in and out.
  type Seg = { id: string; pts: Vector3[]; ins: number; outs: number };
  const segs: Seg[] = [];
  scene.getObjectByName("pathways:cross-island")?.traverse(o => {
    if (!o.name.startsWith("pathway:")) return;
    const carried = (o.userData.links as string[]).filter(l => dirOf.has(l));
    if (!carried.length) return;
    const mesh = o as Mesh, a = mesh.geometry.getAttribute("position");
    mesh.updateMatrixWorld(true);
    const pts: Vector3[] = [];
    for (let i = 0; i < a.count / 2; i++) pts.push(new Vector3((a.getX(2 * i) + a.getX(2 * i + 1)) / 2, (a.getY(2 * i) + a.getY(2 * i + 1)) / 2, (a.getZ(2 * i) + a.getZ(2 * i + 1)) / 2).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse));
    segs.push({ id: o.name, pts, ins: carried.filter(l => dirOf.get(l) === "down").length, outs: carried.filter(l => dirOf.get(l) === "up").length });
  });

  // ── The landings ─────────────────────────────────────────────────────────────────────────────────────────────────
  /** Where the line from `sea` toward `dock` first meets the land, and the way inland there. */
  const landfall = (h: { dock: P; sea: P }) => {
    const d = nrm({ x: h.dock.x - h.sea.x, z: h.dock.z - h.sea.z }), far = at(h.dock, d, -40);
    let c = h.dock;
    for (let k = 0; k <= 400; k++) { const p = at(far, d, k * 0.1); if (ctx.onLand(p)) { c = p; break; } }
    return { c, d, n: perp(d) };
  };
  const seaYNear = (p: P) => { let best = Infinity, y = 0; for (const s of segs) for (const q of s.pts) { const dd = d2(p, { x: q.x, z: q.z }); if (dd < best) { best = dd; y = q.y; } } return y; };

  // Solid structures, depth tested so the island hides them where it stands in front.
  const pos: number[] = [], col: number[] = [];
  const tri = (a: Vector3, b: Vector3, c: Vector3, k: Color) => { pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); for (let i = 0; i < 3; i++) col.push(k.r, k.g, k.b); };
  const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3, k: Color) => { tri(a, b, c, k); tri(a, c, d, k); };
  const v = (p: P, y: number) => new Vector3(p.x, y, p.z);
  /** A block: its footprint (four corners, in order), from `low` up to `top`, its top coloured `topColour`, its sides `side` shaded by the light. */
  const block = (foot: P[], low: number, top: number, topColour: Color, side: Color) => {
    quad(v(foot[0]!, top), v(foot[1]!, top), v(foot[2]!, top), v(foot[3]!, top), topColour);
    const mid = { x: foot.reduce((s, p) => s + p.x, 0) / 4, z: foot.reduce((s, p) => s + p.z, 0) / 4 };
    for (let i = 0; i < 4; i++) {
      const a = foot[i]!, b = foot[(i + 1) % 4]!, out = { x: (a.x + b.x) / 2 - mid.x, z: (a.z + b.z) / 2 - mid.z };
      quad(v(a, top), v(b, top), v(b, low), v(a, low), ctx.shade(side, out));
    }
  };
  /** A rectangle's corners: centred at `c`, `along` d by `len` and across n by `wide`. */
  const rect = (c: P, d: P, n: P, len: number, wide: number): P[] => [at(at(c, d, -len / 2), n, -wide / 2), at(at(c, d, len / 2), n, -wide / 2), at(at(c, d, len / 2), n, wide / 2), at(at(c, d, -len / 2), n, wide / 2)];

  const STONE = new Color("#7d8483"), DECK = new Color("#b3a682"), PILE = new Color("#20262a"), GROUND = new Color("#686d70");
  type Landing = { face: Vector3; inward: P; top: number };
  /** A slope from `from` (at `y0`) to `to` (at `y1`), `wide` across: its top coloured `topColour`, its two cheeks and its foot
   * face shaded stone down to `low`, so it reads as standing out of the sea. */
  const slope = (from: P, to: P, y0: number, y1: number, wide: number, low: number, topColour: Color, side: Color) => {
    const d = nrm({ x: to.x - from.x, z: to.z - from.z }), n = perp(d);
    const a0 = at(from, n, -wide / 2), b0 = at(from, n, wide / 2), a1 = at(to, n, -wide / 2), b1 = at(to, n, wide / 2);
    quad(v(a0, y0), v(b0, y0), v(b1, y1), v(a1, y1), topColour);
    quad(v(a0, y0), v(a1, y1), v(a1, low), v(a0, low), ctx.shade(side, { x: -n.x, z: -n.z }));
    quad(v(b0, y0), v(b1, y1), v(b1, low), v(b0, low), ctx.shade(side, n));
    quad(v(a1, y1), v(b1, y1), v(b1, low), v(a1, low), ctx.shade(side, d));
  };
  /** Draws the landing for a road ashore with `n` links; returns where the line at sea meets it and the way in. */
  const landing = (h: { dock: P; sea: P }, n: number, big: boolean): Landing => {
    const { c, d, n: across } = landfall(h), top = ctx.heightAt(c) + 0.02, seaY = seaYNear(c), low = seaY - 0.4;
    const trackW = ctx.trackWidth(n), trackColour = ctx.track(h.dock);
    const out = (k: number) => at(c, d, -k);
    // The sandy track from where the landing leaves the land to the dock, where round 11's trunk starts.
    const ashore = (from: P) => { if (d2(from, h.dock) > 0.3) ribbonFlat([from, h.dock], trackW, p => ctx.heightAt(p) + 0.36, trackColour); };
    if (ctx.kind === "harbour") {
      // A slipway: a broad stone ramp from the open land's edge down into the water, the sandy track running down its
      // middle to the water line, where the line at sea takes over; one low breakwater arm curls round in front of it.
      const len = big ? 10 : 7, wide = big ? 3.8 : 2.8, foot = seaY + 0.25;
      const slipTop = GROUND.clone().lerp(STONE, 0.5);
      slope(at(c, d, 0.8), out(len), top, foot, wide, low, slipTop, STONE);
      ribbonTilted(at(c, d, 0.8), out(len), top + 0.03, foot + 0.03, trackW, trackColour, SEA.clone().lerp(SAND, LINE.mix));
      ashore(at(c, d, 0.8));
      // The arm: from the shore beside the slip, out and round across the approach, the harbour mouth left on the far side.
      const s = big ? 1 : 0.7;
      const arm = [at(at(c, across, wide / 2 + 3.4 * s), d, 1.5), at(out(3.5 * s), across, wide / 2 + 4.2 * s), at(out(len + 1.5 * s), across, wide / 2 + 2.6 * s), at(out(len + 3.5 * s), across, wide / 2 + 1.0 * s)];
      const curve = smooth(arm.map(p => v(p, 0))).map(q => ({ x: q.x, z: q.z })), armW = big ? 1.0 : 0.75, armTop = seaY + (big ? 1.1 : 0.9);
      for (let i = 0; i + 1 < curve.length; i++) {
        const a = curve[i]!, b = curve[i + 1]!, t = nrm({ x: b.x - a.x, z: b.z - a.z }), m = perp(t);
        // The arm leaves the land at the land's height, and steps down to its low run once it is out over the water.
        const ya = ctx.onLand(a) ? top : armTop, yb = ctx.onLand(b) ? top : armTop;
        const f = [at(a, m, -armW / 2), at(b, m, -armW / 2), at(b, m, armW / 2), at(a, m, armW / 2)];
        quad(v(f[0]!, ya), v(f[1]!, yb), v(f[2]!, yb), v(f[3]!, ya), STONE.clone().lerp(SAND, 0.3));
        for (const [p0, p1, face] of [[f[0]!, f[1]!, { x: -m.x, z: -m.z }], [f[3]!, f[2]!, m]] as [P, P, P][]) quad(v(p0, ya), v(p1, yb), v(p1, low), v(p0, low), ctx.shade(STONE, face));
      }
      return { face: v(out(len), foot + LINE.lift), inward: d, top };
    }
    // A jetty: a narrow deck on piles reaching straight out from the open land, a small T at its head, its deck easing down
    // from the land toward the water; the sandy track runs the deck's length, and the line at sea comes in to the head.
    const len = big ? 13 : 9, wide = big ? 1.9 : 1.5, head = big ? 5.2 : 3.8, headDepth = big ? 2.2 : 1.8, slab = 0.4;
    const headY = seaY + 1.4, deckAt = (k: number) => top + (headY - top) * smoothstep(k / len);
    const deck = DECK.clone().lerp(GROUND, 0.2);
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const k0 = -0.8 + (len + 0.8) * i / steps, k1 = -0.8 + (len + 0.8) * (i + 1) / steps;
      slope(out(k0), out(k1), deckAt(Math.max(0, k0)), deckAt(k1), wide, deckAt(k1) - slab, deck, DECK);
    }
    const headAt = out(len + headDepth / 2);
    block(rect(headAt, d, across, headDepth, head), headY - slab, headY, deck, DECK);
    // Piles: thin dark posts under the deck's edges and the head's corners, down into the sea.
    const pile = (p: P, y: number) => block(rect(p, d, across, 0.3, 0.3), low, y - slab, PILE, PILE);
    for (let k = 1.6; k < len - 0.4; k += 2.4) for (const sg of [-1, 1]) pile(at(out(k), across, sg * (wide / 2 - 0.15)), deckAt(k));
    for (const sg of [-1, 1]) for (const dd of [0.3, headDepth - 0.3]) pile(at(out(len + dd), across, sg * (head / 2 - 0.25)), headY);
    // The track down the deck's middle, from the head to the shore, then on to the dock.
    const tw = Math.min(trackW, wide - 0.6);
    const wet = SEA.clone().lerp(SAND, LINE.mix), mixAt = (k: number) => trackColour.clone().lerp(wet, smoothstep(k / (len + headDepth)));
    for (let i = 0; i < steps; i++) { const k0 = len * i / steps, k1 = len * (i + 1) / steps; ribbonTilted(out(k0), out(k1), deckAt(k0) + 0.03, deckAt(k1) + 0.03, tw, mixAt(k0), mixAt(k1)); }
    ribbonTilted(out(len), out(len + headDepth - 0.3), headY + 0.03, headY + 0.03, tw, mixAt(len), wet);
    ribbonTilted(at(c, d, 0.8), out(0), top + 0.03, top + 0.03, tw, trackColour);
    ashore(at(c, d, 0.8));
    return { face: v(out(len + headDepth), seaY + LINE.lift), inward: d, top };
  };
  /** A flat strip from `a` (at `ya`, coloured `k`) to `b` (at `yb`, coloured `k2`, or `k`). */
  function ribbonTilted(a: P, b: P, ya: number, yb: number, width: number, k: Color, k2 = k) {
    const n = 8, pts = Array.from({ length: n + 1 }, (_, i) => v({ x: a.x + (b.x - a.x) * i / n, z: a.z + (b.z - a.z) * i / n }, ya + (yb - ya) * i / n));
    const g = strip(pts, width), c: number[] = [];
    pts.forEach((_, i) => { const m = k.clone().lerp(k2, i / n); c.push(m.r, m.g, m.b, m.r, m.g, m.b); });
    g.setAttribute("color", new Float32BufferAttribute(c, 3));
    addMesh(g, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, depthWrite: false, depthTest: true, fog: false, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 7);
  }

  // ── Drawing the line ─────────────────────────────────────────────────────────────────────────────────────────────
  const lineMats = new Map<string, MeshBasicMaterial>();
  const lineMat = (k: Color) => { const key = k.getHexString(); let m = lineMats.get(key); if (!m) { m = new MeshBasicMaterial({ color: k, transparent: true, opacity: 1, side: DoubleSide, depthWrite: false, depthTest: true, fog: false }); lineMats.set(key, m); } return m; };
  const addMesh = (g: BufferGeometry, m: MeshBasicMaterial, order: number) => { const o = new Mesh(g, m); o.renderOrder = order; o.raycast = () => {}; group.add(o); return o; };
  /** A strip `width` wide along 3D points (the ground's up is the island frame's y). */
  function strip(pts: Vector3[], width: number): BufferGeometry {
    const p: number[] = [], index: number[] = [];
    pts.forEach((q, i) => {
      const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!, dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l * width / 2, nz = dx / l * width / 2;
      p.push(q.x + nx, q.y, q.z + nz, q.x - nx, q.y, q.z - nz);
      if (i) { const k = 2 * i; index.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    });
    const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(p, 3)); g.setIndex(index); return g;
  }
  function ribbonFlat(pts: P[], width: number, y: (p: P) => number, k: Color) {
    const dense: P[] = [pts[0]!];
    for (let i = 1; i < pts.length; i++) { const a = pts[i - 1]!, b = pts[i]!, n = Math.max(1, Math.ceil(d2(a, b) / 0.5)); for (let s = 1; s <= n; s++) dense.push({ x: a.x + (b.x - a.x) * s / n, z: a.z + (b.z - a.z) * s / n }); }
    addMesh(strip(dense.map(p => new Vector3(p.x, y(p), p.z)), width, ), new MeshBasicMaterial({ color: k, side: DoubleSide, depthWrite: false, depthTest: true, fog: false, transparent: true }), 7);
  }
  const lineColour = SEA.clone().lerp(SAND, LINE.mix);
  /** One line: solid, or dashed for the way out. */
  const line = (pts: Vector3[], width: number, dashed: boolean) => {
    const lifted = pts;
    if (!dashed) { addMesh(strip(lifted, width), lineMat(lineColour), 6); return; }
    let run: Vector3[] = [], along = 0, on = true;
    for (let i = 0; i < lifted.length; i++) {
      if (i) along += lifted[i]!.distanceTo(lifted[i - 1]!);
      const period = LINE.dash + LINE.gap, phase = along % period, now = phase < LINE.dash;
      if (now) run.push(lifted[i]!);
      if (!now && on && run.length > 1) { addMesh(strip(run, width), lineMat(lineColour), 6); run = []; }
      if (!now) run = [];
      on = now;
    }
    if (run.length > 1) addMesh(strip(run, width), lineMat(lineColour), 6);
  };
  const lift = (q: Vector3) => new Vector3(q.x, q.y + LINE.lift, q.z);
  const dense = (pts: Vector3[], step = 0.6) => { const out = [pts[0]!.clone()]; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1]!, b = pts[i]!, n = Math.max(1, Math.ceil(a.distanceTo(b) / step)); for (let k = 1; k <= n; k++) out.push(a.clone().lerp(b, k / n)); } return out; };
  /** The way in to a landing: the points held off the land, then rising over the last stretch onto its face. */
  const arrive = (pts: Vector3[], to: Landing) => {
    const sea = pts.filter(q => !ctx.onLand({ x: q.x, z: q.z }) && d2({ x: q.x, z: q.z }, { x: to.face.x, z: to.face.z }) > 2.5);
    // The last few units run straight in along the landing's axis.
    const lead = [at({ x: to.face.x, z: to.face.z }, to.inward, -6), at({ x: to.face.x, z: to.face.z }, to.inward, -2.5)];
    const keep = sea.filter(q => d2({ x: q.x, z: q.z }, { x: to.face.x, z: to.face.z }) > 6.5);
    const seaY = keep.at(-1)?.y ?? to.top;
    const path = dense(smooth([...keep.slice(-6).map(q => q.clone()), ...lead.map(p => v(p, seaY)), v({ x: to.face.x, z: to.face.z }, seaY)]));
    const head = [...keep.slice(0, Math.max(0, keep.length - 6)).map(lift), ...path.map(lift)];
    let fromEnd = 0;
    for (let i = head.length - 1; i >= 0; i--) {
      if (i < head.length - 1) fromEnd += head[i]!.distanceTo(head[i + 1]!);
      const t = smoothstep(1 - fromEnd / RISE);
      head[i]!.y = head[i]!.y + (to.face.y - head[i]!.y) * t;
    }
    return head;
  };

  const mouth = landing(ctx.harbour, segs.reduce((m, s) => Math.max(m, s.ins), 0), true);
  const keysLanding = landing(ctx.keys, 1, false);
  { const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(pos, 3)); g.setAttribute("color", new Float32BufferAttribute(col, 3));
    addMesh(g, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, depthWrite: true, depthTest: true, fog: false }), 5); }
  const near = (s: Seg, p: P, r: number) => [s.pts[0]!, s.pts.at(-1)!].some(q => d2({ x: q.x, z: q.z }, p) < r);
  const ends = new Map<string, { at: Vector3; w: number }>();
  const endKey = (q: Vector3) => `${q.x.toFixed(1)},${q.z.toFixed(1)}`;
  const stats = { segments: 0, inSegments: 0, outSegments: 0, keysJoin: undefined as unknown, landOnConnector: 0, mouthLanding: [mouth.face.x, mouth.face.y, mouth.face.z].map(x => +x.toFixed(1)) };
  for (const s of segs) {
    // The way out leaves from Keys' landfall, so the shared segments are drawn for what comes in.
    if (s.ins === 0) continue;
    let pts = s.pts.map(q => q.clone());
    if (near(s, ctx.harbour.dock, 6)) {
      if (d2({ x: pts[0]!.x, z: pts[0]!.z }, ctx.harbour.dock) < d2({ x: pts.at(-1)!.x, z: pts.at(-1)!.z }, ctx.harbour.dock)) pts.reverse();
      pts = arrive(pts, mouth);
    } else pts = pts.filter(q => !ctx.onLand({ x: q.x, z: q.z })).map(lift);
    if (pts.length < 2) continue;
    const w = widthAt(s.ins, ctx.trackWidth);
    line(pts, w, false);
    stats.segments++; stats.inSegments++;
    for (const q of [pts[0]!, pts.at(-1)!]) { const k = endKey(q), was = ends.get(k); if (!was || was.w < w) ends.set(k, { at: q, w }); }
  }
  // Junctions: a disc as wide as the heaviest line meeting there, so the joins read as one line.
  for (const { at: q, w } of ends.values()) { const g = new CircleGeometry(w / 2, 16); g.rotateX(-Math.PI / 2); const o = addMesh(g, lineMat(lineColour), 6); o.position.copy(q); }

  // The way out: the segments that carry only out, joined to Keys' landfall offshore where the route passes nearest.
  const outs = segs.filter(s => s.ins === 0 && s.outs > 0);
  if (outs.length) {
    const kf = { x: keysLanding.face.x, z: keysLanding.face.z };
    let join = { s: outs[0]!, i: 0, d: Infinity };
    // Joined where the route passes nearest a point well out along the landfall's axis, so the line leaves straight out and meets the route heading on.
    const outAt = at(kf, keysLanding.inward, -40);
    for (const s of outs) s.pts.forEach((q, i) => { const dd = d2({ x: q.x, z: q.z }, outAt); if (dd < join.d) join = { s, i, d: dd }; });
    // From the join, the route on away from the island, and every other out-only segment beyond it.
    const js = join.s, ahead = js.pts.slice(0, join.i + 1), behind = js.pts.slice(join.i);
    const farther = (pts: Vector3[]) => pts.reduce((s, q) => s + Math.hypot(q.x, q.z), 0) / pts.length;
    const onward = farther(ahead) > farther(behind) ? ahead : behind;
    const dropped = onward === ahead ? behind : ahead;
    // The segments drawn: the onward part of the join's segment, and the out-only segments not between it and the mouth.
    const toMouth = (s: Seg) => s !== js && s.pts.some(q => dropped.some(r => r.distanceTo(q) < 0.5));
    const w = widthAt(1, ctx.trackWidth);
    line(dense(onward).map(lift), w, true);
    for (const s of outs) if (s !== js && !toMouth(s)) line(dense(s.pts).map(lift), w, true);
    // The connector: out from the landfall along its axis, then round to the join, held off the land.
    const centre = { x: 0, z: 0 }, J = js.pts[join.i]!;
    const a0 = at(kf, keysLanding.inward, -7);
    const mid = { x: (a0.x + J.x) / 2, z: (a0.z + J.z) / 2 };
    let via = [v(kf, J.y), v(a0, J.y), v(mid, J.y), J.clone()];
    let path = smooth(via);
    for (let pass = 0; pass < 6; pass++) {
      const bad = path.filter(q => ctx.onLand({ x: q.x, z: q.z }) || [0, 1, 2, 3, 4, 5, 6, 7].some(k => ctx.onLand({ x: q.x + 5 * Math.cos(k * Math.PI / 4), z: q.z + 5 * Math.sin(k * Math.PI / 4) })));
      if (!bad.length) break;
      via = via.map((q, i) => i === 0 || i === via.length - 1 ? q : (() => { const r = nrm({ x: q.x - centre.x, z: q.z - centre.z }); return new Vector3(q.x + r.x * 6, q.y, q.z + r.z * 6); })());
      path = smooth(via);
    }
    stats.landOnConnector = path.filter(q => ctx.onLand({ x: q.x, z: q.z })).length;
    // Laid on the globe's sea, as the map's own routes are: the height the sea stands at each point, from the join's radius.
    const C = new Vector3(0, 0, 0).applyMatrix4(scene.getObjectByName("globe")!.matrixWorld).applyMatrix4(inverse), R = J.distanceTo(C);
    const onSea = (q: Vector3) => new Vector3(q.x, C.y + Math.sqrt(Math.max(0, R * R - (q.x - C.x) ** 2 - (q.z - C.z) ** 2)), q.z);
    const connector = arrive([...dense(path)].reverse().map(onSea), keysLanding).reverse();
    line(connector, w, true);
    stats.outSegments = outs.length; stats.keysJoin = { at: [J.x, J.z].map(x => +x.toFixed(1)), segment: js.id };
  }
  state.invalidate();
  return { keep: hideMaps, stats };
}
