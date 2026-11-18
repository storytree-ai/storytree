import { BufferGeometry, CircleGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, Vector3, type BufferAttribute, type Object3D } from "three";
import type { RootState } from "@react-three/fiber";
import { SHEET_RADIUS } from "@storytree/forest-world/planet";

type P = { x: number; z: number };
export type SeaKey = "continuous" | "beach";
export type Landing = { dock: P; sea: P; trunkWidth: number };
export type SeaInput = {
  key: SeaKey; root: Object3D; group: Group;
  coast: readonly (readonly P[])[]; onLand: (p: P) => boolean; territoryAt: (p: P) => string | undefined;
  topAt: (p: P) => number; trunkAt: (p: P) => Color; roadLift: number;
  landings: Landing[]; light: P;
};

const SEA = new Color("#18242d"), INK = new Color("#d6cfba");
export const SEA_LOOK = {
  alpha: 0.62, lift: 0.25,
  widths: [0.36, 0.5, 0.7, 0.95],
  dash: 2.0, gap: 1.6,
  slip: { reach: 11, kerb: 0.55 },
  beach: { half: 15, slope: 10, shallows: 6, fringe: 1.6, shoal: "#2c4752" },
};
const HIDE = ["pathway:", "pathway-halo:", "pathway-plumbing:", "lane:", "lane-glow:", "lane-entrance:"];

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
const lerpP = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
const smoothstep = (t: number) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };
function cross(a: P, b: P, c: P, d: P) {
  const r = { x: b.x - a.x, z: b.z - a.z }, s = { x: d.x - c.x, z: d.z - c.z }, den = r.x * s.z - r.z * s.x;
  if (Math.abs(den) < 1e-12) return undefined;
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / den, u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : undefined;
}
function smooth(pts: P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(pts.length - 1, i + 2)]!, n = Math.max(2, Math.ceil(dist(p1, p2) * 2));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t, f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  out.push(pts.at(-1)!);
  return out;
}
function strip(pts: P[], y: (i: number) => number, width: (i: number) => number, colour: (i: number) => [Color, number]): BufferGeometry {
  const pos: number[] = [], col: number[] = [], index: number[] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!, l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / l * width(i) / 2, nz = (b.x - a.x) / l * width(i) / 2, [c, al] = colour(i);
    pos.push(p.x + nx, y(i), p.z + nz, p.x - nx, y(i), p.z - nz);
    col.push(c.r, c.g, c.b, al, c.r, c.g, c.b, al);
    if (i) index.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3)); g.setAttribute("color", new Float32BufferAttribute(col, 4)); g.setIndex(index);
  return g;
}
const vmat = () => new MeshBasicMaterial({ vertexColors: true, transparent: true, side: DoubleSide, depthWrite: false, depthTest: false, fog: false });

