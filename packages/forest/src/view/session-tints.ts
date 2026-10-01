/**
 * Capability 5 · Agent capability claims, as drawn since ADR-0804 D9: a running session's arc of its
 * island's coast, in its colour, laid just inside the coast line. One band per session, named
 * `coast-tint:<session>`. Plain three.js, so the marks are read without a browser.
 */
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, type Vector3 } from "three";
import type { CoastArc } from "@storytree/forest";

type Point = { readonly x: number; readonly z: number };

/** How wide the tint runs, in plate units: a little wider than the coast line, so the colour reads beside it. */
const TINT_WIDTH = 1.6;
const TINT_OPACITY = 0.9;
const FADED_OPACITY = 0.35;

/** Each session's arc of the island's longest coast loop, placed on the surface by `onSurface`. */
export function coastTintMarks(coast: readonly (readonly Point[])[], arcs: readonly CoastArc[], onSurface: (point: Point) => Vector3): Group {
  const group = new Group();
  group.name = "coast-tints";
  const ring = [...coast].sort((a, b) => length(b) - length(a))[0];
  if (ring === undefined || ring.length < 3) return group;
  const total = length(ring);
  // Inward is toward the loop's own middle side: the sign of its area says which way it winds.
  const turn = Math.sign(ring.reduce((sum, p, at) => { const q = ring[(at + 1) % ring.length]!; return sum + p.x * q.z - q.x * p.z; }, 0)) || 1;
  for (const arc of arcs) {
    const path = stretch(ring, arc.from * total, arc.to * total);
    const position: number[] = [];
    const index: number[] = [];
    path.forEach((p, at) => {
      const [a, b] = [path[Math.max(0, at - 1)]!, path[Math.min(path.length - 1, at + 1)]!];
      const [tx, tz] = [b.x - a.x, b.z - a.z];
      const size = Math.hypot(tx, tz) || 1;
      const inward = { x: (-tz / size) * turn * TINT_WIDTH, z: (tx / size) * turn * TINT_WIDTH };
      for (const q of [p, { x: p.x + inward.x, z: p.z + inward.z }]) { const v = onSurface(q); position.push(v.x, v.y, v.z); }
      if (at > 0) index.push(2 * at - 2, 2 * at - 1, 2 * at, 2 * at - 1, 2 * at + 1, 2 * at);
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
    geometry.setIndex(index);
    const band = new Mesh(geometry, new MeshBasicMaterial({ color: new Color(arc.colour), transparent: true, opacity: arc.faded ? FADED_OPACITY : TINT_OPACITY, side: DoubleSide, forceSinglePass: true, depthWrite: false }));
    band.name = `coast-tint:${arc.session}`;
    band.userData = { session: arc.session, colour: arc.colour };
    band.renderOrder = 4;
    group.add(band);
  }
  return group;
}

function length(ring: readonly Point[]): number {
  return ring.reduce((sum, p, at) => { const q = ring[(at + 1) % ring.length]!; return sum + Math.hypot(q.x - p.x, q.z - p.z); }, 0);
}

/** The points of the closed loop `ring` between `start` and `end` along it. */
function stretch(ring: readonly Point[], start: number, end: number): Point[] {
  const out: Point[] = [];
  let walked = 0;
  for (let at = 0; at < ring.length; at++) {
    const [p, q] = [ring[at]!, ring[(at + 1) % ring.length]!];
    const edge = Math.hypot(q.x - p.x, q.z - p.z);
    const along = (d: number): Point => ({ x: p.x + ((q.x - p.x) * (d - walked)) / (edge || 1), z: p.z + ((q.z - p.z) * (d - walked)) / (edge || 1) });
    if (walked + edge >= start && walked <= end) {
      if (out.length === 0) out.push(along(Math.max(start, walked)));
      out.push(along(Math.min(end, walked + edge)));
    }
    walked += edge;
  }
  return out;
}
