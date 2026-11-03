/** A piece of the capability-tree map (round 11's colours and sizes) drawn six ways, to see whether a little 2.5D makes the
 * map easier on the eyes and its gates read as entrances. One piece of land about 110 x 70 ground units: two healthy
 * territories (A west, B north-east), one untested (C south-east), a strip of open land along the coast with the plate's
 * side falling to the sea, a quiet road that crosses two borders at gates (G1 A|B, G2 B|C) to a settlement in C, and a
 * second road from there that leaves C onto the open land at a third gate (G3).
 * Hand-picked face colours with MeshBasicMaterial, no lights, linear output with no tone mapping, so the hex colours here
 * are the bytes on screen. Light from the upper left of the screen (north-west and above). */
import * as THREE from "three";

THREE.ColorManagement.enabled = false;

type P = { x: number; z: number };
type RGB = [number, number, number];
type RGBA = [number, number, number, number];
type V3 = [number, number, number];
type Region = "A" | "B" | "C" | "open";

const hex = (h: string): RGB => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a: RGB, f: number): RGB => [Math.min(1, a[0] * f), Math.min(1, a[1] * f), Math.min(1, a[2] * f)];
const rgba = (c: RGB, a = 1): RGBA => [c[0], c[1], c[2], a];

/** Round 11's displayed colours (sampled from the still) and overlay.ts's PALETTE. */
const COL = {
  healthy: hex("#8eb35e"), untested: hex("#d6bd6c"), open: hex("#686d70"), sea: "#18242d",
  border: hex("#f4f7f8"), road: hex("#efe8d6"), post: hex("#1b2024"), paper: hex("#f3efe4"),
  townInk: hex("#2a2723"), casing: hex("#141a20"), white: [1, 1, 1] as RGB, black: [0, 0, 0] as RGB,
  /** The plate's side fall as the map shades it: #374335 facing south, #4f624d facing west (both sampled). */
  wallSouth: hex("#374335"),
};
/** overlay.ts SIZE, in ground units. */
const SIZE = { opening: 3.0, post: 1.45, face: 0.9, town: 1.05, townRing: 0.36, casing: 0.42, road: 0.6 };

// ── Light: from the upper left of the screen, which is north-west (-x, -z) and above ─────────────────────────────────
const L = new THREE.Vector3(-0.6, 1, -0.75).normalize();
const LH = (() => { const l = Math.hypot(-0.6, -0.75); return { x: -0.6 / l, z: -0.75 / l }; })();
/** Where a shadow falls, per unit of height: away from the light. */
const SHADOW = { x: -L.x / L.y, z: -L.z / L.y };
const AMB = 0.5, DIF = 0.5, TOP = AMB + DIF * L.y;
/** A face's brightness against a level top: 1 for a top, 0.58 for a south or east face, 0.83 west, 0.89 north. */
const shade = (n: THREE.Vector3) => (AMB + DIF * Math.max(0, n.dot(L))) / TOP;

