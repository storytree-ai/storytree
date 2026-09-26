// Deterministic cost-grid trail router (ADR-0169 §1). Every story edge routes
// over ONE shared scalar cost field on a coarse world grid: island discs
// hard-blocked (inflated by a clearance margin), a soft falloff ring beyond it,
// seeded value noise, a turn penalty — searched by 8-connected A* with stable
// tie-breaking (f, then g, then cell index). Edges route in canonical
// longest-chord-first order; after each route the traversed cells earn a reuse
// discount so later routes snap onto existing trails and trunks EMERGE, the way
// footpaths form in a field. An edge that cannot route with islands blocked
// re-routes with interiors passable at high cost — the under-island runs come
// out hidden, with cave portals emitted at the rim crossings. The output is a
// shared-SEGMENT network (a trunk is one segment rendered once; each edge keeps
// its ordered chain of segment refs) smoothed to centripetal Catmull-Rom
// cubics. A pure function of (islands, edges, seed): hash/rand01 only, no
// Math.random, no clock — same input, byte-identical output.
//
// THE ROUTER ITSELF STAYS CAMERA-AGNOSTIC (ADR-0367 D1/D3). Every distance it reasons about —
// clearance, falloff, the reuse halo, an island's obstacle radius — is an ISOTROPIC screen
// distance, which is only true in the ground plane: a ground-plane circle seen through the land's
// declared camera is an ELLIPSE, and treating it as a circle is exactly what forces edges that
// could route around an island to give up and tunnel under it instead (the measured 0 -> 156
// `world-cave` delta, `land-camera-consumers-reconcile`). Rather than teach every isotropic
// distance in this module about an anisotropic screen projection, the CALLER routes with
// GROUND-SPACE islands (see `TrailIsland`'s doc) and calls {@link projectTrailNetwork} once, at
// the end, to project the routed geometry into screen space. Centripetal Catmull-Rom is affine in
// its control points, so projecting the points and re-splining reproduces exactly the curve that
// splining the already-projected points would have drawn.

import type { Pt } from './hex.js';
import { HEX_R } from './hex.js';
import { hash, rand01 } from './rng.js';
import { LAND_CAMERA_ELEVATION_DEG, projectGround } from './camera.js';

export interface TrailIsland {
  id: string;
  /** GROUND-plane px — isotropic, unprojected (the router is camera-agnostic; see the module
   *  doc). Pass `unprojectGround`/plan-view coordinates here, not screen coordinates, and
   *  recover screen space from the result via {@link projectTrailNetwork}. */
  x: number;
  y: number;
  r: number; // obstacle disc radius, in the same ground-plane units as x/y
}

export interface TrailEdgeIn {
  from: string;
  to: string;
  title?: string;
}

export interface TrailTuning {
  cellSize: number; // grid cell in world px
  clearance: number; // hard inflation margin beyond island r
  falloff: number; // soft-penalty band beyond clearance
  falloffCost: number; // peak soft penalty at the clearance boundary
  noiseAmp: number; // cost-noise amplitude
  turnPenalty: number; // per-direction-change cost
  reuseDiscount: number; // multiplier applied to routed cells
  discountFloor: number; // min cell cost after discounts
  reuseHaloRadius: number; // Chebyshev ring count of the reuse-halo around a laid trail
  reuseHaloInner: number; // cost FRAC at ring 1 (0 = full trunk discount, 1 = base cost, >1 = MOAT/penalty)
  reuseHaloOuter: number; // cost FRAC at the outermost ring (linear-interpolated from Inner)
  dockMergeGap: number; // max angular GAP (rad) between adjacent approaches kept in one shared dock
  dockMergeSpan: number; // max total angular SPAN (rad) of a shared-dock cluster (anti-chaining cap)
  reclusterOnApproach: boolean; // second pass: re-cluster docks by the ACTUAL routed approach bearing
  // (not the straight chord) so edges that FUNNEL together via the reuse trunk share one dock instead
  // of forking into a Y at the rim, while genuinely opposite-side edges still keep their own dock
  approachProbe: number; // how far past the rim (world px) to read the pass-1 approach bearing
  interiorCost: number; // island-interior cost for the cave fallback pass
  meanderAmp: number; // perpendicular displacement amplitude (MUST stay < clearance)
  meanderWavelength: number; // arc-length period of the meander noise
  meanderTaper: number; // arc-length band near each junction/dock end over which meander ramps 0→full
  meanderClearInner: number; // ≤ this distance from ANOTHER trail, meander is fully suppressed
  meanderClearOuter: number; // ≥ this distance from another trail, meander is at full amplitude
  junctionWeld: number; // weld JUNCTION nodes within this distance into one (kills the ~1-cell merge stub)
}

export interface TrailSegment {
  id: string; // stable content-derived id (hash of its cell run, collision-extended)
  d: string; // SVG path, M + cubic C segments, r2-rounded coords
  points: readonly { x: number; y: number }[]; // the smoothed polyline d was built from
  usage: number; // distinct edges routed through this segment
  hidden: boolean; // true = under-island ghost run
}

export interface TrailCave {
  islandId: string;
  x: number; // portal point on the island rim
  y: number;
  bearing: number; // radians, outward normal from island centre
  width: number; // trail fill width at the portal (from the usage rule)
  edgeIds: string[]; // "from->to" keys passing through this portal
}

export interface TrailEdgeOut {
  from: string;
  to: string;
  title?: string;
  segments: readonly { id: string; reversed: boolean }[]; // ordered chain from -> to
}

export interface TrailNetwork {
  segments: TrailSegment[];
  edges: TrailEdgeOut[];
  caves: TrailCave[];
  /** Edges that could not be routed — unknown endpoint island (a filtered-out
   *  fold) or an unroutable grid. The §5 honesty signal: an edge this network
   *  does not draw is at least observable. Self-edges and exact duplicates are
   *  not drops (nothing distinct to draw). Sorted by from, then to; deduped. */
  dropped: { from: string; to: string }[];
}

/**
 * The ONE width rule every surface shares: fill width from segment usage.
 * Owner feedback 2026-07-07: thinner overall so WIDTH ALONE reads the merge —
 * only `.trail-fill` renders (casing/shadow are `display:none`), so this IS the
 * visible width. A usage-1 spur is a thin 3.0 line; each extra edge sharing a
 * trunk steps it up (usage-4 = 4.8, a clearly thicker road) — a legible
 * thin→thick usage ladder, no other cue needed.
 */
export function trailFillWidth(usage: number): number {
  return 1.2 + 1.8 * Math.sqrt(Math.max(0, usage));
}

