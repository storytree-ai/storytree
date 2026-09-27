import type { GlobePoint } from "../shelves/positions.js";
import type { RecordEnvelope } from "@storytree/library";
import { noteTitle } from "../look-inside/look-inside.js";

const noRaycast = () => {};

/** Mesh raycasts stay disabled: the globe picks these small dots in screen space. */
export function GlobePoints({ points, radius, notes }: { points: readonly GlobePoint[]; radius: number; notes: ReadonlyMap<string, RecordEnvelope> }) {
  return <group name="knowledge-points">
    {points.map(point => <mesh key={point.id} name={`knowledge-point:${point.id}`}
      position={[point.at.x, point.at.y, point.at.z]} raycast={noRaycast}
      userData={{ id: point.id, title: notes.has(point.id) ? noteTitle(notes.get(point.id)!) : point.id, depth: point.depth ?? null, home: point.home ?? null }}>
      <sphereGeometry args={[radius * 0.006, 12, 8]} />
      <meshBasicMaterial color="#a5c5d1" transparent opacity={0.52} depthWrite={false} />
    </mesh>)}
  </group>;
}