// ── 2D helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────
const sub = (a: P, b: P): P => ({ x: a.x - b.x, z: a.z - b.z });
const addP = (a: P, b: P, k = 1): P => ({ x: a.x + b.x * k, z: a.z + b.z * k });
const len = (a: P) => Math.hypot(a.x, a.z);
const dist = (a: P, b: P) => len(sub(a, b));
const norm = (a: P): P => { const l = len(a) || 1; return { x: a.x / l, z: a.z / l }; };
const dot = (a: P, b: P) => a.x * b.x + a.z * b.z;
const left = (a: P): P => ({ x: -a.z, z: a.x });
const area = (poly: P[]) => { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i]!, b = poly[(i + 1) % poly.length]!; s += a.x * b.z - b.x * a.z; } return s / 2; };
const inPolygon = (p: P, poly: readonly P[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
};
const toSegment = (p: P, a: P, b: P) => {
  const dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
};
function segCross(a: P, b: P, c: P, d: P): P | undefined {
  const r = sub(b, a), s = sub(d, c), den = r.x * s.z - r.z * s.x;
  if (Math.abs(den) < 1e-12) return undefined;
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / den, u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: a.x + t * r.x, z: a.z + t * r.z } : undefined;
}
/** A smooth way through `pts` (Catmull-Rom), then a point every `step` along it. */
function smooth(pts: P[], step = 0.2): P[] {
  const dense: P[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(pts.length - 1, i + 2)]!, n = Math.max(8, Math.ceil(dist(p1, p2) * 4));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t, f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  dense.push(pts.at(-1)!);
  return resample(dense, step);
}
function resample(pts: P[], step: number): P[] {
  const out: P[] = [pts[0]!];
  let carry = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!, l = dist(a, b);
    let s = step - carry;
    while (s <= l) { out.push({ x: a.x + (b.x - a.x) * s / l, z: a.z + (b.z - a.z) * s / l }); s += step; }
    carry = l - (s - step);
  }
  if (dist(out.at(-1)!, pts.at(-1)!) > 1e-6) out.push(pts.at(-1)!);
  return out;
}
/** `pts` with the stretch within `half` (along it) of each hole cut out, as the pieces left. */
function cut(pts: P[], holes: P[], half: number): P[][] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + dist(pts[i - 1]!, pts[i]!));
  const total = cum.at(-1)!;
  const at = (s: number): P => {
    let i = 0; while (i + 2 < pts.length && cum[i + 1]! < s) i++;
    const t = (s - cum[i]!) / ((cum[i + 1]! - cum[i]!) || 1);
    return { x: pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * t, z: pts[i]!.z + (pts[i + 1]!.z - pts[i]!.z) * t };
  };
  const gaps: [number, number][] = [];
  for (const h of holes) {
    let best = Infinity, sAt = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const d = toSegment(h, pts[i]!, pts[i + 1]!);
      if (d < best) { best = d; const ab = sub(pts[i + 1]!, pts[i]!), l = len(ab); sAt = cum[i]! + Math.max(0, Math.min(l, dot(sub(h, pts[i]!), ab) / l)); }
    }
    if (best < 0.05) gaps.push([sAt - half, sAt + half]);
  }
  gaps.sort((a, b) => a[0] - b[0]);
  const keep: [number, number][] = [];
  let s0 = 0;
  for (const [g0, g1] of gaps) { if (g0 > s0) keep.push([s0, g0]); s0 = Math.max(s0, g1); }
  if (s0 < total) keep.push([s0, total]);
  return keep.map(([a, b]) => [at(a), ...pts.filter((_, i) => cum[i]! > a && cum[i]! < b), at(b)]);
}

// ── The piece ──────────────────────────────────────────────────────────────────────────────────────────────────────
// x runs east (screen right), z south (toward the eye); the coast is the south edge. The polygons run past the frame on
// the north, west and east, so each panel is a window on the map rather than a tile of it.
const T1 = { x: -12, z: -3 }, T2 = { x: -10, z: 15.5 };
const AB: P[] = [{ x: -28, z: -80 }, { x: -26, z: -60 }, { x: -24, z: -38 }, { x: -17, z: -26 }, { x: -19, z: -12 }, T1];
const AC: P[] = [T1, { x: -16, z: 6 }, T2];
const BC: P[] = [T1, { x: 2, z: -6 }, { x: 16, z: -2 }, { x: 30, z: -7 }, { x: 46, z: -4 }, { x: 70, z: -8 }, { x: 95, z: -6 }];
const OA: P[] = [{ x: -95, z: 15 }, { x: -55, z: 16.5 }, { x: -38, z: 13 }, { x: -24, z: 17 }, T2];
const OC: P[] = [T2, { x: 6, z: 17.5 }, { x: 20, z: 14.5 }, { x: 34, z: 16 }, { x: 50, z: 13.5 }, { x: 70, z: 15.5 }, { x: 95, z: 14 }];
const COAST: P[] = [{ x: -95, z: 27 }, { x: -58, z: 29.5 }, { x: -40, z: 27.5 }, { x: -20, z: 30 }, { x: 0, z: 28 }, { x: 18, z: 30.5 }, { x: 36, z: 28 }, { x: 56, z: 30 }, { x: 75, z: 28.5 }, { x: 95, z: 29 }];
const rev = (a: P[]) => [...a].reverse();
const REGIONS: { id: Region; poly: P[]; colour: RGB }[] = [
  { id: "A", colour: COL.healthy, poly: [{ x: -95, z: -80 }, ...AB, ...AC.slice(1), ...rev(OA).slice(1)] },
  { id: "B", colour: COL.healthy, poly: [...AB, ...BC.slice(1), { x: 95, z: -80 }] },
  { id: "C", colour: COL.untested, poly: [...BC, ...rev(OC), ...rev(AC).slice(1, -1)] },
  { id: "open", colour: COL.open, poly: [...OA, ...OC.slice(1), ...rev(COAST)] },
];
const BORDERS: { name: string; pts: P[]; pair: [Region, Region] }[] = [
  { name: "AB", pts: AB, pair: ["A", "B"] }, { name: "AC", pts: AC, pair: ["A", "C"] }, { name: "BC", pts: BC, pair: ["B", "C"] },
  { name: "OA", pts: OA, pair: ["A", "open"] }, { name: "OC", pts: OC, pair: ["C", "open"] },
];
const regionAt = (p: P): Region | undefined => REGIONS.find(r => inPolygon(p, r.poly))?.id;