function resolveTuning(o?: Partial<TrailTuning>): TrailTuning {
  const clearance = o?.clearance ?? 0.6 * HEX_R;
  return {
    cellSize: o?.cellSize ?? HEX_R / 2,
    clearance,
    falloff: o?.falloff ?? 2.5 * HEX_R,
    falloffCost: o?.falloffCost ?? 6,
    // Owner feedback 2026-07-06: the map read as winding + side-by-side parallel
    // trails. A SMOOTHER field (lower noise) + a STRONGER, WIDER reuse pull make
    // near-parallel routes snap onto ONE shared trunk instead of running a cell
    // apart, and a firmer turn penalty keeps the minimalist line from zigzagging.
    noiseAmp: o?.noiseAmp ?? 0.15,
    turnPenalty: o?.turnPenalty ?? 0.5,
    // a much cheaper trunk (0.22 vs the old 0.4) is a stronger attractor, so a later
    // route prefers merging onto an existing trail over laying a parallel lane; the
    // deep floor (0.05) lets a HIGH-usage trunk compound into a very strong magnet.
    reuseDiscount: o?.reuseDiscount ?? 0.22,
    discountFloor: o?.discountFloor ?? 0.05,
    // reuse halo as a MOAT (owner feedback item 4, 2026-07-07, re-tuned against the
    // stress placement default): the owner still saw side-by-side lanes a cell apart.
    // A cheaper adjacent ring only made those lanes MORE comfortable, so instead the
    // ring immediately beside a laid trail is now a slight MOAT (frac > 1 ⇒ cost ABOVE
    // base) — there is no free parallel lane, so a nearby route must either join the
    // trunk's exact (cheap) cells or stay well clear. A moat only RAISES cost, never
    // blocks, so it can never force a cave. Cut side-by-side trail length ~48% on the
    // real graph (0.19 → 0.10) with the trunk-merge behaviour intact.
    reuseHaloRadius: o?.reuseHaloRadius ?? 2,
    reuseHaloInner: o?.reuseHaloInner ?? 1.2,
    reuseHaloOuter: o?.reuseHaloOuter ?? 1.0,
    // shared docks (owner feedback item 1, 2026-07-07): several edges converging on
    // one island from nearly the same direction snap to ONE dock bearing so they
    // dock as a single thicker trunk, not separate approach lines fanning at the rim.
    // `dockMergeGap` (60°) groups adjacent approaches; `dockMergeSpan` caps a cluster's
    // total angular spread so opposite-side approaches keep their own dock (no forced
    // detour).
    // Owner feedback 2026-07-08 ("pathways split unnecessarily when joining together"):
    // the 90° cap was UNNECESSARILY splitting moderate fans — a 6-edge fan spanning ~100°
    // to one island was cut into two docks, and that split boundary rendered as a Y-fork
    // right at the rim. Widened to 100° (a ~50° half-angle from the shared bearing — the
    // widest an edge bends toward the shared dock before the approach reads as a detour).
    // A general rule, not per-map tuning: fans up to ~100° dock as one trunk; genuinely
    // wide fans (>100°) still keep multiple docks, so the reuse funnel — not a rim-wrap —
    // carries them. Halved the Y-fork pairs on the real 28-story stress graph (40 → 25),
    // no new rim-wraps, caves/drops unchanged.
    dockMergeGap: o?.dockMergeGap ?? Math.PI / 3,
    dockMergeSpan: o?.dockMergeSpan ?? (5 * Math.PI) / 9,
    reclusterOnApproach: o?.reclusterOnApproach ?? true,
    // read the approach ~4 cells past the clearance band: far enough that near-parallel edges
    // have funnelled onto their shared trunk (so their approach bearings coincide and the dock
    // merges), but not so far that the reading runs past a downstream bend and mis-clusters a
    // genuinely-separate edge (measured: <50px misses the merge, >90px starts splitting docks).
    approachProbe: o?.approachProbe ?? clearance + 4 * (o?.cellSize ?? HEX_R / 2),
    interiorCost: o?.interiorCost ?? 40,
    // derived from the RESOLVED clearance so the amp<clearance invariant holds
    // under a clearance override too; an EXPLICIT amp is clamped below clearance
    // for the same reason — meander must never be able to push a path into an
    // island, whatever the caller asks for. Amplitude HALVED (0.45→0.22·clearance)
    // to quiet the gratuitous winding the owner flagged.
    meanderAmp: Math.min(o?.meanderAmp ?? 0.22 * clearance, 0.95 * clearance),
    meanderWavelength: o?.meanderWavelength ?? 4 * HEX_R,
    // owner feedback 2026-07-08: keep the organic wander on OPEN solo stretches but turn it
    // OFF at junctions and wherever a trail runs close to another — that is where a wander
    // reads as an "unnecessary split". The taper straightens each segment's ends (its ends
    // ARE junction/dock nodes), so short segments — which mostly sit at junctions — get little
    // or no meander, while long open runs keep the full wave. The clear-band suppresses the
    // wander near any other pathway so two trails never wobble into looking like they fork.
    meanderTaper: o?.meanderTaper ?? 4 * HEX_R,
    meanderClearInner: o?.meanderClearInner ?? clearance,
    meanderClearOuter: o?.meanderClearOuter ?? clearance + 2 * (o?.cellSize ?? HEX_R / 2),
    // owner feedback 2026-07-08: where several trunks converge they can touch at ADJACENT grid
    // cells rather than one shared cell, leaving a ~1-cell stub between two junctions that reads
    // as a hook. Weld junction nodes (degree ≥ 3) closer than ~1.4 cells into one shared point.
    junctionWeld: o?.junctionWeld ?? 1.4 * (o?.cellSize ?? HEX_R / 2),
  };
}

// ---------- cost grid ----------

interface Grid {
  ox: number;
  oy: number;
  cs: number;
  cols: number;
  rows: number;
  cost: Float64Array; // soft cost (base + falloff + noise); the reuse discount mutates it
  blockA: Int32Array; // nearest hard-blocking island index (within r + clearance), -1 = none
  blockB: Int32Array; // second-nearest hard-blocking island index
  blockC: Int32Array; // third-nearest — endpoint masking needs THREE: an edge's own two
  // islands can consume two slots in a pinch, so any foreign blocker must still hold one
  interior: Int32Array; // island index whose r covers the cell centre, -1 = none
}

// Hard blocking is carried as island INDICES (blockA/B/C), not Infinity in the
// cost array: the per-edge endpoint mask and the cave fallback both re-interpret
// the same field per edge without a rebuild, and the reuse discount stays finite.
function buildGrid(islands: readonly TrailIsland[], seed: string, t: TrailTuning): Grid {
  const margin = t.clearance + t.falloff + 2 * t.cellSize;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const isl of islands) {
    minX = Math.min(minX, isl.x - isl.r);
    minY = Math.min(minY, isl.y - isl.r);
    maxX = Math.max(maxX, isl.x + isl.r);
    maxY = Math.max(maxY, isl.y + isl.r);
  }
  const ox = minX - margin;
  const oy = minY - margin;
  const cols = Math.max(1, Math.ceil((maxX + margin - ox) / t.cellSize));
  const rows = Math.max(1, Math.ceil((maxY + margin - oy) / t.cellSize));
  const n = cols * rows;
  const cost = new Float64Array(n);
  const blockA = new Int32Array(n).fill(-1);
  const blockB = new Int32Array(n).fill(-1);
  const blockC = new Int32Array(n).fill(-1);
  const interior = new Int32Array(n).fill(-1);
  for (let iy = 0; iy < rows; iy++) {
    const cy = oy + (iy + 0.5) * t.cellSize;
    for (let ix = 0; ix < cols; ix++) {
      const idx = iy * cols + ix;
      const cx = ox + (ix + 0.5) * t.cellSize;
      let surplusMin = Infinity; // distance beyond the nearest inflated rim
      let bA = -1;
      let bAd = Infinity;
      let bB = -1;
      let bBd = Infinity;
      let bC = -1;
      let bCd = Infinity;
      let intIdx = -1;
      let intD = Infinity;
      for (let k = 0; k < islands.length; k++) {
        const isl = islands[k];
        if (!isl) continue;
        const rim = Math.hypot(cx - isl.x, cy - isl.y) - isl.r;
        surplusMin = Math.min(surplusMin, rim - t.clearance);
        if (rim <= t.clearance) {
          if (rim < bAd) {
            bC = bB;
            bCd = bBd;
            bB = bA;
            bBd = bAd;
            bA = k;
            bAd = rim;
          } else if (rim < bBd) {
            bC = bB;
            bCd = bBd;
            bB = k;
            bBd = rim;
          } else if (rim < bCd) {
            bC = k;
            bCd = rim;
          }
        }
        if (rim < 0 && rim < intD) {
          intIdx = k;
          intD = rim;
        }
      }
      let c = 1 + t.noiseAmp * rand01(hash(`${seed}:c:${idx}`));
      if (surplusMin < t.falloff) {
        const f = 1 - Math.max(0, surplusMin) / t.falloff;
        c += t.falloffCost * f * f;
      }
      cost[idx] = c;
      blockA[idx] = bA;
      blockB[idx] = bB;
      blockC[idx] = bC;
      interior[idx] = intIdx;
    }
  }
  return { ox, oy, cs: t.cellSize, cols, rows, cost, blockA, blockB, blockC, interior };
}

