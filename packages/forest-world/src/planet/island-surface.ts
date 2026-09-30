/** An island as ADR-0804 D1 draws it: one flat, pale, see-through surface with a coast line (a thin band).
 * No pines, plants or banded land colour. The surface is the island's coast filled in and bent onto
 * the globe's sphere (so it lies on the glass, not on a tangent plane that lifts off at its edges),
 * in the plate's local frame: origin at PLATE_CLEARANCE above the shell, +y out of the sphere.
 * Later increments lay capability territories and file circles on it, and dive lines through it into
 * the knowledge core, so it writes no depth and stays faint. */
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, ShapeUtils, Vector2 } from 'three';
import type { CoastPoint } from '../coast-clip.js';
import { PLATE_CLEARANCE } from './planet.js';

/** Pale enough to read as a surface on the dark sea, faint enough to see a line dive through it. */
export const ISLAND_GROUND_COLOUR = '#edf3f5';
export const ISLAND_GROUND_OPACITY = 0.4;
export const ISLAND_COAST_COLOUR = '#f7fafb';
export const ISLAND_COAST_OPACITY = 0.95;
/** The coast line's width in ground units: about 1.6 pixels at the globe's resting view, thicker as you zoom in. */
export const ISLAND_COAST_WIDTH = 0.9;
/** Longest edge of the ground's triangles, in ground units: at the globe's radius a chord this long sags 0.03. */
const MAX_EDGE = 8;

interface Pt { x: number; z: number }

const area = (ring: readonly Pt[]): number =>
  ring.reduce((sum, p, i) => sum + (p.x * ring[(i + 1) % ring.length]!.z - ring[(i + 1) % ring.length]!.x * p.z), 0) / 2;

function contains(ring: readonly Pt[], p: Pt): boolean {
  let yes = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) yes = !yes;
  }
  return yes;
}

/** The rim's loops as filled parts: a loop nested inside another is a hole in it, else a part of its own. */
function parts(coast: readonly (readonly Pt[])[]): { outer: readonly Pt[]; holes: (readonly Pt[])[] }[] {
  const loops = coast.filter(ring => ring.length >= 3);
  const depth = (ring: readonly Pt[]) => loops.filter(other => other !== ring && contains(other, ring[0]!)).length;
  const outers = loops.filter(ring => depth(ring) % 2 === 0);
  return outers.map(outer => ({ outer, holes: loops.filter(ring => depth(ring) % 2 === 1 && contains(outer, ring[0]!)) }));
}

/** The vertex list and triangles of the flat ground, every long edge halved (both sides alike, so no cracks). */
function tessellate(coast: readonly (readonly Pt[])[]): { points: Pt[]; triangles: number[] } {
  const points: Pt[] = [];
  let triangles: number[] = [];
  for (const { outer, holes } of parts(coast)) {
    const base = points.length;
    const contour = outer.map(p => new Vector2(p.x, p.z)), cut = holes.map(hole => hole.map(p => new Vector2(p.x, p.z)));
    for (const ring of [outer, ...holes]) points.push(...ring.map(p => ({ x: p.x, z: p.z })));
    for (const [a, b, c] of ShapeUtils.triangulateShape(contour, cut)) {
      // Wind every triangle so its normal points out of the sphere (+y).
      const pa = points[base + a!]!, pb = points[base + b!]!, pc = points[base + c!]!;
      const up = (pb.z - pa.z) * (pc.x - pa.x) - (pb.x - pa.x) * (pc.z - pa.z) > 0;
      triangles.push(base + a!, base + (up ? b! : c!), base + (up ? c! : b!));
    }
  }
  const middle = new Map<string, number>();
  const length = (a: number, b: number) => Math.hypot(points[a]!.x - points[b]!.x, points[a]!.z - points[b]!.z);
  const split = (a: number, b: number): number | undefined => {
    if (length(a, b) <= MAX_EDGE) return undefined;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    let m = middle.get(key);
    if (m === undefined) {
      m = points.push({ x: (points[a]!.x + points[b]!.x) / 2, z: (points[a]!.z + points[b]!.z) / 2 }) - 1;
      middle.set(key, m);
    }
    return m;
  };
  for (let again = true; again;) {
    again = false;
    const next: number[] = [];
    for (let i = 0; i < triangles.length; i += 3) {
      const [a, b, c] = [triangles[i]!, triangles[i + 1]!, triangles[i + 2]!];
      const ab = split(a, b), bc = split(b, c), ca = split(c, a);
      if (ab === undefined && bc === undefined && ca === undefined) { next.push(a, b, c); continue; }
      again = true;
      if (ab !== undefined && bc !== undefined && ca !== undefined) next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
      else if (ab !== undefined && bc !== undefined) next.push(ab, b, bc, a, ab, c, ab, bc, c);
      else if (bc !== undefined && ca !== undefined) next.push(bc, c, ca, b, bc, a, bc, ca, a);
      else if (ca !== undefined && ab !== undefined) next.push(ca, a, ab, c, ca, b, ca, ab, b);
      else if (ab !== undefined) next.push(a, ab, c, ab, b, c);
      else if (bc !== undefined) next.push(b, bc, a, bc, c, a);
      else next.push(c, ca!, b, ca!, a, b);
    }
    triangles = next;
  }
  return { points, triangles };
}