const TOWN: P = { x: 20, z: 6 };
const ROADS: P[][] = [
  smooth([{ x: -80, z: -23 }, { x: -58, z: -17 }, { x: -38, z: -21 }, { x: -26, z: -19.5 }, { x: -10, z: -17 }, { x: 2, z: -13 }, { x: 9, z: -6.5 }, { x: 14, z: 0 }, TOWN]),
  smooth([TOWN, { x: 22.5, z: 11 }, { x: 25, z: 17.5 }, { x: 30, z: 21.5 }, { x: 44, z: 22.3 }, { x: 62, z: 21 }, { x: 90, z: 22 }]),
];
type Gate = { name: string; at: P; along: P; border: string; pair: [Region, Region] };
/** A gate wherever a road crosses a border, as overlay.ts finds them. */
const GATES: Gate[] = (() => {
  const out: Gate[] = [];
  for (const road of ROADS) for (let i = 0; i + 1 < road.length; i++) for (const b of BORDERS) for (let j = 0; j + 1 < b.pts.length; j++) {
    const x = segCross(road[i]!, road[i + 1]!, b.pts[j]!, b.pts[j + 1]!);
    if (x && !out.some(g => dist(g.at, x) < 0.5)) out.push({ name: "", at: x, along: norm(sub(b.pts[j + 1]!, b.pts[j]!)), border: b.name, pair: b.pair });
  }
  const names: Record<string, string> = { AB: "G1", BC: "G2", OC: "G3" };
  for (const g of out) g.name = names[g.border] ?? g.border;
  return out;
})();
const gate = (name: string) => GATES.find(g => g.name === name)!;

// ── The ways of drawing it ─────────────────────────────────────────────────────────────────────────────────────────
export type Variant = {
  key: string;
  /** Each region's height above the plate's top (the open land). */
  heights?: Partial<Record<Region, number>>;
  /** A ramp cut into the higher side at these gates. */
  ramps?: string[];
  rims?: boolean;
  standing?: boolean;
  lintel?: boolean;
  /** Overrides of LOOK for this panel. */
  rim?: Partial<typeof LOOK.rim>;
  post?: Partial<typeof LOOK.standing>;
};
/** The sizes each look uses, which the captions quote. */
export const LOOK = {
  /** A rim's width, its strongest white and black (scaled by the square root of how squarely its edge faces toward or away
   * from the light), and how much of its width holds that before it fades inward. */
  rim: { width: 0.9, light: 0.45, dark: 0.36, hold: 0.45 },
  wall: 0.92,
  shadow: { alpha: 0.3, feather: 0.8 },
  ramp: { width: SIZE.opening, depth: 2.6 },
  /** A standing post: footprint, height, the paper face's share of its top, its sides' colour, its shadow; and a lintel's
   * section when it carries one. */
  standing: { side: 1.2, height: 1.5, faceRatio: 0.62, body: hex("#59626a"), shadow: 0.3, feather: 0.55, lintel: 0.32 },
};
export const VARIANTS: Record<string, Variant> = {
  flat: { key: "flat" },
  bevel: { key: "bevel", rims: true },
  raised: { key: "raised", heights: { A: 1.0, B: 1.0, C: 1.0 }, ramps: ["G3"] },
  standing: { key: "standing", standing: true },
  both: { key: "both", rims: true, standing: true },
  levels: { key: "levels", heights: { A: 0.8, B: 1.6, C: 0.8 }, ramps: ["G1", "G2", "G3"] },
  // Tries, not on the sheet.
  standingPaper: { key: "standingPaper", standing: true, post: { body: hex("#f3efe4") } },
  standingLow: { key: "standingLow", standing: true, post: { height: 0.9 } },
  lintel: { key: "lintel", rims: true, standing: true, lintel: true, post: { height: 1.6 } },
  lintelPaper: { key: "lintelPaper", rims: true, standing: true, lintel: true, post: { height: 1.6, body: hex("#d9d4c6") } },
};

type Notch = { gate: Gate; E: P; along: P; inward: P; hi: Region; lo: Region; hHi: number; hLo: number };

