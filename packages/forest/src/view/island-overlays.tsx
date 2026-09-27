/** Names, claims and selection use the same drawing on flat ground and on a globe plate. */
import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useState, type ComponentProps } from "react";
import { DoubleSide } from "three";
import type { Island, Marker } from "@storytree/forest";
import { GROUND_PER_WORLD_UNIT, islandReach, parcelSpots, type Descriptor3D } from "@storytree/forest-world";

const NAME_HEIGHT = 30;
const MARKER_HEIGHT = 24;

/** Keep an overlay's host stable when Canvas disconnects its events during project switching. */
export function Overlay(props: ComponentProps<typeof Html>) {
  const gl = useThree((state) => state.gl);
  const [portal] = useState(() => ({ current: gl.domElement.parentElement! }));
  return <Html {...props} portal={portal} />;
}

/** Where an island's middle is, in 0.2 ground units. */
const centreOf = (island: Island): { x: number; z: number } => ({ x: island.x * GROUND_PER_WORLD_UNIT, z: island.z * GROUND_PER_WORLD_UNIT });

/** Each story's name over its island, facing the viewer as the camera pans and zooms (3.4). */
export function Names({ islands, selected, onGlobe = false }: { islands: readonly Island[]; selected: string | undefined; onGlobe?: boolean }) {
  return islands.map((island) => {
    const { x, z } = centreOf(island);
    return (
      <Overlay occlude={onGlobe} key={island.story} position={[x, NAME_HEIGHT, z]} center zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
        <div className={`forest-label${onGlobe ? " planet-label" : ""}${island.story === selected ? " selected" : ""}`} data-story-id={island.story}>
          {island.title}
        </div>
      </Overlay>
    );
  });
}

/** Which agent holds which capability, over that capability's tree (capability 5). */
export function Claims({ markers, descriptors, occlude = false }: { markers: readonly Marker[]; descriptors: readonly Descriptor3D[]; occlude?: boolean }) {
  const spots = parcelSpots(descriptors);
  return markers.map((marker) => {
    const spot = spots.get(marker.capability);
    if (spot === undefined) return null;
    return (
      <Overlay occlude={occlude} key={`${marker.capability}:${marker.text}`} position={[spot.x, MARKER_HEIGHT, spot.z]} center zIndexRange={[30, 20]} style={{ pointerEvents: "none" }}>
        <div
          className={`forest-claim${marker.faded ? " faded" : ""}${marker.hooksNotRunning ? " no-hooks" : ""}`}
          data-capability-id={marker.capability}
          title={marker.faded ? "quiet past the quiet time: it still holds this capability" : ""}
        >
          {marker.hooksNotRunning ? `${marker.text} · hooks not running` : marker.text}
        </div>
      </Overlay>
    );
  });
}

/** A ring on the water round the selected island (3.3). */
export function SelectionRing({ island, descriptors, onGlobe = false }: { island: Island | undefined; descriptors: readonly Descriptor3D[]; onGlobe?: boolean }) {
  if (island === undefined) return null;
  const centre = centreOf(island);
  const reach = islandReach(descriptors, new Map([[island.story, centre]])).get(island.story) ?? 20;
  return (
    <mesh raycast={() => {}} position={[centre.x, 0.4, centre.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
      <ringGeometry args={[reach + 3, reach + 5, 96]} />
      <meshBasicMaterial color="#ffd75e" side={DoubleSide} depthTest={onGlobe} transparent opacity={0.9} />
    </mesh>
  );
}
