import type { GlobePoint } from "../shelves/positions.js";
import type { RecordEnvelope } from "@storytree/library";
import { noteTitle, type Lighting } from "../look-inside/look-inside.js";

const noRaycast = () => {};

/** Mesh raycasts stay disabled: the globe picks these small dots in screen space. */
export function GlobePoints({ points, radius, notes, lit = new Map() }: {
  points: readonly GlobePoint[]; radius: number; notes: ReadonlyMap<string, RecordEnvelope>;
  /** Notes a running session read, in its colour; a shared one gets a halo (ADR-0738). */
  lit?: ReadonlyMap<string, Lighting>;
}) {
  return <group name="knowledge-points">
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