/** Triangles gathered by layer: 0 is opaque and writes depth, the rest blend over it in order. */
class Layers {
  private layers = new Map<number, { pos: number[]; col: number[] }>();
  tri(layer: number, a: V3, b: V3, c: V3, ca: RGBA, cb: RGBA = ca, cc: RGBA = ca) {
    let l = this.layers.get(layer); if (!l) this.layers.set(layer, l = { pos: [], col: [] });
    l.pos.push(...a, ...b, ...c); l.col.push(...ca, ...cb, ...cc);
  }
  quad(layer: number, a: V3, b: V3, c: V3, d: V3, ca: RGBA, cb: RGBA = ca, cc: RGBA = cb, cd: RGBA = ca) {
    this.tri(layer, a, b, c, ca, cb, cc); this.tri(layer, a, c, d, ca, cc, cd);
  }
  meshes(): THREE.Mesh[] {
    return [...this.layers].sort((x, y) => x[0] - y[0]).map(([layer, { pos, col }]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
      const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: layer > 0, depthWrite: layer === 0, side: THREE.DoubleSide, toneMapped: false });
      const mesh = new THREE.Mesh(g, m); mesh.renderOrder = layer; return mesh;
    });
  }
}
const LAYER = { solid: 0, shadow: 1, rim: 2, coast: 3, border: 4, road: 5, post: 6, town: 7 };

