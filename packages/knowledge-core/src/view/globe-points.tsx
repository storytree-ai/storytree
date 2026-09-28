import type { GlobePoint } from "../shelves/positions.js";
import type { RecordEnvelope } from "@storytree/library";
import { Line } from "@react-three/drei";
import { Color, Quaternion, Vector3 } from "three";
import { noteTitle, type Lighting, type Trail } from "../look-inside/look-inside.js";

const noRaycast = () => {};

/** Mesh raycasts stay disabled: the globe picks these small dots in screen space. */
export function GlobePoints({ points, radius, notes, lit = new Map(), trails = [] }: {
  points: readonly GlobePoint[]; radius: number; notes: ReadonlyMap<string, RecordEnvelope>;
  /** Notes a running session read, in its colour; a shared one gets a halo (ADR-0738). */
  lit?: ReadonlyMap<string, Lighting>;
  /** Each session's reading path, one curve per step, pointing to the later read (ADR-0740). */
  trails?: readonly Trail[];
}) {
  const at = new Map(points.map(point => [point.id, point.at]));
  return <group name="knowledge-points">
    {trails.map(trail => {
      const from = at.get(trail.from), to = at.get(trail.to);
      return from === undefined || to === undefined ? null
        : <TrailCurve key={`${trail.colour} ${trail.from} ${trail.to}`} trail={trail} from={from} to={to} radius={radius} />;
    })}
    {points.map(point => <mesh key={point.id} name={`knowledge-point:${point.id}`}
      position={[point.at.x, point.at.y, point.at.z]} raycast={noRaycast}
      userData={{ id: point.id, title: notes.has(point.id) ? noteTitle(notes.get(point.id)!) : point.id, depth: point.depth ?? null, home: point.home ?? null,
        lit: lit.get(point.id)?.colour ?? null, shared: lit.get(point.id)?.shared ?? false }}>
      <sphereGeometry args={[radius * (lit.has(point.id) ? 0.009 : 0.006), 12, 8]} />
      <meshBasicMaterial color={lit.get(point.id)?.colour ?? "#a5c5d1"} transparent opacity={lit.has(point.id) ? 1 : lit.size > 0 ? 0.3 : 0.52} depthWrite={false} />
      {lit.get(point.id)?.shared && <mesh raycast={noRaycast}>
        <sphereGeometry args={[radius * 0.017, 12, 8]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.22} depthWrite={false} />
      </mesh>}
    </mesh>)}
  </group>;
}

const STEPS = 24;
const UP = new Vector3(0, 1, 0);

/**
 * One step of a reading path: a quadratic Bezier bowed away from the globe's centre, so it never
 * lies along a stored link, fading from dim at the earlier read to full colour at the later one,
 * with an arrowhead just short of the later read (ADR-0740 D1, D3).
 */
function TrailCurve({ trail, from, to, radius }: { trail: Trail; from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number }; radius: number }) {
  const a = new Vector3(from.x, from.y, from.z), b = new Vector3(to.x, to.y, to.z);
  const middle = a.clone().add(b).multiplyScalar(0.5);
  const outward = middle.lengthSq() === 0 ? UP.clone() : middle.clone().normalize();
  const control = middle.add(outward.multiplyScalar(a.distanceTo(b) * 0.3));
  const at = (t: number) => a.clone().multiplyScalar((1 - t) ** 2).add(control.clone().multiplyScalar(2 * t * (1 - t))).add(b.clone().multiplyScalar(t * t));
  const points = Array.from({ length: STEPS + 1 }, (_, index) => at(index / STEPS));
  const full = new Color(trail.colour);
  const dim = full.clone().multiplyScalar(0.25);
  const colours = points.map((_, index) => dim.clone().lerp(full, index / STEPS).toArray() as [number, number, number]);
  const tip = at(0.92), tail = at(0.86);
  const turn = new Quaternion().setFromUnitVectors(UP, tip.clone().sub(tail).normalize());
  return <group name={`knowledge-trail:${trail.from}>${trail.to}`} userData={{ from: trail.from, to: trail.to, colour: trail.colour }}>
    <Line points={points} vertexColors={colours} lineWidth={1.6} transparent opacity={0.85} depthWrite={false} raycast={noRaycast} />
    <mesh position={tip} quaternion={turn} raycast={noRaycast}>
      <coneGeometry args={[radius * 0.006, radius * 0.018, 8]} />
      <meshBasicMaterial color={full} transparent opacity={0.9} depthWrite={false} />
    </mesh>
  </group>;
}