/**
 * Hard-blocked for the edge whose own islands are fi/ti: any of the three
 * nearest clearance blockers is FOREIGN, or the cell is INTERIOR to an own
 * island. Own clearance rings stay open (paths must dock and leave), but own
 * interiors are cave territory like anyone else's — under an island is a cave,
 * never a surface trail (ADR-0169 §1/§2), and pass 1 must not shortcut it.
 */
function blockedFor(grid: Grid, idx: number, fi: number, ti: number): boolean {
  const a = grid.blockA[idx] ?? -1;
  const b = grid.blockB[idx] ?? -1;
  const c = grid.blockC[idx] ?? -1;
  if (
    (a !== -1 && a !== fi && a !== ti) ||
    (b !== -1 && b !== fi && b !== ti) ||
    (c !== -1 && c !== fi && c !== ti)
  ) {
    return true;
  }
  const ii = grid.interior[idx] ?? -1;
  return ii !== -1 && (ii === fi || ii === ti);
}

// ---------- A* ----------

const SQRT2 = Math.SQRT2;

const DIRS: readonly { dx: number; dy: number; len: number }[] = [
  { dx: 1, dy: 0, len: 1 },
  { dx: -1, dy: 0, len: 1 },
  { dx: 0, dy: 1, len: 1 },
  { dx: 0, dy: -1, len: 1 },
  { dx: 1, dy: 1, len: SQRT2 },
  { dx: 1, dy: -1, len: SQRT2 },
  { dx: -1, dy: 1, len: SQRT2 },
  { dx: -1, dy: -1, len: SQRT2 },
];

interface HeapEntry {
  f: number;
  g: number;
  i: number;
}

/** Stable ordering: f, then g, then cell index — the determinism anchor. */
function heapLess(a: HeapEntry, b: HeapEntry): boolean {
  if (a.f !== b.f) return a.f < b.f;
  if (a.g !== b.g) return a.g < b.g;
  return a.i < b.i;
}

function heapPush(h: HeapEntry[], e: HeapEntry): void {
  h.push(e);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    const hp = h[p]!;
    if (!heapLess(e, hp)) break;
    h[i] = hp;
    h[p] = e;
    i = p;
  }
}

function heapPop(h: HeapEntry[]): HeapEntry | undefined {
  const top = h[0];
  const last = h.pop();
  if (top === undefined || last === undefined || h.length === 0) return top;
  h[0] = last;
  let i = 0;
  for (;;) {
    const l = 2 * i + 1;
    const r = l + 1;
    let m = i;
    const hl = h[l];
    if (l < h.length && hl !== undefined && heapLess(hl, h[m]!)) m = l;
    const hr = h[r];
    if (r < h.length && hr !== undefined && heapLess(hr, h[m]!)) m = r;
    if (m === i) break;
    const tmp = h[m]!;
    h[m] = h[i]!;
    h[i] = tmp;
    i = m;
  }
  return top;
}

interface AstarState {
  g: Float64Array;
  parent: Int32Array;
  dirAt: Int8Array; // arrival direction of the best-known g (per-parent turn approximation)
  seen: Int32Array; // generation stamps — reuse the arrays across edges without clearing
  closed: Int32Array;
  gen: number;
}

function runAstar(
  grid: Grid,
  st: AstarState,
  t: TrailTuning,
  start: number,
  goal: number,
  fi: number,
  ti: number,
  cave: boolean,
): number[] | null {
  st.gen++;
  const gen = st.gen;
  const { cols, rows, cost } = grid;
  // The edge's own clearance rings are never obstacles for it (paths must
  // leave/enter them); in cave mode a blocked cell is passable at interiorCost.
  const cellCost = (idx: number): number => {
    if (!blockedFor(grid, idx, fi, ti)) return cost[idx] ?? 1;
    return cave ? t.interiorCost : Infinity;
  };
  if (cellCost(start) === Infinity || cellCost(goal) === Infinity) return null;
  if (start === goal) return [start];
  const gx = goal % cols;
  const gy = (goal / cols) | 0;
  const hScale = Math.min(1, t.discountFloor); // min possible cell cost — keeps h admissible
  const hOf = (ix: number, iy: number): number => {
    const dx = Math.abs(ix - gx);
    const dy = Math.abs(iy - gy);
    const mn = Math.min(dx, dy);
    return (Math.max(dx, dy) + (SQRT2 - 1) * mn) * hScale;
  };
  const open: HeapEntry[] = [];
  st.seen[start] = gen;
  st.closed[start] = 0;
  st.g[start] = 0;
  st.parent[start] = -1;
  st.dirAt[start] = -1;
  heapPush(open, { f: hOf(start % cols, (start / cols) | 0), g: 0, i: start });
  let found = false;
  for (;;) {
    const e = heapPop(open);
    if (e === undefined) break;
    const cur = e.i;
    if (st.closed[cur] === gen) continue;
    if (e.g !== st.g[cur]) continue; // stale entry — a better g was pushed later
    st.closed[cur] = gen;
    if (cur === goal) {
      found = true;
      break;
    }
    const cx = cur % cols;
    const cyi = (cur / cols) | 0;
    const cCur = cellCost(cur);
    const inDir = st.dirAt[cur] ?? -1;
    for (let di = 0; di < DIRS.length; di++) {
      const dd = DIRS[di]!;
      const nx = cx + dd.dx;
      const ny = cyi + dd.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (st.closed[ni] === gen) continue;
      const cNb = cellCost(ni);
      if (cNb === Infinity) continue;
      // no corner cutting: a diagonal step needs both orthogonal shoulders open
      if (dd.dx !== 0 && dd.dy !== 0) {
        if (cellCost(cyi * cols + nx) === Infinity || cellCost(ny * cols + cx) === Infinity) continue;
      }
      const turn = inDir !== -1 && inDir !== di ? t.turnPenalty : 0;
      const ng = (st.g[cur] ?? 0) + dd.len * 0.5 * (cCur + cNb) + turn;
      if (st.seen[ni] === gen && ng >= (st.g[ni] ?? Infinity)) continue;
      st.seen[ni] = gen;
      st.g[ni] = ng;
      st.parent[ni] = cur;
      st.dirAt[ni] = di;
      heapPush(open, { f: ng + hOf(nx, ny), g: ng, i: ni });
    }
  }
  if (!found) return null;
  const path: number[] = [];
  for (let cur = goal; cur !== -1; cur = st.parent[cur] ?? -1) path.push(cur);
  path.reverse();
  return path;
}

// ---------- smoothing ----------

/** r2-rounded coordinate for the `d` string (no trailing zeros, no -0). */
function r2(v: number): string {
  const n = Math.round(v * 100) / 100;
  return (n === 0 ? 0 : n).toString();
}