export function buildScene(v: Variant, ppu: number): THREE.Scene {
  const H = (r: Region | undefined) => r === undefined ? 0 : v.heights?.[r] ?? 0;
  const colourOf = (r: Region) => REGIONS.find(x => x.id === r)!.colour;
  const out = new Layers();

  // The ramps: each cut into the higher side of its gate's border, its low end on the border.
  const notches: Notch[] = (v.ramps ?? []).map(name => {
    const g = gate(name), n = left(g.along), probe = addP(g.at, n, 0.5);
    const sideL = regionAt(probe)!, sideR = regionAt(addP(g.at, n, -0.5))!;
    const [hi, lo] = H(sideL) >= H(sideR) ? [sideL, sideR] : [sideR, sideL];
    const inward = H(sideL) >= H(sideR) ? n : { x: -n.x, z: -n.z };
    return { gate: g, E: g.at, along: g.along, inward, hi, lo, hHi: H(hi), hLo: H(lo) };
  });
  const inNotch = (p: P) => {
    for (const k of notches) {
      const d = sub(p, k.E), u = dot(d, k.along), w = dot(d, k.inward);
      if (Math.abs(u) <= LOOK.ramp.width / 2 + 1e-6 && w >= -1e-6 && w <= LOOK.ramp.depth + 1e-6) return { k, w };
    }
    return undefined;
  };
  const heightAt = (p: P) => {
    const n = inNotch(p);
    if (n) return n.k.hLo + (n.k.hHi - n.k.hLo) * Math.max(0, Math.min(1, n.w / LOOK.ramp.depth));
    return H(regionAt(p));
  };
  /** On a border: the higher of its two sides. */
  const edgeHeight = (p: P, along: P) => { const n = left(along); return Math.max(H(regionAt(addP(p, n, 0.3))), H(regionAt(addP(p, n, -0.3)))); };

  // ── Outlines, with the gates' gaps (for rims) and the ramps' notches cut in ──────────────────────────────────────
  type Outline = { pts: P[]; flag: ("gap" | "notch" | undefined)[] };
  const outlineOf = (poly: P[], self: Region): Outline => {
    let pts = [...poly], flag: Outline["flag"] = poly.map(() => undefined);
    const ccw = area(poly) > 0;
    const insert = (at: P, make: (dir: P, inward: P) => { pts: P[]; flags: Outline["flag"] }) => {
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
        if (toSegment(at, a, b) < 1e-3) {
          const dir = norm(sub(b, a)), inward = ccw ? left(dir) : { x: -left(dir).x, z: -left(dir).z };
          const m = make(dir, inward), was = flag[i];
          pts = [...pts.slice(0, i + 1), ...m.pts, ...pts.slice(i + 1)];
          flag = [...flag.slice(0, i), was, ...m.flags, was, ...flag.slice(i + 1)];
          return;
        }
      }
    };
    if (v.rims) for (const g of GATES) if (g.pair.includes(self)) insert(g.at, dir => ({
      pts: [addP(g.at, dir, -SIZE.opening / 2), addP(g.at, dir, SIZE.opening / 2)], flags: ["gap"],
    }));
    for (const k of notches) if (k.hi === self) insert(k.E, (dir, inward) => {
      const e1 = addP(k.E, dir, -LOOK.ramp.width / 2), e2 = addP(k.E, dir, LOOK.ramp.width / 2);
      return { pts: [e1, addP(e1, inward, LOOK.ramp.depth), addP(e2, inward, LOOK.ramp.depth), e2], flags: ["notch", "notch", "notch"] };
    });
    return { pts, flag };
  };

  // ── The ground: each region's top, the walls where it stands above its neighbour, and their soft shadows ─────────
  for (const r of REGIONS) {
    const h = H(r.id), o = outlineOf(r.poly, r.id), ccw = area(o.pts) > 0;
    const contour = o.pts.map(p => new THREE.Vector2(p.x, p.z));
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      const a = o.pts[i!]!, b = o.pts[j!]!, c = o.pts[k!]!;
      out.tri(LAYER.solid, [a.x, h, a.z], [b.x, h, b.z], [c.x, h, c.z], rgba(r.colour));
    }
    if (h <= 0) continue;
    // Walls and shadow runs along every edge that stands above its neighbour.
    const n = o.pts.length;
    const edges = o.pts.map((a, i) => {
      const b = o.pts[(i + 1) % n]!, dir = norm(sub(b, a)), outward = ccw ? { x: -left(dir).x, z: -left(dir).z } : left(dir);
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, nb = regionAt(addP(mid, outward, 0.3));
      return { a, b, dir, outward, low: o.flag[i] === undefined && nb !== undefined && H(nb) < h - 1e-6 ? H(nb) : undefined };
    });
    for (const e of edges) if (e.low !== undefined) {
      const f = shade(new THREE.Vector3(e.outward.x, 0, e.outward.z)) * LOOK.wall, c = rgba(mul(r.colour, f));
      out.quad(LAYER.solid, [e.a.x, h, e.a.z], [e.b.x, h, e.b.z], [e.b.x, e.low, e.b.z], [e.a.x, e.low, e.a.z], c);
    }
    // Shadows: each edge's quad pushed out by the shadow's reach across it, the corners shared with the next edge.
    const reach = (outward: P, dh: number) => Math.max(0, dot(outward, SHADOW)) * dh;
    edges.forEach((e, i) => {
      if (e.low === undefined) return;
      const prev = edges[(i - 1 + n) % n]!, next = edges[(i + 1) % n]!, dh = h - e.low;
      const vn = (other: typeof e) => other.low !== undefined ? norm(addP(e.outward, other.outward)) : e.outward;
      const na = vn(prev), nb = vn(next);
      const ka = Math.max(0, dot(norm(SHADOW), na)), kb = Math.max(0, dot(norm(SHADOW), nb));
      const ra = reach(na, dh), rb = reach(nb, dh), y = e.low + 0.02;
      const aCore = addP(e.a, na, ra), bCore = addP(e.b, nb, rb), aEnd = addP(aCore, na, LOOK.shadow.feather), bEnd = addP(bCore, nb, LOOK.shadow.feather);
      const A = LOOK.shadow.alpha, black = COL.black;
      out.quad(LAYER.shadow, [e.a.x, y, e.a.z], [e.b.x, y, e.b.z], [bCore.x, y, bCore.z], [aCore.x, y, aCore.z], rgba(black, A * ka), rgba(black, A * kb), rgba(black, A * kb * 0.85), rgba(black, A * ka * 0.85));
      out.quad(LAYER.shadow, [aCore.x, y, aCore.z], [bCore.x, y, bCore.z], [bEnd.x, y, bEnd.z], [aEnd.x, y, aEnd.z], rgba(black, A * ka * 0.85), rgba(black, A * kb * 0.85), rgba(black, 0), rgba(black, 0));
    });
  }
  // The ramps and the notch's two cheeks.
  for (const k of notches) {
    const c = colourOf(k.hi);
    const e1 = addP(k.E, k.along, -LOOK.ramp.width / 2), e2 = addP(k.E, k.along, LOOK.ramp.width / 2);
    const i1 = addP(e1, k.inward, LOOK.ramp.depth), i2 = addP(e2, k.inward, LOOK.ramp.depth);
    const slope = new THREE.Vector3(-k.inward.x * (k.hHi - k.hLo), LOOK.ramp.depth, -k.inward.z * (k.hHi - k.hLo)).normalize();
    out.quad(LAYER.solid, [e1.x, k.hLo, e1.z], [e2.x, k.hLo, e2.z], [i2.x, k.hHi, i2.z], [i1.x, k.hHi, i1.z], rgba(mul(c, shade(slope))));
    for (const [e, i, s] of [[e1, i1, 1], [e2, i2, -1]] as const) {
      const nrm = new THREE.Vector3(k.along.x * s, 0, k.along.z * s), cc = rgba(mul(c, shade(nrm) * LOOK.wall));
      out.tri(LAYER.solid, [e.x, k.hHi, e.z], [e.x, k.hLo, e.z], [i.x, k.hHi, i.z], cc);
    }
  }

  // ── Bevel rims: a thin band inside each territory's edge, light where the edge faces the light, dark where it faces
  //    away, fading inward; it stops at each gate's opening ─────────────────────────────────────────────────────────
  if (v.rims) for (const r of REGIONS) {
    if (r.id === "open") continue;
    const R = { ...LOOK.rim, ...v.rim };
    const h = H(r.id) + 0.03, o = outlineOf(r.poly, r.id), n = o.pts.length, ccw = area(o.pts) > 0, w = R.width;
    const inwardOf = (i: number) => { const a = o.pts[i]!, b = o.pts[(i + 1) % n]!, d = norm(sub(b, a)); return ccw ? left(d) : { x: -left(d).x, z: -left(d).z }; };
    const offset = (k: number) => o.pts.map((p, i) => {
      const n0 = inwardOf((i - 1 + n) % n), n1 = inwardOf(i), m = norm(addP(n0, n1)), c = Math.max(0.35, dot(m, n1));
      return addP(p, m, w * k / c);
    });
    const mid = offset(R.hold), inner = offset(1);
    for (let i = 0; i < n; i++) {
      if (o.flag[i]) continue;
      const a = o.pts[i]!, b = o.pts[(i + 1) % n]!, ma = mid[i]!, mb = mid[(i + 1) % n]!, ia = inner[i]!, ib = inner[(i + 1) % n]!;
      const inward = inwardOf(i), s = dot({ x: -inward.x, z: -inward.z }, LH);
      const e = Math.sqrt(Math.abs(s)), [c, alpha] = s > 0 ? [COL.white, R.light * e] : [COL.black, R.dark * e];
      out.quad(LAYER.rim, [a.x, h, a.z], [b.x, h, b.z], [mb.x, h, mb.z], [ma.x, h, ma.z], rgba(c, alpha), rgba(c, alpha), rgba(c, alpha * 0.85), rgba(c, alpha * 0.85));
      out.quad(LAYER.rim, [ma.x, h, ma.z], [mb.x, h, mb.z], [ib.x, h, ib.z], [ia.x, h, ia.z], rgba(c, alpha * 0.85), rgba(c, alpha * 0.85), rgba(c, 0), rgba(c, 0));
    }
  }

  // ── A flat ribbon, `width` across, along `pts`, at `y(p)` ─────────────────────────────────────────────────────────
  const ribbon = (layer: number, pts: P[], width: number, y: (p: P, along: P) => number, c: RGBA) => {
    const side = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!, d = norm(sub(b, a));
      return { l: addP(p, left(d), width / 2), r: addP(p, left(d), -width / 2), y: y(p, d) };
    });
    for (let i = 0; i + 1 < side.length; i++) {
      const s0 = side[i]!, s1 = side[i + 1]!;
      out.quad(layer, [s0.l.x, s0.y, s0.l.z], [s1.l.x, s1.y, s1.l.z], [s1.r.x, s1.y, s1.r.z], [s0.r.x, s0.y, s0.r.z], c);
    }
  };
  const px = 1 / ppu;

  // ── The coast: the plate's side falling to the sea, a light band on its top edge and the white coast line ─────────
  const wallBase = mul(COL.wallSouth, 1 / shade(new THREE.Vector3(0, 0, 1)));
  for (let i = 0; i + 1 < COAST.length; i++) {
    const a = COAST[i]!, b = COAST[i + 1]!, d = norm(sub(b, a)), outward = left(d); // land is north of the coast
    const o = outward.z > 0 ? outward : { x: -outward.x, z: -outward.z };
    const c = rgba(mul(wallBase, shade(new THREE.Vector3(o.x, 0, o.z))));
    out.quad(LAYER.solid, [a.x, 0, a.z], [b.x, 0, b.z], [b.x, -10, b.z], [a.x, -10, a.z], c);
  }
  const coastBand = resample(COAST, 0.5);
  ribbon(LAYER.coast, coastBand.map(p => ({ x: p.x, z: p.z - 0.3 })), 0.6, () => 0.02, rgba(mix(COL.open, COL.white, 0.17)));
  ribbon(LAYER.coast, coastBand, 1.1 * px, () => 0.04, rgba(COL.border, 0.85));

  // ── Borders: 1 px white lines at 85%, each gate's opening cut out of them ─────────────────────────────────────────
  for (const b of BORDERS) {
    const holes = GATES.filter(g => g.border === b.name).map(g => g.at);
    for (const piece of cut(resample(b.pts, 0.5), holes, SIZE.opening / 2)) ribbon(LAYER.border, piece, 1.1 * px, (p, d) => edgeHeight(p, d) + 0.05, rgba(COL.border, 0.85));
  }

  // ── The quiet road: 0.6 wide, #efe8d6 laid 55% over the land under it, no casing ───────────────────────────────────
  for (const road of ROADS) ribbon(LAYER.road, road, SIZE.road, p => heightAt(p) + 0.07, rgba(COL.road, 0.55));

  // ── The gates' posts ──────────────────────────────────────────────────────────────────────────────────────────────
  const square = (layer: number, c: P, along: P, side: number, y: number, col: RGBA) => {
    const a = along, n = left(along), h = side / 2;
    const k = (s: number, t: number): V3 => [c.x + a.x * h * s + n.x * h * t, y, c.z + a.z * h * s + n.z * h * t];
    out.quad(layer, k(-1, -1), k(1, -1), k(1, 1), k(-1, 1), col);
  };
  const S = { ...LOOK.standing, ...v.post };
  /** A box from `base` to `top` over the footprint `k(+-1, +-1)`, its sides shaded by the light. */
  const box = (k: (s: number, t: number) => P, base: number, top: number, body: RGB) => {
    const faces: [P, P][] = [[k(-1, -1), k(1, -1)], [k(1, -1), k(1, 1)], [k(1, 1), k(-1, 1)], [k(-1, 1), k(-1, -1)]];
    const c = k(0, 0);
    for (const [p, q] of faces) {
      const nn = norm({ x: (p.x + q.x) / 2 - c.x, z: (p.z + q.z) / 2 - c.z });
      out.quad(LAYER.solid, [p.x, base, p.z], [q.x, base, q.z], [q.x, top, q.z], [p.x, top, p.z], rgba(mul(body, shade(new THREE.Vector3(nn.x, 0, nn.z)))));
    }
  };
  for (const g of GATES) for (const side of [-1, 1]) {
    // At a ramp the posts stand on its high side, flanking its foot.
    const ramp = notches.find(k => k.gate === g), seat = (c: P, size: number) => ramp ? addP(c, ramp.inward, size / 2 + 0.1) : c;
    if (v.standing) {
      const c = seat(addP(g.at, g.along, (SIZE.opening / 2 + S.side / 2) * side), S.side), base = edgeHeight(c, g.along);
      // Its soft shadow: the footprint swept away from the light, feathered.
      const a = g.along, n = left(a), hs = S.side / 2;
      const foot = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => ({ x: c.x + a.x * hs * s! + n.x * hs * t!, z: c.z + a.z * hs * s! + n.z * hs * t! }));
      const hull = convexHull([...foot, ...foot.map(p => addP(p, SHADOW, S.height))]);
      softPolygon(out, LAYER.shadow, hull, base + 0.02, S.shadow, S.feather);
      // The block: a paper face on an ink-edged top, two shaded sides showing.
      const top = base + S.height, k = (s: number, t: number) => ({ x: c.x + a.x * hs * s + n.x * hs * t, z: c.z + a.z * hs * s + n.z * hs * t });
      box(k, base, top, S.body);
      square(LAYER.solid, c, a, S.side, top, rgba(COL.post));
      square(LAYER.post, c, a, S.side * S.faceRatio, top + 0.02, rgba(COL.paper));
    } else {
      const c = seat(addP(g.at, g.along, (SIZE.opening / 2 + SIZE.post / 2) * side), SIZE.post), y = edgeHeight(c, g.along);
      square(LAYER.post, c, g.along, SIZE.post, y + 0.12, rgba(COL.post));
      square(LAYER.post, c, g.along, SIZE.face, y + 0.14, rgba(COL.paper));
    }
  }
  // A lintel: a thin bar across the opening between the two posts' tops, a little below them, with its own soft shadow.
  if (v.standing && v.lintel) for (const g of GATES) {
    const a = g.along, n = left(a), t = S.lintel / 2, reach = SIZE.opening / 2 + S.side * 0.5, base = edgeHeight(g.at, a);
    const top = base + S.height - 0.15, bottom = top - S.lintel * 0.8;
    const k = (s: number, u: number) => ({ x: g.at.x + a.x * reach * s + n.x * t * u, z: g.at.z + a.z * reach * s + n.z * t * u });
    box(k, bottom, top, S.body);
    const kk = [k(-1, -1), k(1, -1), k(1, 1), k(-1, 1)];
    out.quad(LAYER.solid, [kk[0]!.x, top, kk[0]!.z], [kk[1]!.x, top, kk[1]!.z], [kk[2]!.x, top, kk[2]!.z], [kk[3]!.x, top, kk[3]!.z], rgba(COL.paper));
    const lift = { x: SHADOW.x * ((top + bottom) / 2 - base), z: SHADOW.z * ((top + bottom) / 2 - base) };
    softPolygon(out, LAYER.shadow, convexHull(kk.map(p => addP(p, lift))), base + 0.02, S.shadow * 0.7, S.feather);
  }

  // ── The settlement where the two roads meet: a paper disc ringed in ink (1-2 roads) ───────────────────────────────
  const disc = (p: P, r: number, y: number, c: RGBA) => {
    const n = 28;
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
      out.tri(LAYER.town, [p.x, y, p.z], [p.x + Math.cos(a0) * r, y, p.z + Math.sin(a0) * r], [p.x + Math.cos(a1) * r, y, p.z + Math.sin(a1) * r], c);
    }
  };
  const ty = heightAt(TOWN);
  disc(TOWN, SIZE.town + SIZE.casing * 0.6, ty + 0.1, rgba(COL.casing, 0.88));
  disc(TOWN, SIZE.town, ty + 0.12, rgba(COL.townInk));
  disc(TOWN, SIZE.town - SIZE.townRing, ty + 0.14, rgba(COL.paper));

  const scene = new THREE.Scene();
  for (const m of out.meshes()) scene.add(m);
  return scene;
}

