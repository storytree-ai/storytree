import { Billboard } from "@react-three/drei";

const noRaycast = () => {};

/** The gap between two arcs, in radians, so each session's colour reads as its own piece. */
const GAP = 0.35;

/**
 * The thin ring around a note several listed sessions read (ADR-0754 D2): one arc per session in
 * its colour, in the order their lines arrived, clockwise from the top, always facing the camera.
 */
export function SessionRing({ name, arcs, radius, tube }: { name: string; arcs: readonly string[]; radius: number; tube: number }) {
  const span = (2 * Math.PI) / arcs.length;
  return <Billboard name={name} userData={{ arcs: [...arcs] }}>
    {arcs.map((colour, index) => <mesh key={index} raycast={noRaycast} rotation={[0, 0, Math.PI / 2 - (index + 1) * span + GAP / 2]}>
      <torusGeometry args={[radius, tube, 6, 24, span - GAP]} />
      <meshBasicMaterial color={colour} transparent opacity={0.95} depthWrite={false} />
    </mesh>)}
  </Billboard>;
}
