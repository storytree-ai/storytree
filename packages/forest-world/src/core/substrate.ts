// Relaxed substrate (Oskar Stålberg / Townscaper style) — swaps the regular
// hex-tile interiors for an irregular, relaxed grid so each island reads as ONE
// organic landmass instead of a cluster of hexagons. `mesh` (the faithful
// irregular-quad Townscaper mesh, a port of kchapelier/hexagrid-relaxing) is the
// DEFAULT world look (owner look-decision 2026-06-16). All keep the DAG-driven
// layout + the organic coastline; only the interior tile geometry changes.
// Deterministic throughout (hash/rand01, no Math.random); boundary vertices (the
// outer silhouette the coastline was smoothed from) are PINNED so the shore still
// encloses the relaxed cells.
//
// Input is the layout-agnostic `(drawTiles, wheatSets)` pair — the claimed tiles
// with their owning-territory index, and one wheat-key set per territory — NOT any
// app's World type, so this is shared verbatim by the studio and the website
// (which already used exactly this signature). `wheatSets[owner]` is the set of
// axial keys that territory tinted as wheat.

import { hash, rand01 } from './rng.js';
import { LAND_CAMERA_ELEVATION_DEG, PLAN_VIEW_ELEVATION_DEG, projectGround } from './camera.js';
import {
  HEX_R,
  hexCenter,
  hexCorners,
  pixelToHex,
  axialKey,
  type Axial,
  type ElevationOpts,
  type Pt,
} from './hex.js';

export type SubstrateMode = 'relaxed-hex' | 'relaxed-quad' | 'mesh';

/** A claimed tile and the territory index that owns it (the layout's output). */
export interface DrawTile {
  h: Axial;
  owner: number;
}

/**
 * How wild the relaxed substrate is. `jitter` is the per-vertex displacement as
 * a fraction of HEX_R (the main "randomness" knob); `iters`/`relax` are the
 * Laplacian smoothing that untangles the jitter (more smoothing = cleaner but
 * more regular). `wheatScatter` breaks whole-hex wheat patches into a per-cell
 * scatter so the tan fields stop reading as hexagons.
 */
export interface SubstrateTuning {
  jitter: number;
  iters: number;
  relax: number;
  wheatScatter: boolean;
  /** mesh-only: extra quad-subdivision passes on the merge result (1 = the
   *  canonical hexagrid-relaxing density; 2 = finer cobbles). */
  subdiv?: number;
  /** The lattice radius the cells are built on. Defaults to the derived `HEX_R`; an INSTRUMENT'S
   *  option (ADR-0528) — see `ElevationOpts.hexR` in `hex.ts`. The jitter is a fraction of THIS
   *  radius, so a fixture drawn on the tuned tile relaxes exactly as it did. */
  hexR?: number;
}

/**
 * THE SUBSTRATE IS BUILT ON THE GROUND AND PROJECTED ONCE, AT THE END (ADR-0367 D1).
 *
 * `hexCenter` / `hexCorners` / `pixelToHex` all hand back SCREEN coordinates by default, so the
 * whole mesh used to be built in screen space -- which is what put vertex IDENTITY, the jitter
 * seed and the cell decomposition itself downstream of the camera. Asking the lattice for the
 * PLAN VIEW recovers the pre-camera, un-flattened positions exactly, so every stage below runs on
 * the ground plane and `buildRelaxedCells` projects the finished polygons once.
 *
 * THAT IS AN EXACT EQUIVALENCE, not an approximation, which is why the look does not drift: the
 * projection is affine, and every operation between here and the projection -- midpoints,
 * centroids, Laplacian averaging, a polar jitter offset -- commutes with it. What does NOT commute
 * is ROUNDING, and that is the whole defect: `VKEY` rounds, so where it rounds decides what the
 * mesh thinks a vertex IS.
 *
 * It is also why the camera cannot re-decompose the mesh even in principle now. Nothing upstream
 * of the projection can see `elevationDeg`, so there is no round trip through `sin` for floating
 * point to disagree about at a rounding boundary -- the ground coordinates are bit-identical at
 * every elevation rather than merely close.
 */
const GROUND = { elevationDeg: PLAN_VIEW_ELEVATION_DEG } as const;