export function islandSurface(coast: readonly (readonly CoastPoint[])[], radius: number, story: string): Group {
  const sphere = radius + PLATE_CLEARANCE;
  // Plate-local height of the sphere under (x, z): 0 at the plate's centre, bending away from it.
  const heightAt = (x: number, z: number) => Math.sqrt(Math.max(sphere * sphere - x * x - z * z, 0)) - sphere;
  const group = new Group();
  group.name = `island-surface:${story}`;
  const { points, triangles } = tessellate(coast);
  if (triangles.length > 0) {
    const geometry = new BufferGeometry();
    const position = points.flatMap(p => [p.x, heightAt(p.x, p.z), p.z]);
    // The sphere's own normal: the direction from its centre, which is (0, -sphere, 0) in this frame.
    const normal = points.flatMap(p => { const y = heightAt(p.x, p.z) + sphere; return [p.x / sphere, y / sphere, p.z / sphere]; });
    geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(normal, 3));
    geometry.setIndex(triangles);
    const ground = new Mesh(geometry, new MeshBasicMaterial({
      color: ISLAND_GROUND_COLOUR, transparent: true, opacity: ISLAND_GROUND_OPACITY, depthWrite: false, side: DoubleSide,
    }));
    ground.name = 'island-ground';
    group.add(ground);
  }
  coast.forEach((ring, index) => {
    if (ring.length < 3) return;
    // A thin band centred on the rim: two vertices per rim point, one either side, joined round the loop.
    const half = ISLAND_COAST_WIDTH / 2, position: number[] = [], indices: number[] = [];
    const flip = area(ring) < 0 ? -1 : 1;
    ring.forEach((p, i) => {
      const before = ring[(i + ring.length - 1) % ring.length]!, after = ring[(i + 1) % ring.length]!;
      const tx = after.x - before.x, tz = after.z - before.z, length = Math.hypot(tx, tz) || 1;
      const nx = flip * tz / length * half, nz = -flip * tx / length * half;
      for (const side of [1, -1]) {
        const x = p.x + side * nx, z = p.z + side * nz;
        position.push(x, heightAt(x, z), z);
      }
      const next = (i + 1) % ring.length;
      indices.push(2 * i, 2 * i + 1, 2 * next, 2 * i + 1, 2 * next + 1, 2 * next);
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
    geometry.setIndex(indices);
    const line = new Mesh(geometry, new MeshBasicMaterial({
      color: ISLAND_COAST_COLOUR, transparent: true, opacity: ISLAND_COAST_OPACITY, depthWrite: false, side: DoubleSide,
    }));
    line.name = `island-coast:${index}`;
    group.add(line);
  });
  return group;
}

/** Frees what {@link islandSurface} allocated. */
export function disposeIslandSurface(group: Group): void {
  group.traverse(object => {
    if (object instanceof Mesh) {
      object.geometry.dispose();
      (object.material as MeshBasicMaterial).dispose();
    }
  });
}
