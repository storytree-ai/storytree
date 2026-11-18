import { Matrix4, Vector3, type BufferAttribute, type Mesh } from "three";
import type { RootState } from "@react-three/fiber";

type P = { x: number; z: number };
export type ReadDock = { at: P; sea: P; lanes: { key: string; dir: "up" | "down" }[] };
const SAME = 0.5, MERGE = 8, OUT = 10;
const NEAR = 2, RISE = 1, OFF = 6;
const toSegment = (p: P, a: P, b: P) => {
  const dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
};

const inPolygon = (p: P, poly: readonly P[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
};

export function laneLine(state: RootState, story: string, coast: readonly (readonly P[])[], key: string, step = 10) {
  const root = state.scene.getObjectByName(`planet:${story}`)?.getObjectByName("territory-land")?.parent;
  let mesh: Mesh | undefined;
  state.scene.getObjectByName("pathways:selection-lanes")?.traverse(o => { if (!mesh && o.name.startsWith("lane:") && `${o.userData.from}->${o.userData.to}` === key) mesh = o as Mesh; });
  if (!root || !mesh) return undefined;
  root.updateMatrixWorld(true); mesh.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(root.matrixWorld).invert(), at = mesh.geometry.getAttribute("position") as BufferAttribute, out: string[] = [];
  for (let i = 0; i + 1 < at.count; i += 2 * step) {
    const a = new Vector3(at.getX(i), at.getY(i), at.getZ(i)).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
    out.push(`${a.x.toFixed(0)},${a.z.toFixed(0)},${a.y.toFixed(1)}${coast.some(loop => inPolygon({ x: a.x, z: a.z }, loop)) ? "L" : ""}`);
  }
  return out.join(" ");
}

export function readDocks(state: RootState, story: string, coast: readonly (readonly P[])[]): ReadDock[] {
  const land = state.scene.getObjectByName(`planet:${story}`)?.getObjectByName("territory-land");
  if (!land?.parent) return [];
  const root = land.parent; root.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(root.matrixWorld).invert();
  const onLand = (p: P) => coast.reduce((inside, loop) => inPolygon(p, loop) ? !inside : inside, false);
  const found: { at: P; sea: P; key: string; dir: "up" | "down" }[] = [];
  const seen = new Set<string>();
  state.scene.getObjectByName("pathways:selection-lanes")?.traverse(o => {
    if (!o.name.startsWith("lane:")) return;
    const key = `${o.userData.from}->${o.userData.to}`;
    if (seen.has(key)) return; seen.add(key);
    const mesh = o as Mesh, at = mesh.geometry.getAttribute("position") as BufferAttribute;
    mesh.updateMatrixWorld(true);
    const line: P[] = [], ys: number[] = [];
    for (let i = 0; i + 1 < at.count; i += 2) {
      const a = new Vector3(at.getX(i), at.getY(i), at.getZ(i)).add(new Vector3(at.getX(i + 1), at.getY(i + 1), at.getZ(i + 1))).multiplyScalar(0.5);
      a.applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
      line.push({ x: a.x, z: a.z }); ys.push(a.y);
    }
    const ashore = (p: P) => onLand(p) || coast.some(loop => loop.some((a, i) => toSegment(p, a, loop[(i + 1) % loop.length]!) < NEAR));
    const ownEnd = ashore(line.at(-1)!) ? "end" : ashore(line[0]!) ? "start" : undefined;
    if (!ownEnd) return;
    const order = line.map((_, i) => i); if (ownEnd === "start") order.reverse();
    const wet = order.filter(i => !onLand(line[i]!)).map(i => ys[i]!).sort((x, y) => x - y), seaY = wet.length ? wet[Math.floor(wet.length / 2)]! : -Infinity;
    const high = (i: number) => ys[i]! > seaY + RISE;
    const near = (p: P) => onLand(p) || coast.some(loop => loop.some((a, i) => toSegment(p, a, loop[(i + 1) % loop.length]!) < OFF));
    const isle = (k: number) => high(order[k]!) && near(line[order[k]!]!);
    let j = order.length - 1;
    while (j > 0 && isle(j - 1)) j--;
    const lo = line[order[j]!]!;
    let sea = lo, walked = 0;
    for (let k = j - 1; k > 0 && walked < OUT; k--) { const a = line[order[k]!]!, b = line[order[k - 1]!]!; walked += Math.hypot(a.x - b.x, a.z - b.z); sea = b; }
    found.push({ at: lo, sea, key, dir: o.userData.dir });
  });
  const own: ReadDock[] = [];
  for (const f of found) {
    const d = own.find(d => Math.hypot(d.at.x - f.at.x, d.at.z - f.at.z) < SAME);
    if (d) d.lanes.push({ key: f.key, dir: f.dir }); else own.push({ at: f.at, sea: f.sea, lanes: [{ key: f.key, dir: f.dir }] });
  }
  const docks: ReadDock[] = [];
  for (const o of own.sort((a, b) => b.lanes.length - a.lanes.length)) {
    const d = docks.find(d => Math.hypot(d.at.x - o.at.x, d.at.z - o.at.z) < MERGE);
    if (d) d.lanes.push(...o.lanes); else docks.push(o);
  }
  return docks.sort((a, b) => b.lanes.length - a.lanes.length).map(d => ({ at: { x: +d.at.x.toFixed(2), z: +d.at.z.toFixed(2) }, sea: { x: +d.sea.x.toFixed(2), z: +d.sea.z.toFixed(2) }, lanes: d.lanes }));
}