const QUAD_TUNING: SubstrateTuning = { jitter: 0.78, iters: 2, relax: 0.26, wheatScatter: true };
const HEX_TUNING: SubstrateTuning = { jitter: 0.7, iters: 2, relax: 0.28, wheatScatter: false };
// Path B's irregular topology carries the de-hexing, so jitter sits lower than
// path A (less needed; too much tangles the finer mesh); relax a touch firmer to
// settle the merged quads into clean Townscaper cells.
export const MESH_TUNING: SubstrateTuning = {
  jitter: 0.42,
  iters: 3,
  relax: 0.34,
  wheatScatter: true,
  subdiv: 1,
};

/** One filled cell of the relaxed substrate: a polygon owned by a territory. */
export interface RelaxedCell {
  owner: number;
  poly: Pt[];
  variant: number;
  wheat: boolean;
}

/**
 * VERTEX IDENTITY, DECIDED ON THE GROUND (ADR-0367 D1, `substrate-interning-moves-to-ground-space`).
 *
 * This is the mesh's answer to "are these two vertices the same point?", and until this increment it
 * asked that question in SCREEN space: every stage below ran on PROJECTED coordinates and this key
 * rounded them to 0.1 px. The land now has a declared camera, so the projection compresses the
 * ground's depth axis by `sin 20 deg ~ 0.342` -- and a bucket 0.1 px tall on screen is 0.292 units
 * tall on the ground. The tolerance was ANISOTROPIC in the space that matters, nearly three times
 * looser across depth than across width.
 *
 * ⚠ WHAT THAT ACTUALLY COST, MEASURED RATHER THAN ASSUMED -- and it is NOT what the increment that
 * commissioned this fix expected, so read this before repeating the old claim. The increment cites
 * PR #1344's "the same island re-decomposed from 50 to 52 cells". That consequence is NOT
 * reproducible: comparing this file against its own previous revision over symmetric discs of 7 to
 * 61 tiles and 480 irregular grown blobs, in all three modes, the cell count is IDENTICAL in every
 * single case. The hex lattice's vertices are units apart, so a 0.292-unit bucket never actually
 * merged two distinct ground points -- it only ever absorbed floating-point noise on shared corners,
 * which is what it was for.
 *
 * WHAT THE SCREEN KEY REALLY DECIDED IS THE JITTER. `relaxVerts` seeds each vertex's displacement
 * off this key (`jx:` / `jm:`), so a key computed from a projected coordinate makes every vertex's
 * GROUND position a function of the camera. That is the defect that was live, and it is not a small
 * one: 79.2% of vertex positions move between the old rule and this one, by up to 11.4 px. Counts,
 * owners, wheat and the parcel partition are all untouched -- what changes is that the island's
 * interior texture is now the LAND's, seen from wherever, instead of one the projection re-rolled.
 *
 * THE TOLERANCE IS STATED, NOT INHERITED. 0.1 was authored before the land had a camera, when the two
 * spaces COINCIDED -- so 0.1 px was already 0.1 ground unit, and 0.1 ground units is exactly what it
 * has always meant. What the camera did was silently loosen it on one axis by `1 / sin 20 deg ~ 2.92`.
 * Building on the ground restores the number the author chose rather than replacing it. The merge
 * hazard that loosening created stayed theoretical, but it is closed the same way as the live one and
 * at no extra cost.
 */
const VKEY = (p: Pt): string => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;

/**
 * Jitter (deterministically) then Laplacian-relax a vertex mesh in place.
 * Interior vertices wobble and smooth into organic cells; pinned (boundary)
 * vertices hold the silhouette. Light relaxation keeps the jittered character
 * — full convergence would regularise a regular-topology mesh back to a grid.
 */