export function seaLanes(state: RootState, input: SeaInput) {
  const { root, group, key, onLand, topAt, trunkAt, roadLift } = input;
  const scene = state.scene;
  const hide = () => {
    scene.getObjectByName("globe-roads")?.traverse(o => {
      if (!HIDE.some(h => o.name.startsWith(h))) return;
      if (!Object.getOwnPropertyDescriptor(o, "visible")?.get) Object.defineProperty(o, "visible", { get: () => false, set: () => {}, configurable: true });
    });
    state.invalidate();
  };
  hide();

  root.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(root.matrixWorld).invert();
  const centre = new Vector3(); scene.getObjectByName("globe")!.getWorldPosition(centre); centre.applyMatrix4(inverse);
  const seaY = (p: P) => centre.y + Math.sqrt(Math.max(0, SHEET_RADIUS ** 2 - (p.x - centre.x) ** 2 - (p.z - centre.z) ** 2));

  const lit = new Map<string, "up" | "down">();
  scene.getObjectByName("pathways:selection-lanes")?.traverse(o => { if (o.name.startsWith("lane:")) lit.set(`${o.userData.from}->${o.userData.to}`, o.userData.dir); });
  type Seg = { id: string; pts: P[]; n: number; up: number; down: number };
  const segs: Seg[] = [];
  const v = new Vector3();
  scene.getObjectByName("pathways:cross-island")?.traverse(o => {
    if (!o.name.startsWith("pathway:")) return;
    const carried = (o.userData.links as string[]).map(k => lit.get(k) ?? lit.get(k.split("->").reverse().join("->"))).filter(Boolean);
    if (!carried.length) return;
    const mesh = o as Mesh, at = mesh.geometry.getAttribute("position") as BufferAttribute; mesh.updateMatrixWorld(true);
    const pts: P[] = [];
    for (let i = 0; 2 * i + 1 < at.count; i++) {
      const a = v.set(at.getX(2 * i), at.getY(2 * i), at.getZ(2 * i)).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse).clone();
      const b = v.set(at.getX(2 * i + 1), at.getY(2 * i + 1), at.getZ(2 * i + 1)).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
      pts.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    }
    segs.push({ id: o.name.slice("pathway:".length), pts, n: carried.length, up: carried.filter(d => d === "up").length, down: carried.filter(d => d === "down").length });
  });
  const cls = (n: number) => n >= 32 ? 3 : n >= 8 ? 2 : n >= 2 ? 1 : 0;
  const widthOf = (n: number) => SEA_LOOK.widths[cls(n)]!;
  const lineColour = SEA.clone().lerp(INK, SEA_LOOK.alpha);

  const coastEdges = input.coast.flatMap(loop => loop.map((a, i) => [a, loop[(i + 1) % loop.length]!] as [P, P]));
  const landings = input.landings.map(l => {
    let shore = l.sea, edge: [P, P] | undefined;
    let best = Infinity;
    for (const [a, b] of coastEdges) { const d = toSeg(l.dock, a, b); if (d < best) { best = d; edge = [a, b]; } }
    const along = (() => { const d = { x: edge![1].x - edge![0].x, z: edge![1].z - edge![0].z }, k = Math.hypot(d.x, d.z) || 1; return { x: d.x / k, z: d.z / k }; })();
    shore = (() => { const t = (l.dock.x - edge![0].x) * along.x + (l.dock.z - edge![0].z) * along.z; return { x: edge![0].x + along.x * t, z: edge![0].z + along.z * t }; })();
    const toSea = { x: l.sea.x - l.dock.x, z: l.sea.z - l.dock.z }, k = Math.hypot(toSea.x, toSea.z) || 1, out = { x: toSea.x / k, z: toSea.z / k };
    const reach = key === "continuous" ? SEA_LOOK.slip.reach : SEA_LOOK.beach.slope;
    const foot = { x: shore.x + out.x * reach, z: shore.z + out.z * reach };
    return { ...l, shore, out, foot, along, debug: { dockOn: onLand(l.dock), seaOn: onLand(l.sea), toCoast: Math.min(...coastEdges.map(([a, b]) => toSeg(l.dock, a, b))), seaToCoast: Math.min(...coastEdges.map(([a, b]) => toSeg(l.sea, a, b))) } };
  });

  const stats = { segments: segs.length, landed: 0, dashed: 0, outJoin: undefined as P | undefined };
  const lineMat = vmat(); const ends: { at: P; w: number }[] = [];
  const lead = (l: (typeof landings)[number]) => ({ x: l.foot.x + l.out.x * 5, z: l.foot.z + l.out.z * 5 });
  const drawLine = (pts: P[], w: number, dashed: boolean) => {
    let walk = 0; const runs: P[][] = [[]];
    pts.forEach((p, i) => {
      if (i) walk += dist(pts[i - 1]!, p);
      const on = !dashed || walk % (SEA_LOOK.dash + SEA_LOOK.gap) < SEA_LOOK.dash;
      if (on) runs.at(-1)!.push(p); else if (runs.at(-1)!.length) runs.push([]);
    });
    for (const run of runs) if (run.length > 1) {
      const m = new Mesh(strip(run, i => seaY(run[i]!) + SEA_LOOK.lift, () => w, () => [lineColour, 1]), lineMat); m.renderOrder = 6; m.raycast = () => {}; group.add(m);
    }
  };
  const outOnly = segs.filter(s => s.down === 0);
  const keysLanding = landings[1];
  if (keysLanding && outOnly.length) {
    stats.dashed = outOnly.length;
    const islandR = Math.max(...input.coast.flat().map(q => Math.hypot(q.x, q.z))) + 12;
    const left = [...outOnly], chain: P[] = [];
    let at = left.flatMap(s => [s.pts[0]!, s.pts.at(-1)!]).reduce((b, p) => Math.hypot(p.x, p.z) < Math.hypot(b.x, b.z) ? p : b);
    while (left.length) {
      const k = left.findIndex(s => dist(s.pts[0]!, at) < 0.8 || dist(s.pts.at(-1)!, at) < 0.8);
      if (k < 0) break;
      const s = left.splice(k, 1)[0]!, pts = dist(s.pts[0]!, at) < 0.8 ? s.pts : [...s.pts].reverse();
      chain.push(...pts); at = pts.at(-1)!;
    }
    const out = lead(keysLanding);
    let j = -1, bestD = Infinity;
    chain.forEach((p, i) => { if (Math.hypot(p.x, p.z) > islandR && dist(p, out) < bestD) { bestD = dist(p, out); j = i; } });
    if (j >= 0) {
      stats.outJoin = chain[j];
      const via: P[] = [keysLanding.foot, out, { x: out.x + keysLanding.out.x * 5, z: out.z + keysLanding.out.z * 5 }];
      const a0 = Math.atan2(out.z, out.x), a1 = Math.atan2(chain[j]!.z, chain[j]!.x);
      let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      const r0 = Math.max(Math.hypot(out.x, out.z) + 10, islandR), steps = Math.ceil(Math.abs(da) / 0.2);
      for (let k = 1; k < steps; k++) { const a = a0 + da * k / steps, r = r0 + (Math.hypot(chain[j]!.x, chain[j]!.z) - r0) * k / steps; via.push({ x: Math.cos(a) * r, z: Math.sin(a) * r }); }
      drawLine(smooth([...via, ...chain.slice(j).filter((_, i, arr) => i % 3 === 0 || i === arr.length - 1)]), widthOf(1), true);
    }
  }
  for (const s of segs) {
    if (s.down === 0) continue;
    for (const l of landings) for (const end of [0, 1] as const) {
      const tip = end === 0 ? s.pts[0]! : s.pts.at(-1)!;
      if (dist(tip, l.dock) > 45) continue;
      const pts = end === 0 ? [...s.pts].reverse() : [...s.pts];
      const keepTo = pts.findIndex(p => dist(p, l.foot) < 12 || onLand(p));
      const kept = pts.slice(0, Math.max(2, keepTo === -1 ? pts.length : keepTo));
      s.pts = smooth([...kept.filter((_, i) => i % 3 === 0 || i === kept.length - 1), lead(l), l.foot]);
      if (end === 0) s.pts.reverse();
      stats.landed++;
    }
    const w = widthOf(s.n);
    drawLine(s.pts, w, false);
    for (const e of [s.pts[0]!, s.pts.at(-1)!]) ends.push({ at: e, w });
  }
  const joinMat = new MeshBasicMaterial({ color: lineColour, side: DoubleSide, depthWrite: false, depthTest: false, fog: false });
  for (const e of ends) {
    const w = Math.max(...ends.filter(f => dist(f.at, e.at) < 0.6).map(f => f.w));
    const g = new CircleGeometry(w / 2, 14); g.rotateX(-Math.PI / 2); const m = new Mesh(g, joinMat); m.renderOrder = 6; m.position.set(e.at.x, seaY(e.at) + SEA_LOOK.lift, e.at.z); m.raycast = () => {}; group.add(m);
  }

  const shade = (c: Color, facing: P) => { const k = ((facing.x * input.light.x + facing.z * input.light.z) / (Math.hypot(facing.x, facing.z) || 1) + 1) / 2; return c.clone().multiplyScalar(0.62 + 0.3 * k); };
  const landY = (p: P) => topAt(p) + roadLift;
  for (const l of landings) {
    const seaW = SEA_LOOK.widths.at(-1)!, w0 = l.dock === input.landings[0]!.dock ? seaW : widthOf(1);
    const up = Array.from({ length: 25 }, (_, i) => lerpP(l.foot, l.shore, i / 24));
    const onN = Math.max(2, Math.ceil(dist(l.shore, l.dock) * 2)), on = Array.from({ length: onN }, (_, i) => lerpP(l.shore, l.dock, i / (onN - 1))).slice(1);
    const way = [...up, ...on], rise = (i: number) => i < up.length ? smoothstep(i / (up.length - 1)) : 1;
    const t = (i: number) => i < up.length ? i / (up.length - 1) : 1;
    const y = (i: number) => { const p = way[i]!, r = rise(i); return seaY(p) + SEA_LOOK.lift + (landY(p) - seaY(p) - SEA_LOOK.lift) * r; };
    if (key === "continuous") {
      const kerb = SEA_LOOK.slip.kerb, slab = vmat();
      const slopeY = (i: number) => { const p = up[i]!; return seaY(p) + 0.05 + (topAt(p) - seaY(p) - 0.05) * smoothstep(i / (up.length - 1)); };
      const sw = (i: number) => l.trunkWidth + 2 * kerb + (w0 - l.trunkWidth) * 0 * i;
      const sandSlope = (i: number): [Color, number] => [trunkAt(l.shore).clone().multiplyScalar(0.86), smoothstep(i / (up.length - 1) * 2.2)];
      const m = new Mesh(strip(up, slopeY, sw, sandSlope), slab); m.renderOrder = 7; m.raycast = () => {}; group.add(m);
      const width = (i: number) => w0 + (l.trunkWidth - w0) * smoothstep(t(i) * 1.15);
      const colour = (i: number): [Color, number] => [lineColour.clone().lerp(trunkAt(way[i]!), smoothstep(t(i) * 1.2)), 1];
      const lm = new Mesh(strip(way, i => y(i) + 0.03, width, colour), vmat()); lm.renderOrder = 8; lm.raycast = () => {}; group.add(lm);
    } else {
      const B = SEA_LOOK.beach, sand = trunkAt(l.shore).clone().multiplyScalar(0.92), wet = sand.clone().lerp(SEA, 0.45), shoal = new Color(B.shoal);
      const half = l.dock === input.landings[0]!.dock ? B.half : B.half * 0.6;
      const loop = input.coast.find(lp => lp.some((q, i) => { const r = lp[(i + 1) % lp.length]!; return toSeg(l.shore, q, r) < 0.2; }))!;
      const walkCoast = (dir: 1 | -1) => {
        const n = loop.length; let i = loop.findIndex((q, k) => toSeg(l.shore, q, loop[(k + 1) % n]!) < 0.2);
        let here = l.shore, walked = 0; const out: { p: P; s: number }[] = [];
        let next = dir === 1 ? loop[(i + 1) % n]! : loop[i]!;
        while (walked < half) {
          const d = dist(here, next);
          if (d < 0.5) { here = next; i = (i + dir + n) % n; next = dir === 1 ? loop[(i + 1) % n]! : loop[i]!; walked += d; continue; }
          here = lerpP(here, next, 0.5 / d); walked += 0.5; out.push({ p: here, s: walked * dir });
        }
        return out;
      };
      const coastPts = [...walkCoast(-1).reverse(), { p: l.shore, s: 0 }, ...walkCoast(1)];
      const rows = coastPts.map((c, k) => {
        const a = coastPts[Math.max(0, k - 3)]!.p, b = coastPts[Math.min(coastPts.length - 1, k + 3)]!.p, d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        let n = { x: -(b.z - a.z) / d, z: (b.x - a.x) / d }; if (onLand({ x: c.p.x + n.x * 0.8, z: c.p.z + n.z * 0.8 })) n = { x: -n.x, z: -n.z };
        const open = input.territoryAt({ x: c.p.x - n.x * 1.2, z: c.p.z - n.z * 1.2 }) === "open" ? 1 : 0;
        return { ...c, n, taper: smoothstep((1 - Math.abs(c.s) / half) * 6) * open };
      });
      const bands: { off: number; y: (p: P) => number; colour: Color; alpha: (t: number) => number }[] = [
        { off: -B.fringe, y: p => topAt(p) + 0.03, colour: trunkAt(l.shore).clone().lerp(sand, 0.3), alpha: () => 0 },
        { off: -0.3, y: p => topAt(p) + 0.03, colour: trunkAt(l.shore).clone().lerp(sand, 0.5), alpha: t => 0.55 * t },
        { off: 0, y: p => topAt(p) + 0.02, colour: sand, alpha: t => t },
        { off: B.slope * 0.45, y: p => seaY(p) + (topAt(p) - seaY(p)) * 0.3, colour: sand.clone().lerp(wet, 0.45), alpha: t => t },
        { off: B.slope, y: p => seaY(p) + 0.06, colour: wet, alpha: t => t },
        { off: B.slope + 0.3, y: p => seaY(p) + 0.05, colour: shoal, alpha: t => t },
        { off: B.slope + B.shallows * 0.6, y: p => seaY(p) + 0.04, colour: SEA.clone().lerp(shoal, 0.6), alpha: t => 0.8 * t },
        { off: B.slope + B.shallows, y: p => seaY(p) + 0.04, colour: SEA, alpha: () => 0 },
      ];
      const pos: number[] = [], col: number[] = [], index: number[] = [];
      rows.forEach((r, k) => {
        bands.forEach(b => {
          const off = b.off > 0 ? b.off * (0.35 + 0.65 * r.taper) : b.off, q = { x: r.p.x + r.n.x * off, z: r.p.z + r.n.z * off };
          pos.push(q.x, b.off > 0 ? b.y(q) : b.y(q), q.z); col.push(b.colour.r, b.colour.g, b.colour.b, b.alpha(r.taper));
        });
        if (k) for (let j = 0; j + 1 < bands.length; j++) { const a = (k - 1) * bands.length + j, c = k * bands.length + j; index.push(a, a + 1, c, a + 1, c + 1, c); }
      });
      const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(pos, 3)); g.setAttribute("color", new Float32BufferAttribute(col, 4)); g.setIndex(index);
      const bm = new Mesh(g, vmat()); bm.renderOrder = 5; bm.raycast = () => {}; group.add(bm);
      const width = (i: number) => w0 + (l.trunkWidth - w0) * smoothstep((t(i) - 0.55) / 0.45);
      const colour = (i: number): [Color, number] => [lineColour.clone().lerp(trunkAt(way[i]!), smoothstep((t(i) - 0.45) / 0.55)), 1];
      const y2 = (i: number) => { const p = way[i]!; if (i >= up.length) return landY(p); const k = t(i), top = topAt(l.shore); return seaY(p) + SEA_LOOK.lift + (top + 0.02 - seaY(p) - SEA_LOOK.lift) * (k < 0.55 ? k / 0.55 * 0.3 : 0.3 + 0.7 * (k - 0.55) / 0.45) + 0.06; };
      const lm = new Mesh(strip(way, y2, width, colour), vmat()); lm.renderOrder = 8; lm.raycast = () => {}; group.add(lm);
    }
  }
  state.invalidate();
  return { keep: hide, stats: { ...stats, landings: landings.map(l => ({ shore: l.shore, foot: l.foot, ...l.debug })) } };
}
function toSeg(p: P, a: P, b: P) {
  const dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}