function convexHull(points: P[]): P[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: P[] = [], upper: P[] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
/** A convex shadow: its core at `alpha`, feathered to nothing over `feather` round its edge. */
function softPolygon(out: Layers, layer: number, hull: P[], y: number, alpha: number, feather: number) {
  const n = hull.length, ccw = area(hull) > 0, c = hull.reduce((s, p) => ({ x: s.x + p.x / n, z: s.z + p.z / n }), { x: 0, z: 0 });
  const outwardOf = (i: number) => { const d = norm(sub(hull[(i + 1) % n]!, hull[i]!)); return ccw ? { x: d.z, z: -d.x } : { x: -d.z, z: d.x }; };
  const off = hull.map((_, i) => { const m = norm(addP(outwardOf((i - 1 + n) % n), outwardOf(i))); return m; });
  const inner = hull.map((p, i) => addP(p, off[i]!, -feather / 2)), outer = hull.map((p, i) => addP(p, off[i]!, feather / 2));
  const k = rgba(COL.black, alpha), z = rgba(COL.black, 0);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    out.tri(layer, [c.x, y, c.z], [inner[i]!.x, y, inner[i]!.z], [inner[j]!.x, y, inner[j]!.z], k);
    out.quad(layer, [inner[i]!.x, y, inner[i]!.z], [inner[j]!.x, y, inner[j]!.z], [outer[j]!.x, y, outer[j]!.z], [outer[i]!.x, y, outer[i]!.z], k, k, z, z);
  }
}

