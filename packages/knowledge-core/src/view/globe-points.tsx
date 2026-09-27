import type { GlobePoint } from "../shelves/positions.js";

const noRaycast = () => {};

/** K1's faint points leave the land, shell, labels and island picking in charge. */
export function GlobePoints({ points, radius }: { points: readonly GlobePoint[]; radius: number }) {
  return <group name="knowledge-points">
    {points.map(point => <mesh key={point.id} name={`knowledge-point:${point.id}`}
      position={[point.at.x, point.at.y, point.at.z]} raycast={noRaycast}
      userData={{ id: point.id, depth: point.depth ?? null, home: point.home ?? null }}>
      <sphereGeometry args={[radius * 0.006, 12, 8]} />
      <meshBasicMaterial color="#a5c5d1" transparent opacity={0.52} depthWrite={false} />
    </mesh>)}
  </group>;
}
