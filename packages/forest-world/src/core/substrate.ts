// Capability 1 · Scene layout

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

export interface DrawTile {
  h: Axial;
  owner: number;
}

export interface SubstrateTuning {
  jitter: number;
  iters: number;
  relax: number;
  wheatScatter: boolean;
  subdiv?: number;
  hexR?: number;
}

const GROUND = { elevationDeg: PLAN_VIEW_ELEVATION_DEG } as const;

const QUAD_TUNING: SubstrateTuning = { jitter: 0.78, iters: 2, relax: 0.26, wheatScatter: true };
const HEX_TUNING: SubstrateTuning = { jitter: 0.7, iters: 2, relax: 0.28, wheatScatter: false };
export const MESH_TUNING: SubstrateTuning = {
  jitter: 0.42,
  iters: 3,
  relax: 0.34,
  wheatScatter: true,
  subdiv: 1,
};

export interface RelaxedCell {
  owner: number;
  poly: Pt[];
  variant: number;
  wheat: boolean;
}

const VKEY = (p: Pt): string => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;

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

function buildRelaxedHexCells(
  drawTiles: readonly DrawTile[],
  wheatSets: readonly ReadonlySet<string>[],
  t: SubstrateTuning,
): RelaxedCell[] {
  const R = t.hexR ?? HEX_R;
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

function buildRelaxedQuadCells(
  drawTiles: readonly DrawTile[],
  wheatSets: readonly ReadonlySet<string>[],
  t: SubstrateTuning,
): RelaxedCell[] {
  const R = t.hexR ?? HEX_R;
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

function buildMeshCells(
  drawTiles: readonly DrawTile[],
  wheatSets: readonly ReadonlySet<string>[],
  t: SubstrateTuning,
): RelaxedCell[] {
  const R = t.hexR ?? HEX_R;
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
      subdivTri(tA.v, tA.owner, levels);
    } else if (ti < pj) {
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
  return ground.map((cell) => ({
    ...cell,
    poly: cell.poly.map((p) => projectGround(p, elevationDeg)),
  }));
}