// ── The page: one renderer, each panel drawn at twice its size and laid into its own canvas ──────────────────────────
const TILT = 40 * Math.PI / 180;     // the map's resting tilt off straight down (SHEET_TILT)
const MAP_PPU = 2.6, MAP_D = 549;    // the map at rest: 2.6 px per ground unit, its eye about 549 units off (fov 35, 900 px)
const SS = 2;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.setClearColor(COL.sea, 1);

export function draw(canvas: HTMLCanvasElement, v: Variant, zoom: number, target: P) {
  const w = canvas.width, h = canvas.height, ppu = MAP_PPU * zoom, d = MAP_D / zoom;
  const scene = buildScene(v, ppu);
  const fov = 2 * Math.atan((h / 2) / (d * ppu)) * 180 / Math.PI;
  const camera = new THREE.PerspectiveCamera(fov, w / h, d - 150, d + 150);
  camera.position.set(target.x, d * Math.cos(TILT), target.z + d * Math.sin(TILT));
  camera.lookAt(target.x, 0, target.z);
  renderer.setPixelRatio(1);
  renderer.setSize(w * SS, h * SS, false);
  renderer.render(scene, camera);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(renderer.domElement, 0, 0, w * SS, h * SS, 0, 0, w, h);
  scene.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
}

const PIECE_CENTRE: P = { x: 0, z: 5 };
for (const el of document.querySelectorAll<HTMLCanvasElement>("canvas[data-look]")) {
  const v = VARIANTS[el.dataset.look!]!, zoom = Number(el.dataset.zoom ?? "1.5");
  const at = el.dataset.at ? (() => { const g = gate(el.dataset.at!); return { x: g.at.x + 3, z: g.at.z + 1 }; })() : PIECE_CENTRE;
  draw(el, v, zoom, at);
}
(window as unknown as { relief: unknown }).relief = { gates: GATES.map(g => ({ name: g.name, at: g.at, along: g.along })), LOOK };
document.body.dataset.state = "ready";
