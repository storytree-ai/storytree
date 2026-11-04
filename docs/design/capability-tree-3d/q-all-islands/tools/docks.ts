/** Rollout 1: where the map's own sea lanes come ashore on the selected island, read off the page (as round 7 read The
 * library's mouth and Keys' landfall by hand). Each of the selection's lanes (pathways:selection-lanes) runs from its far
 * island over the sea and inland to the capability it names; where its centre line crosses this island's coast is its
 * landfall. Lanes the map docks together share a landfall (within SAME units), and docks within MERGE units (a port and a
 * gap, round 1 clustered other islands' ports at 10) share the busier one's port. In the island's
 * plate frame, as the layout tool and the overlay read the land. */
import { Matrix4, Vector3, type BufferAttribute, type Mesh } from "three";
import type { RootState } from "@react-three/fiber";

type P = { x: number; z: number };
export type ReadDock = { at: P; sea: P; lanes: { key: string; dir: "up" | "down" }[] };
/** Landfalls this near one another are one dock, and `sea` is this far out along the lane from it, in ground units. */
const SAME = 0.5, MERGE = 8, OUT = 10;
/** A lane end this near the coast is ashore, and a lane this far above its height at sea is on the land, in ground units. */
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

/** One lane's centre line in the island's plate frame, every `step`th point, each marked on this island's land or not: to
 * see where the map runs a lane near the island. */
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
    // This island's end: the end standing on its land, or on its coast (where the map has no way inland for the lane, as
    // on a one-territory island, it ends at its dock).
    const ashore = (p: P) => onLand(p) || coast.some(loop => loop.some((a, i) => toSegment(p, a, loop[(i + 1) % loop.length]!) < NEAR));
    const ownEnd = ashore(line.at(-1)!) ? "end" : ashore(line[0]!) ? "start" : undefined;
    if (!ownEnd) return;
    const order = line.map((_, i) => i); if (ownEnd === "start") order.reverse();
    // Order now runs far end → this island's end. Over the sea the map's lane rides low, above the glass; it climbs to the
    // land's height over its last few units to its dock, and from there its way inland rides on the land. So a point is on
    // this island wherever it stands high (RISE above the lane's height at sea): over its land, or just off it where the way
    // inland crosses a bay (Session management's south coast) or rides the coast (Desktop app's east coast). A lane skimming
    // a coast at sea stays low. The dock is where the lane's last high run begins, or its end (its way inland may ride just off the coast from there).
    const wet = order.filter(i => !onLand(line[i]!)).map(i => ys[i]!).sort((x, y) => x - y), seaY = wet.length ? wet[Math.floor(wet.length / 2)]! : -Infinity;
    const high = (i: number) => ys[i]! > seaY + RISE;
    // and near this island (within OFF units of its coast), not on the far island's land at the lane's other end.
    const near = (p: P) => onLand(p) || coast.some(loop => loop.some((a, i) => toSegment(p, a, loop[(i + 1) % loop.length]!) < OFF));
    const isle = (k: number) => high(order[k]!) && near(line[order[k]!]!);
    let j = order.length - 1;
    while (j > 0 && isle(j - 1)) j--;
    const lo = line[order[j]!]!;
    // A point OUT units back along the lane, out to sea.
    let sea = lo, walked = 0;
    for (let k = j - 1; k > 0 && walked < OUT; k--) { const a = line[order[k]!]!, b = line[order[k - 1]!]!; walked += Math.hypot(a.x - b.x, a.z - b.z); sea = b; }
    found.push({ at: lo, sea, key, dir: o.userData.dir });
  });
  // The map's own docks first (landfalls at one point), then any within a port's width of a busier one share its port.
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