/** Centripetal Catmull-Rom (alpha 0.5) through the points, as M + cubic C `d`. */
export function crPathD(pts: readonly Pt[]): string {
  const first = pts[0];
  if (!first) return '';
  let d = `M ${r2(first.x)} ${r2(first.y)}`;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p0 = pts[i - 1] ?? p1;
    const p3 = pts[i + 2] ?? p2;
    const d1 = Math.sqrt(Math.hypot(p1.x - p0.x, p1.y - p0.y));
    const d2 = Math.sqrt(Math.hypot(p2.x - p1.x, p2.y - p1.y));
    const d3 = Math.sqrt(Math.hypot(p3.x - p2.x, p3.y - p2.y));
    if (d2 < 1e-9) continue; // duplicate points — nothing to draw
    let m1x: number;
    let m1y: number;
    let m2x: number;
    let m2y: number;
    if (d1 < 1e-6) {
      m1x = p2.x - p1.x;
      m1y = p2.y - p1.y;
    } else {
      m1x = d2 * ((p1.x - p0.x) / d1 - (p2.x - p0.x) / (d1 + d2) + (p2.x - p1.x) / d2);
      m1y = d2 * ((p1.y - p0.y) / d1 - (p2.y - p0.y) / (d1 + d2) + (p2.y - p1.y) / d2);
    }
    if (d3 < 1e-6) {
      m2x = p2.x - p1.x;
      m2y = p2.y - p1.y;
    } else {
      m2x = d2 * ((p2.x - p1.x) / d2 - (p3.x - p1.x) / (d2 + d3) + (p3.x - p2.x) / d3);
      m2y = d2 * ((p2.y - p1.y) / d2 - (p3.y - p1.y) / (d2 + d3) + (p3.y - p2.y) / d3);
    }
    const c1x = p1.x + m1x / 3;
    const c1y = p1.y + m1y / 3;
    const c2x = p2.x - m2x / 3;
    const c2y = p2.y - m2y / 3;
    d += ` C ${r2(c1x)} ${r2(c1y)} ${r2(c2x)} ${r2(c2y)} ${r2(p2.x)} ${r2(p2.y)}`;
  }
  return d;
}

/** A segment's pure resampled geometry (no meander): the routed cell run
 *  decimated + resampled, with cumulative arc-length and a bbox for the
 *  near-another-trail proximity prune. */
interface ResampledSeg {
  pts: Pt[];
  cum: number[]; // cumulative arc-length at each point
  total: number; // full segment length
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Collinear decimation → resample long straight spans (so the meander has
 *  vertices to bend). Pure geometry — no meander, no spline. */
function resampleSegment(rawPts: readonly Pt[], t: TrailTuning): ResampledSeg {
  // 1. drop duplicates, then exactly-collinear interior points
  const dedup: Pt[] = [];
  for (const p of rawPts) {
    const prev = dedup[dedup.length - 1];
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 1e-9) continue;
    dedup.push({ x: p.x, y: p.y });
  }
  const dec: Pt[] = [];
  for (let i = 0; i < dedup.length; i++) {
    const p = dedup[i]!;
    if (i > 0 && i < dedup.length - 1) {
      const q = dec[dec.length - 1]!;
      const nxt = dedup[i + 1]!;
      const cross = (p.x - q.x) * (nxt.y - p.y) - (p.y - q.y) * (nxt.x - p.x);
      if (Math.abs(cross) < 1e-6) continue;
    }
    dec.push(p);
  }
  // 2. resample long straight spans (decimation alone would leave no interior points)
  const step = Math.max(t.meanderWavelength / 3, t.cellSize);
  const pts: Pt[] = [{ x: dec[0]!.x, y: dec[0]!.y }];
  for (let i = 0; i + 1 < dec.length; i++) {
    const a = dec[i]!;
    const b = dec[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const nSub = Math.max(1, Math.round(len / step));
    for (let k = 1; k < nSub; k++) {
      const f = k / nSub;
      pts.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
    }
    pts.push({ x: b.x, y: b.y }); // exact endpoint — junction continuity
  }
  const cum: number[] = [0];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (i > 0) cum.push((cum[i - 1] ?? 0) + Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y));
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { pts, cum, total: cum[cum.length - 1] ?? 0, minX, minY, maxX, maxY };
}

/** Squared distance from (px,py) to the segment a→b. */
function distSqPtSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let tt = l2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
  const cx = ax + tt * dx;
  const cy = ay + tt * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

/** Nearest distance from a point to any OTHER segment's polyline, pruned by
 *  bbox so a full scan is only paid for the handful of trails actually near. */
function distToOtherTrails(px: number, py: number, others: readonly ResampledSeg[], within: number): number {
  const w2 = within * within;
  let best = Infinity;
  for (const o of others) {
    if (px < o.minX - within || px > o.maxX + within || py < o.minY - within || py > o.maxY + within) continue;
    for (let i = 0; i + 1 < o.pts.length; i++) {
      const a = o.pts[i]!;
      const b = o.pts[i + 1]!;
      const d2 = distSqPtSeg(px, py, a.x, a.y, b.x, b.y);
      if (d2 < best) best = d2;
      if (best <= w2) return Math.sqrt(best); // already inside the suppression band
    }
  }
  return best === Infinity ? Infinity : Math.sqrt(best);
}

/**
 * Seeded perpendicular meander → centripetal Catmull-Rom spline. First/last
 * points are junction nodes SHARED with neighbouring segments and are never
 * moved, so edge chains stay connected. The meander is SUPPRESSED where a
 * wander would read as a split (owner feedback 2026-07-08): fully at island
 * rims and hidden runs; ramped down over `meanderTaper` near each junction/dock
 * end; and faded out within `meanderClear*` of ANY other trail. It only reaches
 * full amplitude on open solo stretches — and its amplitude stays below the
 * clearance margin, so it can never push a trail inside an island.
 */
/** A meandered trail segment: the moved points plus the Catmull-Rom path `d` drawn through them.
 *  Named because `anti-slop/no-known-value-widening` reads an anonymous object return annotation as
 *  discarded type evidence, and inc-08's refactor panel settled the fork 3-0 toward NAMING rather
 *  than deleting: with no build step, the declaration site is the only API-surface document. */
interface MeanderedSegment {
  points: Pt[];
  d: string;
}

function meanderSpline(
  base: ResampledSeg,
  hidden: boolean,
  segId: string,
  islands: readonly TrailIsland[],
  others: readonly ResampledSeg[],
  seed: string,
  t: TrailTuning,
): MeanderedSegment {
  const pts: Pt[] = base.pts.map((p) => ({ x: p.x, y: p.y }));
  if (!hidden && pts.length > 2) {
    const s = base.cum;
    const total = base.total;
    const clearSpan = t.meanderClearOuter - t.meanderClearInner;
    for (let i = 1; i + 1 < pts.length; i++) {
      const bp = base.pts[i]!; // proximity is judged on the UN-meandered geometry (order-independent)
      let nearIsland = false;
      for (const isl of islands) {
        if (Math.hypot(bp.x - isl.x, bp.y - isl.y) < isl.r + t.clearance) {
          nearIsland = true;
          break;
        }
      }
      if (nearIsland) continue;
      // taper to 0 at the junction/dock ends; full only in the open interior
      const distEnd = Math.min(s[i] ?? 0, total - (s[i] ?? 0));
      const fEnd = t.meanderTaper > 0 ? Math.min(1, distEnd / t.meanderTaper) : 1;
      // fade out near any OTHER trail so two paths never wobble into a fake fork
      let fOther = 1;
      if (clearSpan > 0) {
        const dOther = distToOtherTrails(bp.x, bp.y, others, t.meanderClearOuter);
        fOther = dOther >= t.meanderClearOuter ? 1 : Math.max(0, (dOther - t.meanderClearInner) / clearSpan);
      }
      const scale = Math.min(fEnd, fOther);
      if (scale < 1e-3) continue;
      const ph = (s[i] ?? 0) / t.meanderWavelength;
      const k0 = Math.floor(ph);
      const f = ph - k0;
      const u = f * f * (3 - 2 * f);
      const n0 = rand01(hash(`${seed}:w:${segId}:${k0}`)) * 2 - 1;
      const n1 = rand01(hash(`${seed}:w:${segId}:${k0 + 1}`)) * 2 - 1;
      const off = t.meanderAmp * scale * (n0 + (n1 - n0) * u);
      const pa = pts[i - 1]!;
      const pb = pts[i + 1]!;
      const tx = pb.x - pa.x;
      const ty = pb.y - pa.y;
      const tl = Math.hypot(tx, ty);
      if (tl < 1e-9) continue;
      const p = pts[i]!;
      p.x += (-ty / tl) * off;
      p.y += (tx / tl) * off;
    }
  }
  return { points: pts, d: crPathD(pts) };
}