function relaxVerts(
  verts: Pt[],
  adj: Set<number>[],
  pinned: Set<number>,
  opts: { jitterMag: number; iters: number; relax: number },
): void {
  const orig = verts.map((p) => VKEY(p));
  for (let i = 0; i < verts.length; i++) {
    if (pinned.has(i)) continue;
    const p = verts[i];
    if (!p) continue;
    const ang = rand01(hash(`jx:${orig[i]}`)) * Math.PI * 2;
    const mag = rand01(hash(`jm:${orig[i]}`)) * opts.jitterMag;
    // The jitter is a GROUND-plane displacement and this whole mesh is built on the GROUND, so
    // it is isotropic here and the camera never enters (ADR-0367 D1). PR #1344 had to carry an
    // explicit `sin` here precisely because the mesh was then built in screen space, where an
    // isotropic wobble is several times the projected row pitch and tangles the mesh in y alone.
    // That term is gone rather than moved: `buildRelaxedCells` projects once, at the end.
    p.x += Math.cos(ang) * mag;
    p.y += Math.sin(ang) * mag;
  }
  for (let it = 0; it < opts.iters; it++) {
    const next = verts.map((p) => ({ x: p.x, y: p.y }));
    for (let i = 0; i < verts.length; i++) {
      if (pinned.has(i)) continue;
      const ns = adj[i];
      const cur = verts[i];
      const nx = next[i];
      if (!ns || !cur || !nx || ns.size === 0) continue;
      let sx = 0;
      let sy = 0;
      for (const j of ns) {
        const q = verts[j];
        if (q) {
          sx += q.x;
          sy += q.y;
        }
      }
      nx.x = cur.x + (sx / ns.size - cur.x) * opts.relax;
      nx.y = cur.y + (sy / ns.size - cur.y) * opts.relax;
    }
    for (let i = 0; i < verts.length; i++) {
      const cur = verts[i];
      const nx = next[i];
      if (cur && nx) {
        cur.x = nx.x;
        cur.y = nx.y;
      }
    }
  }
}

/** Path A — relax the shared hex-corner lattice; rebuild irregular hexagons. */
function buildRelaxedHexCells(
  drawTiles: readonly DrawTile[],
  wheatSets: readonly ReadonlySet<string>[],
  t: SubstrateTuning,
): RelaxedCell[] {
  const R = t.hexR ?? HEX_R; // the lattice radius this mesh is built on (ADR-0528)
  const verts: Pt[] = [];
  const vId = new Map<string, number>();
  const adj: Set<number>[] = [];
  const intern = (p: Pt): number => {
    const k = VKEY(p);
    let id = vId.get(k);
    if (id === undefined) {
      id = verts.length;
      verts.push({ x: p.x, y: p.y });
      vId.set(k, id);
      adj.push(new Set());
    }
    return id;
  };
  // Each tile → its 6 shared corner ids; track hex-edge usage to find the shore.
  const tileCorners: { owner: number; key: string; ids: number[] }[] = [];
  const edgeUse = new Map<string, number>();
  const eKey = (a: number, b: number): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const { h, owner } of drawTiles) {
    const c = hexCenter(h, { ...GROUND, hexR: R });
    const ids = hexCorners(c.x, c.y, R, PLAN_VIEW_ELEVATION_DEG).map(intern);
    tileCorners.push({ owner, key: axialKey(h), ids });
    for (let i = 0; i < 6; i++) {
      const a = ids[i];
      const b = ids[(i + 1) % 6];
      if (a === undefined || b === undefined) continue;
      adj[a]?.add(b);
      adj[b]?.add(a);
      const k = eKey(a, b);
      edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
    }
  }
  const pinned = new Set<number>();
  for (const [k, n] of edgeUse) {
    if (n === 1) {
      const [a, b] = k.split('|');
      pinned.add(Number(a));
      pinned.add(Number(b));
    }
  }
  relaxVerts(verts, adj, pinned, { jitterMag: R * t.jitter, iters: t.iters, relax: t.relax });
  return tileCorners.map(({ owner, key, ids }) => ({
    owner,
    poly: ids.map((id) => verts[id] ?? { x: 0, y: 0 }),
    variant: hash(`tile:${key}`) % 3,
    wheat: wheatSets[owner]?.has(key) ?? false,
  }));
}

