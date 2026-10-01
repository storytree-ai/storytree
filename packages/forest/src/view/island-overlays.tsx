/** Names and selection use the same drawing on flat ground and on a globe plate. */
import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useMemo, useState, type ComponentProps } from "react";
import { DoubleSide } from "three";
import { PLANET_RADIUS, type Island } from "@storytree/forest";
import { globeOccluder } from "@storytree/forest-world/planet";
import { GROUND_PER_WORLD_UNIT, islandReach, type Descriptor3D } from "@storytree/forest-world";

const NAME_HEIGHT = 30;

/** Keep an overlay's host stable when Canvas disconnects its events during project switching. */
export function Overlay(props: ComponentProps<typeof Html>) {
  const gl = useThree((state) => state.gl);
  const [portal] = useState(() => ({ current: gl.domElement.parentElement! }));
  return <Html {...props} portal={portal} />;
}

/** Where an island's middle is, in 0.2 ground units. */
const centreOf = (island: Island): { x: number; z: number } => ({ x: island.x * GROUND_PER_WORLD_UNIT, z: island.z * GROUND_PER_WORLD_UNIT });

/** Each story's name over its island, facing the viewer as the camera pans and zooms (3.4). */
export function Names({ islands, selected, onGlobe = false, dimmed = false, radius = PLANET_RADIUS }: { islands: readonly Island[]; selected: string | undefined; onGlobe?: boolean; dimmed?: boolean; radius?: number }) {
  // Names on the globe hide behind the sphere only (whatever radius it has grown to): one exact test each, not a raycast of every pine.
  const occluder = useMemo(() => [{ current: globeOccluder(radius) }], [radius]);
  return islands.map((island) => {
    const { x, z } = centreOf(island);
    return (
      <Overlay occlude={onGlobe ? occluder : false} key={island.story} position={[x, NAME_HEIGHT, z]} center zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
        <div className={`forest-label${onGlobe ? " planet-label" : ""}${island.story === selected ? " selected" : ""}`} data-story-id={island.story} style={{ opacity: dimmed ? 0.24 : 1 }}>
          {island.title}
        </div>
      </Overlay>
    );
  });
}

/** A ring on the water round the selected island (3.3). */
export function SelectionRing({ island, descriptors, onGlobe = false, emphasis = false }: { island: Island | undefined; descriptors: readonly Descriptor3D[]; onGlobe?: boolean; emphasis?: boolean }) {
  if (island === undefined) return null;
  const centre = centreOf(island);
  const reach = islandReach(descriptors, new Map([[island.story, centre]])).get(island.story) ?? 20;
  return (
    <mesh name={emphasis ? `session-highlight:${island.story}` : ""} raycast={() => {}} position={[centre.x, 0.4, centre.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
      <ringGeometry args={[reach + 3, reach + 5, 96]} />
      <meshBasicMaterial color={emphasis ? "#edf4ee" : "#ffd75e"} side={DoubleSide} depthTest={onGlobe} transparent opacity={0.9} forceSinglePass />
    </mesh>
  );
}