// ---------- the router ----------

interface NodeRec {
  key: string; // shared node identity — cell index or island rim point
  x: number;
  y: number;
  underOf: number; // island index whose interior this node sits UNDER (any island,
  // own included — own interiors are pass-1 blocked, so only a forced cave run
  // ever enters one), -1 = surface
}

interface RoutedEdge {
  key: string;
  from: string;
  to: string;
  title: string | undefined;
  nodes: NodeRec[];
}

// Non-printable separators/markers, so ids containing ':', '|', '->' etc. can
// never collide inside link keys or signatures.
const SEP = '\u0000';
const HIDDEN_MARK = '\u0001';
const SIG_JOIN = '\u0002';

function linkKeyOf(a: NodeRec, b: NodeRec): string {
  return a.key < b.key ? `${a.key}${SEP}${b.key}` : `${b.key}${SEP}${a.key}`;
}

/** Segment-circle crossing point (the t in [0,1] where the rim is crossed). */
function circleCrossing(a: NodeRec, b: NodeRec, isl: TrailIsland): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - isl.x;
  const fy = a.y - isl.y;
  const qa = dx * dx + dy * dy;
  const qb = 2 * (fx * dx + fy * dy);
  const qc = fx * fx + fy * fy - isl.r * isl.r;
  const disc = qb * qb - 4 * qa * qc;
  let tt = 0.5;
  if (qa > 1e-12 && disc >= 0) {
    const sq = Math.sqrt(disc);
    const t1 = (-qb - sq) / (2 * qa);
    const t2 = (-qb + sq) / (2 * qa);
    tt = t1 >= 0 && t1 <= 1 ? t1 : Math.min(1, Math.max(0, t2));
  }
  return { x: a.x + dx * tt, y: a.y + dy * tt };
}

/**
 * Route every edge over one shared cost field and emit the shared-segment trail
 * network (ADR-0169 §1). Self-edges and duplicate from->to pairs are folded
 * away (nothing distinct to draw); edges with unknown endpoints or no routable
 * path are dropped AND surfaced on `network.dropped` (§5 — never hide an edge
 * silently). The rest route in canonical order (descending chord, then
 * lexicographic key), so the result is independent of input order.
 */