/** Path B — subdivide each hex into 6 quads, relax the shared mesh (Townscaper). */
function buildRelaxedQuadCells(
  drawTiles: readonly DrawTile[],
  wheatSets: readonly ReadonlySet<string>[],
  t: SubstrateTuning,
): RelaxedCell[] {
  const R = t.hexR ?? HEX_R; // the lattice radius this mesh is built on (ADR-0528)
  const verts: Pt[] = [];
  const vId = new Map<string, number>();
  const adj: Set<number>[] = [];
  const intern = (p: Pt): number => {
    const k = VKEY(p);
    let id = vId.get(k);
    if (id === undefined) {
      id = verts.length;
      verts.push({ x: p.x, y: p.y });
      vId.set(k, id);
      adj.push(new Set());
    }
    return id;
  };
  interface Quad {
    owner: number;
    ids: number[];
    variant: number;
    wheat: boolean;
  }
  const quads: Quad[] = [];
  const edgeUse = new Map<string, number>();
  const eKey = (a: number, b: number): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const link = (a: number, b: number): void => {
    adj[a]?.add(b);
    adj[b]?.add(a);
    const k = eKey(a, b);
    edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
  };
  for (const { h, owner } of drawTiles) {
    const c = hexCenter(h, { ...GROUND, hexR: R });
    const corners = hexCorners(c.x, c.y, R, PLAN_VIEW_ELEVATION_DEG);
    const oid = intern(c);
    const key = axialKey(h);
    const wheat = wheatSets[owner]?.has(key) ?? false;
    const cornerIds = corners.map(intern);
    const midIds = corners.map((cor, i) => {
      const nxt = corners[(i + 1) % 6] ?? cor;
      return intern({ x: (cor.x + nxt.x) / 2, y: (cor.y + nxt.y) / 2 });
    });
    for (let i = 0; i < 6; i++) {
      const ci = cornerIds[i];
      const mPrev = midIds[(i + 5) % 6];
      const mNext = midIds[i];
      if (ci === undefined || mPrev === undefined || mNext === undefined) continue;
      const ids = [oid, mPrev, ci, mNext];
      // wheatScatter: a wheat hex normally tints all 6 sub-cells — which reads as
      // a tan hexagon. Scatter it per-cell instead so the field stops being hexy
      // (grass cells mixed back in; ~70% of a wheat hex's cells stay wheat).
      const cellWheat = wheat && (!t.wheatScatter || rand01(hash(`wheat:${key}:${i}`)) < 0.7);
      quads.push({ owner, ids, variant: hash(`cell:${key}:${i}`) % 3, wheat: cellWheat });
      link(ids[0]!, ids[1]!);
      link(ids[1]!, ids[2]!);
      link(ids[2]!, ids[3]!);
      link(ids[3]!, ids[0]!);
    }
  }
  const pinned = new Set<number>();
  for (const [k, n] of edgeUse) {
    if (n === 1) {
      const [a, b] = k.split('|');
      pinned.add(Number(a));
      pinned.add(Number(b));
    }
  }
  relaxVerts(verts, adj, pinned, { jitterMag: R * t.jitter, iters: t.iters, relax: t.relax });
  return quads.map((q) => ({
    owner: q.owner,
    poly: q.ids.map((id) => verts[id] ?? { x: 0, y: 0 }),
    variant: q.variant,
    wheat: q.wheat,
  }));
}

/**
 * Path B — the faithful Townscaper / Stålberg irregular-quad mesh (a port of
 * kchapelier/hexagrid-relaxing), in four steps over ONE shared, watertight
 * vertex pool:
 *   1. Triangulate: every claimed hex → 6 triangles (centre, corner_i,
 *      corner_{i+1}). Centres/corners are interned, so triangles of adjacent
 *      hexes share the rim edge between them.
 *   2. Merge adjacent triangle PAIRS into quads — greedily, ordered by a hash so
 *      it is identical every render, each triangle matched at most once. Pairs
 *      form ACROSS hex boundaries as readily as within a hex: this is what
 *      dissolves path A's fixed 6-quad fan (the residual pinwheel) and the
 *      regular lattice of hex centres.
 *   3. Subdivide: each merged quad → 4 sub-quads, each LEFTOVER triangle → 3
 *      sub-quads (the canonical "make it all quads" step). Midpoints/centroids
 *      are interned so neighbouring cells share them.
 *   4. Relax the shared mesh (reusing `relaxVerts`), boundary vertices pinned.
 *
 * Ownership is the source hex's territory — the layout keeps territories
 * non-adjacent, so a merge never spans two stories; the coastline is the existing
 * hex-silhouette one (outer vertices pinned), which still encloses the relaxed
 * cells. Deterministic (hash/rand01).
 */
function buildMeshCells(
  drawTiles: readonly DrawTile[],
  wheatSets: readonly ReadonlySet<string>[],
  t: SubstrateTuning,
): RelaxedCell[] {
  const R = t.hexR ?? HEX_R; // the lattice radius this mesh is built on (ADR-0528)
  const verts: Pt[] = [];
  const vId = new Map<string, number>();
  const adj: Set<number>[] = [];
  const intern = (p: Pt): number => {
    const k = VKEY(p);
    let id = vId.get(k);
    if (id === undefined) {
      id = verts.length;
      verts.push({ x: p.x, y: p.y });
      vId.set(k, id);
      adj.push(new Set());
    }
    return id;
  };
  const eKey = (a: number, b: number): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

  // 1. Triangulate every hex into 6 triangles over the shared vertex pool, and
  //    index each undirected edge → the triangles touching it (≤2).
  interface Tri {
    v: [number, number, number];
    owner: number;
  }
  const tris: Tri[] = [];
  const triEdges = new Map<string, number[]>();
  for (const { h, owner } of drawTiles) {
    const c = hexCenter(h, { ...GROUND, hexR: R });
    const oid = intern(c);
    const cornerIds = hexCorners(c.x, c.y, R, PLAN_VIEW_ELEVATION_DEG).map(intern);
    for (let i = 0; i < 6; i++) {
      const a = cornerIds[i] ?? 0;
      const b = cornerIds[(i + 1) % 6] ?? 0;
      const ti = tris.length;
      tris.push({ v: [oid, a, b], owner });
      for (const [x, y] of [
        [oid, a],
        [a, b],
        [b, oid],
      ] as const) {
        const k = eKey(x, y);
        let arr = triEdges.get(k);
        if (!arr) {
          arr = [];
          triEdges.set(k, arr);
        }
        arr.push(ti);
      }
    }
  }

  // 2. Greedy deterministic pairing: every interior edge shared by two same-owner
  //    triangles is a merge candidate, ordered by a hash; match each triangle once.
  const partner = new Int32Array(tris.length).fill(-1);
  interface Cand {
    ti: number;
    tj: number;
    rank: number;
  }
  const cands: Cand[] = [];
  for (const [k, arr] of triEdges) {
    if (arr.length !== 2) continue;
    const ti = arr[0] ?? 0;
    const tj = arr[1] ?? 0;
    if ((tris[ti]?.owner ?? -1) !== (tris[tj]?.owner ?? -2)) continue;
    cands.push({ ti, tj, rank: hash(`merge:${k}`) });
  }
  cands.sort((p, q) => p.rank - q.rank || p.ti - q.ti || p.tj - q.tj);
  for (const cd of cands) {
    if (partner[cd.ti] === -1 && partner[cd.tj] === -1) {
      partner[cd.ti] = cd.tj;
      partner[cd.tj] = cd.ti;
    }
  }

  // 3. Subdivide into all-quads. Midpoints/centroids interned (shared → watertight);
  //    build the relax adjacency + boundary edge-use as each final cell is emitted.
  const levels = Math.max(1, Math.round(t.subdiv ?? 1));
  const edgeUse = new Map<string, number>();
  const link = (a: number, b: number): void => {
    adj[a]?.add(b);
    adj[b]?.add(a);
    const k = eKey(a, b);
    edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
  };
  interface Cell {
    ids: number[];
    owner: number;
    hkey: string;
  }
  const cells: Cell[] = [];
  const mid = (a: number, b: number): number => {
    const pa = verts[a] ?? { x: 0, y: 0 };
    const pb = verts[b] ?? { x: 0, y: 0 };
    return intern({ x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 });
  };
  const centroidId = (ids: number[]): number => {
    let x = 0;
    let y = 0;
    for (const id of ids) {
      const p = verts[id] ?? { x: 0, y: 0 };
      x += p.x;
      y += p.y;
    }
    return intern({ x: x / ids.length, y: y / ids.length });
  };
  const emit = (ids: number[], owner: number): void => {
    let cx = 0;
    let cy = 0;
    for (const id of ids) {
      const p = verts[id] ?? { x: 0, y: 0 };
      cx += p.x;
      cy += p.y;
    }
    const hkey = axialKey(pixelToHex({ x: cx / ids.length, y: cy / ids.length }, { ...GROUND, hexR: R }));
    cells.push({ ids, owner, hkey });
    for (let i = 0; i < ids.length; i++) link(ids[i] ?? 0, ids[(i + 1) % ids.length] ?? 0);
  };
  const subdivQuad = (q: number[], owner: number, lv: number): void => {
    if (lv <= 0) {
      emit(q, owner);
      return;
    }
    const [p0, p1, p2, p3] = q as [number, number, number, number];
    const g = centroidId(q);
    const m01 = mid(p0, p1);
    const m12 = mid(p1, p2);
    const m23 = mid(p2, p3);
    const m30 = mid(p3, p0);
    subdivQuad([p0, m01, g, m30], owner, lv - 1);
    subdivQuad([m01, p1, m12, g], owner, lv - 1);
    subdivQuad([g, m12, p2, m23], owner, lv - 1);
    subdivQuad([m30, g, m23, p3], owner, lv - 1);
  };
  const subdivTri = (tri: number[], owner: number, lv: number): void => {
    const [a, b, c] = tri as [number, number, number];
    const g = centroidId(tri);
    const mab = mid(a, b);
    const mbc = mid(b, c);
    const mca = mid(c, a);
    subdivQuad([a, mab, g, mca], owner, lv - 1);
    subdivQuad([b, mbc, g, mab], owner, lv - 1);
    subdivQuad([c, mca, g, mbc], owner, lv - 1);
  };
  for (let ti = 0; ti < tris.length; ti++) {
    const tA = tris[ti];
    if (!tA) continue;
    const pj = partner[ti] ?? -1;
    if (pj === -1) {
      subdivTri(tA.v, tA.owner, levels); // leftover triangle → 3 quads
    } else if (ti < pj) {
      // emit each merged pair once, as the quad p→a→q→b (a,b = shared edge).
      const tB = tris[pj];
      if (!tB) continue;
      const shared = tA.v.filter((x) => tB.v.includes(x));
      const a = shared[0] ?? 0;
      const b = shared[1] ?? 0;
      const p = tA.v.find((x) => x !== a && x !== b) ?? a;
      const q = tB.v.find((x) => x !== a && x !== b) ?? b;
      subdivQuad([p, a, q, b], tA.owner, levels);
    }
  }

  // 4. Pin the silhouette (edges used once), then jitter + relax the interior.
  const pinned = new Set<number>();
  for (const [k, n] of edgeUse) {
    if (n === 1) {
      const [a, b] = k.split('|');
      pinned.add(Number(a));
      pinned.add(Number(b));
    }
  }
  relaxVerts(verts, adj, pinned, { jitterMag: R * t.jitter, iters: t.iters, relax: t.relax });

  return cells.map((cell) => {
    const isWheatHex = wheatSets[cell.owner]?.has(cell.hkey) ?? false;
    const cellKey = cell.ids.join(',');
    const wheat =
      isWheatHex && (!t.wheatScatter || rand01(hash(`mesh-wheat:${cell.hkey}:${cellKey}`)) < 0.72);
    return {
      owner: cell.owner,
      poly: cell.ids.map((id) => verts[id] ?? { x: 0, y: 0 }),
      variant: hash(`mesh-cell:${cellKey}`) % 3,
      wheat,
    };
  });
}