export function routeTrails(
  islands: readonly TrailIsland[],
  edges: readonly TrailEdgeIn[],
  seed: string,
  tuning?: Partial<TrailTuning>,
): TrailNetwork {
  const t = resolveTuning(tuning);
  const byId = new Map<string, number>();
  islands.forEach((isl, i) => {
    if (!byId.has(isl.id)) byId.set(isl.id, i);
  });

  interface Cand {
    key: string;
    from: string;
    to: string;
    title: string | undefined;
    fi: number;
    ti: number;
    chord: number;
  }
  const cands: Cand[] = [];
  const dropped: { from: string; to: string }[] = [];
  // dedupe + sort so `dropped` is input-order independent like everything else
  const finishDropped = (): { from: string; to: string }[] => {
    const seen = new Set<string>();
    const out: { from: string; to: string }[] = [];
    for (const d of dropped) {
      const k = `${d.from}${SEP}${d.to}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(d);
    }
    out.sort((p, q) =>
      p.from !== q.from ? (p.from < q.from ? -1 : 1) : p.to < q.to ? -1 : p.to > q.to ? 1 : 0,
    );
    return out;
  };
  for (const e of edges) {
    const fi = byId.get(e.from);
    const ti = byId.get(e.to);
    if (fi === undefined || ti === undefined) {
      dropped.push({ from: e.from, to: e.to }); // unknown endpoint — observable, not silent
      continue;
    }
    if (fi === ti) continue; // self-edge: nothing to draw by design
    const a = islands[fi]!;
    const b = islands[ti]!;
    cands.push({
      // the INTERNAL key joins with the non-printable SEP so ids containing
      // '->' can never make two distinct edges collide; the display key
      // (`from->to`, on caves and scene metadata) is built where it is shown
      key: `${e.from}${SEP}${e.to}`,
      from: e.from,
      to: e.to,
      title: e.title,
      fi,
      ti,
      chord: Math.hypot(b.x - a.x, b.y - a.y),
    });
  }
  // canonical order: longest chord first, then key, then title (total order so
  // dedupe below is input-order independent)
  cands.sort((p, q) => {
    if (p.chord !== q.chord) return q.chord - p.chord;
    if (p.key !== q.key) return p.key < q.key ? -1 : 1;
    const pt = p.title ?? '';
    const qt = q.title ?? '';
    return pt < qt ? -1 : pt > qt ? 1 : 0;
  });
  const canon: Cand[] = [];
  for (const c of cands) {
    const prev = canon[canon.length - 1];
    if (prev && prev.key === c.key) continue;
    canon.push(c);
  }
  if (islands.length === 0 || canon.length === 0) {
    return { segments: [], edges: [], caves: [], dropped: finishDropped() };
  }

  let grid = buildGrid(islands, seed, t);
  const nCells = grid.cols * grid.rows;
  const st: AstarState = {
    g: new Float64Array(nCells),
    parent: new Int32Array(nCells),
    dirAt: new Int8Array(nCells),
    seen: new Int32Array(nCells),
    closed: new Int32Array(nCells),
    gen: 0,
  };
  const cellIndexAt = (x: number, y: number): number => {
    const ix = Math.min(grid.cols - 1, Math.max(0, Math.floor((x - grid.ox) / grid.cs)));
    const iy = Math.min(grid.rows - 1, Math.max(0, Math.floor((y - grid.oy) / grid.cs)));
    return iy * grid.cols + ix;
  };
  const centerOf = (idx: number): Pt => ({
    x: grid.ox + ((idx % grid.cols) + 0.5) * grid.cs,
    y: grid.oy + (((idx / grid.cols) | 0) + 0.5) * grid.cs,
  });
  // Dock just outside the rim on the preferred bearing; when a THIRD island's
  // inflated ring covers that one cell (a decor islet sitting over the dock),
  // scan alternate bearings nearest-first around the rim instead of letting
  // pass 1 abort — cave mode is for WALLED-IN edges, never a blocked doorstep
  // (ADR-0169 §1: caves only when forced).
  const dockCellAt = (isl: TrailIsland, bx: number, by: number, fi: number, ti: number): number => {
    const rad = isl.r + 0.75 * grid.cs;
    const idx0 = cellIndexAt(isl.x + bx * rad, isl.y + by * rad);
    if (!blockedFor(grid, idx0, fi, ti)) return idx0;
    const base = Math.atan2(by, bx);
    // step ≈ one cell of arc so no opening between candidates is skipped
    const steps = Math.max(16, Math.ceil((2 * Math.PI * rad) / grid.cs));
    for (let k = 1; k <= steps >> 1; k++) {
      for (const s of [1, -1] as const) {
        const ang = base + (s * k * 2 * Math.PI) / steps;
        const idx = cellIndexAt(isl.x + Math.cos(ang) * rad, isl.y + Math.sin(ang) * rad);
        if (!blockedFor(grid, idx, fi, ti)) return idx;
      }
    }
    return idx0; // fully enclosed — the cave fallback takes it from here
  };

  // ---------- shared docks: merge near-coincident approaches into ONE trunk ----------
  // Owner feedback 2026-07-07: pathways fanned into separate lines right at an island's
  // rim because each edge docked on its OWN bearing (toward its far island). Where
  // several edges approach one island from nearly the same direction, snap them to a
  // SHARED dock bearing so their final approach shares one dock cell + rim node —
  // segmentation then folds them into ONE trunk (usage = the number sharing it, so it
  // renders THICKER), instead of parallel approach lines. Pure function of the canonical
  // edge set: each island's approach bearings are sorted, the circle cut at its widest
  // gap (seam-stable), then greedily clustered within dockMergeGap AND dockMergeSpan.
  interface Approach {
    edgeKey: string;
    bx: number;
    by: number;
    ang: number;
  }
  const pushApproach = (
    incident: Map<number, Approach[]>,
    islIdx: number,
    edgeKey: string,
    tx: number,
    ty: number,
  ): void => {
    const L = Math.hypot(tx, ty);
    const bx = L < 1e-9 ? 1 : tx / L;
    const by = L < 1e-9 ? 0 : ty / L;
    const arr = incident.get(islIdx);
    const rec: Approach = { edgeKey, bx, by, ang: Math.atan2(by, bx) };
    if (arr) arr.push(rec);
    else incident.set(islIdx, [rec]);
  };
  // greedily cluster each island's approaches (angular gap + span cap) and map every
  // (island, edge) to its shared unit dock bearing — the circular mean of its cluster.
  const clusterDocks = (incident: Map<number, Approach[]>): Map<string, { bx: number; by: number }> => {
    const dockBearing = new Map<string, { bx: number; by: number }>();
    for (const [islIdx, appsRaw] of incident) {
      // canonical order (angle, then edge key) — input-order independent
      const apps = [...appsRaw].sort((p, q) =>
        p.ang !== q.ang ? p.ang - q.ang : p.edgeKey < q.edgeKey ? -1 : p.edgeKey > q.edgeKey ? 1 : 0,
      );
      const n = apps.length;
      const assign = (members: Approach[]): void => {
        // shared bearing = circular mean of members (angularly tight, so stable)
        let sx = 0;
        let sy = 0;
        for (const m of members) {
          sx += m.bx;
          sy += m.by;
        }
        const L = Math.hypot(sx, sy);
        const bx = L < 1e-9 ? members[0]!.bx : sx / L;
        const by = L < 1e-9 ? members[0]!.by : sy / L;
        for (const m of members) dockBearing.set(`${islIdx}${SEP}${m.edgeKey}`, { bx, by });
      };
      if (n === 1) {
        assign(apps); // lone approach: its own bearing, unchanged
        continue;
      }
      // cut the circle at its widest angular gap so clustering is seam-stable
      let cut = 0;
      let widest = -1;
      for (let i = 0; i < n; i++) {
        const a0 = apps[i]!.ang;
        const a1 = apps[(i + 1) % n]!.ang + (i + 1 === n ? 2 * Math.PI : 0);
        const gap = a1 - a0;
        if (gap > widest) {
          widest = gap;
          cut = (i + 1) % n;
        }
      }
      const order: Approach[] = [];
      for (let i = 0; i < n; i++) order.push(apps[(cut + i) % n]!);
      const base = order[0]!.ang;
      const un = order.map((a) => {
        let d = a.ang - base;
        while (d < 0) d += 2 * Math.PI;
        return d;
      });
      let start = 0;
      for (let i = 1; i < order.length; i++) {
        const gap = un[i]! - un[i - 1]!;
        const span = un[i]! - un[start]!;
        if (gap > t.dockMergeGap || span > t.dockMergeSpan) {
          assign(order.slice(start, i));
          start = i;
        }
      }
      assign(order.slice(start));
    }
    return dockBearing;
  };

  // pass 1: cluster by the straight CHORD bearing toward the far island
  const chordIncident = new Map<number, Approach[]>();
  for (const c of canon) {
    const A = islands[c.fi]!;
    const B = islands[c.ti]!;
    pushApproach(chordIncident, c.fi, c.key, B.x - A.x, B.y - A.y); // at A, bearing toward B
    pushApproach(chordIncident, c.ti, c.key, A.x - B.x, A.y - B.y); // at B, bearing toward A
  }

  // Route every canonical edge over the (mutable) grid with the given dock bearings,
  // returning the routed node chains. The reuse funnel mutates grid.cost in place, so a
  // second pass MUST be given a freshly rebuilt grid.
  const routePass = (dockBearing: Map<string, { bx: number; by: number }>): RoutedEdge[] => {
    const routed: RoutedEdge[] = [];
    for (const c of canon) {
      const A = islands[c.fi]!;
      const B = islands[c.ti]!;
      let ux = B.x - A.x;
      let uy = B.y - A.y;
      const chordLen = Math.hypot(ux, uy);
      if (chordLen < 1e-9) {
        ux = 1;
        uy = 0;
      } else {
        ux /= chordLen;
        uy /= chordLen;
      }
      // dock just outside each rim on the SHARED approach bearing (falls back to the raw
      // chord bearing for a lone approach), re-bearing around a blocker if the cell is covered
      const dbA = dockBearing.get(`${c.fi}${SEP}${c.key}`) ?? { bx: ux, by: uy };
      const dbB = dockBearing.get(`${c.ti}${SEP}${c.key}`) ?? { bx: -ux, by: -uy };
      const start = dockCellAt(A, dbA.bx, dbA.by, c.fi, c.ti);
      const goal = dockCellAt(B, dbB.bx, dbB.by, c.fi, c.ti);
      // cave fallback ONLY when the island-blocked route is impossible
      let path = runAstar(grid, st, t, start, goal, c.fi, c.ti, false);
      if (!path) path = runAstar(grid, st, t, start, goal, c.fi, c.ti, true);
      if (!path) {
        dropped.push({ from: c.from, to: c.to }); // degenerate grid — observable, not silent
        continue;
      }

      // reuse discount FUNNEL: traversed cells earn the strongest discount so later
      // routes snap ONTO the trunk; a graduated halo of `reuseHaloRadius` Chebyshev
      // rings earns a weaker discount (nearest ring wins) so a route drifting nearby is
      // funnelled in instead of settling into a parallel lane one cell over — the owner's
      // side-by-side-trails complaint (2026-07-06 / re-pushed 2026-07-07). The exact trail
      // cells stay strictly cheapest (an equal halo discount would let later routes ride a
      // parallel lane and never share). Each cell is discounted at most ONCE per route
      // (the cost mutates in place). Ring c's frac interpolates Inner→Outer over the radius.
      const R = Math.max(1, Math.round(t.reuseHaloRadius));
      const ringDisc = (c: number): number => {
        const frac = R <= 1 ? t.reuseHaloInner : t.reuseHaloInner + (t.reuseHaloOuter - t.reuseHaloInner) * ((c - 1) / (R - 1));
        return t.reuseDiscount + (1 - t.reuseDiscount) * frac;
      };
      const onPath = new Set<number>(path);
      const ringOf = new Map<number, number>();
      for (const ci of path) {
        const ix = ci % grid.cols;
        const iy = (ci / grid.cols) | 0;
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const cheb = Math.max(Math.abs(dx), Math.abs(dy));
            if (cheb === 0) continue;
            const nx = ix + dx;
            const ny = iy + dy;
            if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue;
            const ni = ny * grid.cols + nx;
            if (onPath.has(ni)) continue;
            const disc = ringDisc(cheb);
            const prev = ringOf.get(ni);
            if (prev === undefined || disc < prev) ringOf.set(ni, disc);
          }
        }
      }
      for (const ci of onPath) grid.cost[ci] = Math.max(t.discountFloor, (grid.cost[ci] ?? 1) * t.reuseDiscount);
      for (const [ni, disc] of ringOf) grid.cost[ni] = Math.max(t.discountFloor, (grid.cost[ni] ?? 1) * disc);

      // node sequence: exact rim point → cells → exact rim point, so trails dock
      // on the coast at the final approach bearing
      const nodes: NodeRec[] = [];
      const firstCell = path[0]!;
      const lastCell = path[path.length - 1]!;
      const pF = centerOf(firstCell);
      let bfx = pF.x - A.x;
      let bfy = pF.y - A.y;
      const lf = Math.hypot(bfx, bfy);
      if (lf < 1e-9) {
        bfx = ux;
        bfy = uy;
      } else {
        bfx /= lf;
        bfy /= lf;
      }
      nodes.push({ key: `r:${A.id}:${firstCell}`, x: A.x + bfx * A.r, y: A.y + bfy * A.r, underOf: -1 });
      for (const ci of path) {
        const p = centerOf(ci);
        nodes.push({
          key: `c:${ci}`,
          x: p.x,
          y: p.y,
          // ABSOLUTE island interior, own islands included: every edge through the
          // cell agrees a run under an island is hidden, so a shared link can never
          // render as one edge's surface trail across another edge's cave
          underOf: grid.interior[ci] ?? -1,
        });
      }
      const pL = centerOf(lastCell);
      let btx = pL.x - B.x;
      let bty = pL.y - B.y;
      const lt = Math.hypot(btx, bty);
      if (lt < 1e-9) {
        btx = -ux;
        bty = -uy;
      } else {
        btx /= lt;
        bty /= lt;
      }
      nodes.push({ key: `r:${B.id}:${lastCell}`, x: B.x + btx * B.r, y: B.y + bty * B.r, underOf: -1 });
      routed.push({ key: c.key, from: c.from, to: c.to, title: c.title, nodes });
    }
    return routed;
  };

  let routed = routePass(clusterDocks(chordIncident));

  // pass 2 (owner feedback 2026-07-08, "pathways split unnecessarily when joining together"):
  // the chord bearing toward the far island is a POOR predictor of where a trail actually
  // reaches the rim — the reuse funnel bends near-parallel edges onto a shared trunk, so two
  // edges whose CHORDS fan wide can arrive from the SAME direction and then fork into a Y at
  // the rim to reach two chord-split docks. Re-cluster by each edge's ACTUAL routed approach
  // bearing (island centre → the path a few cells out from the dock) and route once more over
  // a fresh grid. Edges that funnelled together now share ONE dock (the Y collapses to one
  // trunk); genuinely opposite-side edges still approach from opposite bearings, so the
  // anti-chaining span cap still keeps them apart — no forced rim-wrap. Deterministic: pass 1
  // is a pure function of the input, so the approach bearings and the re-clustering are too.
  if (t.reclusterOnApproach) {
    const probe = t.approachProbe; // how far past the rim to read the approach
    const apprIncident = new Map<number, Approach[]>();
    for (const re of routed) {
      const fi = byId.get(re.from);
      const ti = byId.get(re.to);
      if (fi === undefined || ti === undefined) continue;
      const A = islands[fi]!;
      const B = islands[ti]!;
      // walk in from each docking end to the first node clear of the rim + probe band; its
      // bearing from the island centre is the direction the trail truly arrives from
      const approachFrom = (isl: TrailIsland, fromStart: boolean): { x: number; y: number } => {
        const N = re.nodes.length;
        for (let k = 0; k < N; k++) {
          const nd = re.nodes[fromStart ? k : N - 1 - k]!;
          if (Math.hypot(nd.x - isl.x, nd.y - isl.y) > isl.r + probe) return nd;
        }
        return re.nodes[fromStart ? N - 1 : 0]!; // whole path within the band — use the far end
      };
      const pa = approachFrom(A, true);
      const pb = approachFrom(B, false);
      pushApproach(apprIncident, fi, re.key, pa.x - A.x, pa.y - A.y);
      pushApproach(apprIncident, ti, re.key, pb.x - B.x, pb.y - B.y);
    }
    grid = buildGrid(islands, seed, t); // fresh grid — pass 1 mutated the reuse costs
    routed = routePass(clusterDocks(apprIncident));
  }

  // ---------- weld near-coincident junctions (owner feedback 2026-07-08) ----------
  // Where trunks converge, different edges can join at ADJACENT grid cells rather than the same
  // cell, leaving a ~1-cell stub between two junction nodes that renders as a hook. Weld surface
  // junction nodes (degree ≥ 3 — a merge/split, never a straight-through degree-2 trail cell, so
  // trail resolution is untouched) within `junctionWeld` into ONE shared key + centroid position.
  // Deterministic: keys are processed in sorted order; the union-find always keeps the smaller key.
  if (t.junctionWeld > 0) {
    const nbrs = new Map<string, Set<string>>(); // key -> distinct neighbour keys (degree)
    const posOf = new Map<string, Pt>();
    for (const re of routed) {
      for (let i = 0; i < re.nodes.length; i++) {
        const nd = re.nodes[i]!;
        if (!posOf.has(nd.key)) posOf.set(nd.key, { x: nd.x, y: nd.y });
        if (nd.underOf !== -1) continue; // never weld hidden/under-island nodes (cave portals)
        const set = nbrs.get(nd.key) ?? nbrs.set(nd.key, new Set()).get(nd.key)!;
        const prev = re.nodes[i - 1];
        const next = re.nodes[i + 1];
        if (prev) set.add(prev.key);
        if (next) set.add(next.key);
      }
    }
    const junctionKeys = [...nbrs.entries()].filter(([, s]) => s.size >= 3).map(([k]) => k).sort();
    if (junctionKeys.length > 1) {
      const parent = new Map<string, string>(junctionKeys.map((k) => [k, k]));
      const find = (k: string): string => {
        let root = k;
        while (parent.get(root) !== root) root = parent.get(root)!;
        while (parent.get(k) !== root) {
          const up = parent.get(k)!;
          parent.set(k, root);
          k = up;
        }
        return root;
      };
      const union = (a: string, b: string): void => {
        const ra = find(a);
        const rb = find(b);
        if (ra === rb) return;
        if (ra < rb) parent.set(rb, ra);
        else parent.set(ra, rb);
      };
      const weld2 = t.junctionWeld * t.junctionWeld;
      for (let i = 0; i < junctionKeys.length; i++) {
        const a = posOf.get(junctionKeys[i]!)!;
        for (let j = i + 1; j < junctionKeys.length; j++) {
          const b = posOf.get(junctionKeys[j]!)!;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          if (dx * dx + dy * dy <= weld2) union(junctionKeys[i]!, junctionKeys[j]!);
        }
      }
      // canonical position = cluster centroid (deterministic — members sorted)
      const members = new Map<string, string[]>();
      for (const k of junctionKeys) (members.get(find(k)) ?? members.set(find(k), []).get(find(k))!).push(k);
      const canonPos = new Map<string, Pt>();
      for (const [root, ms] of members) {
        let sx = 0;
        let sy = 0;
        for (const m of ms) {
          const p = posOf.get(m)!;
          sx += p.x;
          sy += p.y;
        }
        canonPos.set(root, { x: sx / ms.length, y: sy / ms.length });
      }
      // remap welded junctions to their canonical key + centroid, then drop any degenerate
      // run this weld created: consecutive duplicates (A A) and one-node spikes (A X A → A)
      for (const re of routed) {
        const mapped: NodeRec[] = re.nodes.map((nd) => {
          if (nd.underOf !== -1 || !parent.has(nd.key)) return nd;
          const root = find(nd.key);
          const cp = canonPos.get(root)!;
          return { key: root, x: cp.x, y: cp.y, underOf: -1 };
        });
        const out: NodeRec[] = [];
        for (const nd of mapped) {
          const prev = out[out.length - 1];
          if (prev && prev.key === nd.key) continue; // A A → A (drop nd)
          if (out.length >= 2 && out[out.length - 2]!.key === nd.key) {
            out.pop(); // A X A → A: drop X; out end is now A === nd, so drop nd too
            continue;
          }
          out.push(nd);
        }
        re.nodes = out;
      }
    }
  }

  // ---------- segmentization: split where the co-travelling edge set changes ----------
  // Each undirected link (node pair) carries a signature = the sorted set of
  // edges using it (hidden-flagged per edge). A segment is a maximal run of
  // links with one signature — junctions and hidden/visible transitions both
  // change the signature, so both split.
  const linkEntries = new Map<string, Set<string>>();
  for (const re of routed) {
    for (let i = 0; i + 1 < re.nodes.length; i++) {
      const a = re.nodes[i]!;
      const b = re.nodes[i + 1]!;
      const entry = re.key + (a.underOf !== -1 || b.underOf !== -1 ? HIDDEN_MARK : '');
      const lk = linkKeyOf(a, b);
      let set = linkEntries.get(lk);
      if (!set) {
        set = new Set();
        linkEntries.set(lk, set);
      }
      set.add(entry);
    }
  }
  const sigOf = new Map<string, string>();
  for (const [lk, set] of linkEntries) sigOf.set(lk, [...set].sort().join(SIG_JOIN));

  interface SegRec {
    id: string;
    pts: Pt[];
    hidden: boolean;
    usage: number;
  }
  const segByCanon = new Map<string, SegRec>();
  const segOrder: SegRec[] = [];
  const segIdCount = new Map<string, number>(); // 32-bit hash collision guard
  const outEdges: TrailEdgeOut[] = [];
  for (const re of routed) {
    const linkCount = re.nodes.length - 1;
    const sigs: string[] = [];
    for (let l = 0; l < linkCount; l++) {
      sigs.push(sigOf.get(linkKeyOf(re.nodes[l]!, re.nodes[l + 1]!)) ?? '');
    }
    const chain: { id: string; reversed: boolean }[] = [];
    const emitRun = (from: number, to: number): void => {
      const run = re.nodes.slice(from, to + 1);
      const keys = run.map((nd) => nd.key);
      const fwd = keys.join(SEP);
      const rev = [...keys].reverse().join(SEP);
      const reversed = rev < fwd; // canonical orientation: lexicographically smaller key run
      const canonKey = reversed ? rev : fwd;
      let rec = segByCanon.get(canonKey);
      if (!rec) {
        const entries = (sigs[from] ?? '').split(SIG_JOIN).filter((x) => x.length > 0);
        // two distinct cell runs CAN share a 32-bit FNV hash — a shared id would
        // corrupt edge chains and reveal targeting, so extend, never share
        const base = `t${hash(canonKey).toString(36)}`;
        const nth = segIdCount.get(base) ?? 0;
        segIdCount.set(base, nth + 1);
        rec = {
          id: nth === 0 ? base : `${base}-${nth + 1}`,
          pts: (reversed ? [...run].reverse() : run).map((nd) => ({ x: nd.x, y: nd.y })),
          hidden: entries.length > 0 && entries.every((x) => x.endsWith(HIDDEN_MARK)),
          usage: entries.length,
        };
        segByCanon.set(canonKey, rec);
        segOrder.push(rec);
      }
      chain.push({ id: rec.id, reversed });
    };
    let runStart = 0;
    for (let l = 1; l < linkCount; l++) {
      if (sigs[l] !== sigs[l - 1]) {
        emitRun(runStart, l);
        runStart = l;
      }
    }
    emitRun(runStart, linkCount);
    // ANNOTATED local, then one guarded assignment — the shape
    // `anti-slop/no-conditional-empty-object-spread` requires.
    const outEdge: TrailEdgeOut = { from: re.from, to: re.to, segments: chain };
    if (re.title !== undefined) outEdge.title = re.title;
    outEdges.push(outEdge);
  }

  // ---------- cave portals: rim crossings of the hidden runs ----------
  interface CaveAcc {
    islandId: string;
    x: number;
    y: number;
    bearing: number;
    edgeIds: Set<string>;
  }
  const caveMap = new Map<string, CaveAcc>();
  const addPortal = (isl: TrailIsland, a: NodeRec, b: NodeRec, edgeKey: string): void => {
    const key = `${isl.id}${SEP}${linkKeyOf(a, b)}`;
    let acc = caveMap.get(key);
    if (!acc) {
      const p = circleCrossing(a, b, isl);
      acc = {
        islandId: isl.id,
        x: p.x,
        y: p.y,
        bearing: Math.atan2(p.y - isl.y, p.x - isl.x),
        edgeIds: new Set(),
      };
      caveMap.set(key, acc);
    }
    acc.edgeIds.add(edgeKey);
  };
  for (const re of routed) {
    const displayKey = `${re.from}->${re.to}`; // the PUBLIC edge key (docs on TrailCave)
    for (let i = 0; i + 1 < re.nodes.length; i++) {
      const a = re.nodes[i]!;
      const b = re.nodes[i + 1]!;
      if (a.underOf === b.underOf) continue;
      if (a.underOf !== -1) addPortal(islands[a.underOf]!, a, b, displayKey); // exit portal
      if (b.underOf !== -1) addPortal(islands[b.underOf]!, a, b, displayKey); // entry portal
    }
  }
  const caves: TrailCave[] = [...caveMap.values()].map((acc) => ({
    islandId: acc.islandId,
    x: acc.x,
    y: acc.y,
    bearing: acc.bearing,
    width: trailFillWidth(acc.edgeIds.size),
    edgeIds: [...acc.edgeIds].sort(),
  }));

  // resample every segment first (pure geometry), so the meander pass can see the
  // OTHER trails and fade its wander out wherever two paths run close (owner 2026-07-08)
  const bases = segOrder.map((rec) => resampleSegment(rec.pts, t));
  const visibleBases = segOrder.map((rec, i) => (rec.hidden ? null : bases[i]!));
  const segments: TrailSegment[] = segOrder.map((rec, i) => {
    const others: ResampledSeg[] = [];
    for (let j = 0; j < visibleBases.length; j++) {
      const vb = visibleBases[j];
      if (j !== i && vb) others.push(vb);
    }
    const sm = meanderSpline(bases[i]!, rec.hidden, rec.id, islands, others, seed, t);
    return { id: rec.id, d: sm.d, points: sm.points, usage: rec.usage, hidden: rec.hidden };
  });
  return { segments, edges: outEdges, caves, dropped: finishDropped() };
}

/**
 * Project a network routed in GROUND SPACE (via {@link routeTrails} fed ground-plane
 * `TrailIsland`s) into SCREEN space at the declared land camera (ADR-0367 D1). The router itself
 * stays camera-agnostic (see the module doc) — this is the one seam where that ground-space
 * geometry becomes the screen-space `d`/`points` every render surface expects.
 *
 * Centripetal Catmull-Rom is affine in its control points, so re-splining the PROJECTED points
 * (`crPathD`) reproduces exactly the curve `routeTrails` would have drawn had it computed the
 * spline after projection — this is not an approximation.
 *
 * A cave's `bearing` is recomputed from the PROJECTED island centre to the PROJECTED portal point
 * rather than reprojecting the ground-space angle directly: an anisotropic (non-uniform) scale
 * does not carry an angle to its own image (a ground-space outward normal does not project to the
 * screen-space outward normal of the resulting ellipse), where "point away from the projected
 * centre, through the projected portal" is still exactly the outward direction on screen.
 */
export function projectTrailNetwork(
  network: TrailNetwork,
  islands: readonly TrailIsland[],
  elevationDeg: number = LAND_CAMERA_ELEVATION_DEG,
): TrailNetwork {
  const centreOf = new Map<string, Pt>();
  for (const isl of islands) {
    if (!centreOf.has(isl.id)) centreOf.set(isl.id, projectGround({ x: isl.x, y: isl.y }, elevationDeg));
  }
  const segments: TrailSegment[] = network.segments.map((seg) => {
    const points = seg.points.map((p) => projectGround(p, elevationDeg));
    return { ...seg, points, d: crPathD(points) };
  });
  const caves: TrailCave[] = network.caves.map((cave) => {
    const p = projectGround({ x: cave.x, y: cave.y }, elevationDeg);
    const centre = centreOf.get(cave.islandId) ?? p;
    return { ...cave, x: p.x, y: p.y, bearing: Math.atan2(p.y - centre.y, p.x - centre.x) };
  });
  return { ...network, segments, caves };
}