/**
 * Build the relaxed substrate cells for the whole map from the layout's claimed
 * tiles + per-territory wheat sets. `mesh` is the canonical Townscaper look;
 * `relaxed-hex`/`relaxed-quad` are the lighter alternates. Pure, deterministic.
 */
export function buildRelaxedCells(
  drawTiles: readonly DrawTile[],
  wheatSets: readonly ReadonlySet<string>[],
  mode: SubstrateMode,
  override: Partial<SubstrateTuning> = {},
  opts?: ElevationOpts,
): RelaxedCell[] {
  const elevationDeg = opts?.elevationDeg ?? LAND_CAMERA_ELEVATION_DEG;
  const ground =
    mode === 'relaxed-hex'
      ? buildRelaxedHexCells(drawTiles, wheatSets, { ...HEX_TUNING, ...override })
      : mode === 'mesh'
        ? buildMeshCells(drawTiles, wheatSets, { ...MESH_TUNING, ...override })
        : buildRelaxedQuadCells(drawTiles, wheatSets, { ...QUAD_TUNING, ...override });
  // The ONE place the camera enters (see {@link GROUND}). Callers still receive SCREEN polygons,
  // so nothing downstream changes shape.
  return ground.map((cell) => ({
    ...cell,
    poly: cell.poly.map((p) => projectGround(p, elevationDeg)),
  }));
}
