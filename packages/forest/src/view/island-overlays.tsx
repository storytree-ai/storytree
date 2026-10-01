/** The globe's nameplates and selection rings, drawn on each island's plate. */
import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useMemo, useState, type ComponentProps } from "react";
import { DoubleSide } from "three";
import type { Island } from "@storytree/forest";
import { globeOccluder, onIslandSurface } from "@storytree/forest-world/planet";
import { territories, type Coast } from "../territories/territories.js";
import { capabilityPlates, storyPlate } from "./nameplates.js";
import { GROUND_PER_WORLD_UNIT, islandReach, type Descriptor3D } from "@storytree/forest-world";

/** Keep an overlay's host stable when Canvas disconnects its events during project switching. */
export function Overlay(props: ComponentProps<typeof Html>) {
  const gl = useThree((state) => state.gl);
  const [portal] = useState(() => ({ current: gl.domElement.parentElement! }));
  return <Html {...props} portal={portal} />;
}

/** Where an island's middle is, in 0.2 ground units. */
const centreOf = (island: Island): { x: number; z: number } => ({ x: island.x * GROUND_PER_WORLD_UNIT, z: island.z * GROUND_PER_WORLD_UNIT });

/** Lifted off the island's surface, so the sphere never hides a plate on land that faces the eye. */
const PLATE_LIFT = 2;

/**
 * A story's nameplate, its top edge just south of the island's coast, so it reads below the island while
 * north is up; while the story is selected, a smaller nameplate on each of its capabilities' territories.
 * Other stories' plates dim while one is selected. No plate takes a pointer from the land beneath it.
 */
export function Nameplates({ island, coast, spot, radius, selected, dimmed = false }: {
  island: Island; coast: Coast; spot: { x: number; y: number; z: number }; radius: number; selected: string | undefined; dimmed?: boolean;
}) {
  // Plates hide behind the sphere only (whatever radius it has grown to): one exact test each, not a raycast of the land.
  const occluder = useMemo(() => [{ current: globeOccluder(radius) }], [radius]);
  const surface = useMemo(() => onIslandSurface(radius, PLATE_LIFT), [radius]);
  const at = useMemo(() => surface(storyPlate(coast, spot)).toArray(), [surface, coast, spot.x, spot.y, spot.z]);
  const chosen = island.story === selected;
  const plates = useMemo(() => chosen && island.land !== undefined ? capabilityPlates(territories(island.land.territories, coast)) : [], [chosen, island.land, coast]);
  const opacity = dimmed ? 0.24 : selected !== undefined && !chosen ? 0.5 : 1;
  return <>
    <Overlay occlude={occluder} position={at} zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
      <div className={`forest-label planet-nameplate${chosen ? " selected" : ""}`} data-story-id={island.story} style={{ opacity }}>{island.title}</div>
    </Overlay>
    {plates.map(plate => <Overlay key={plate.capability} occlude={occluder} position={surface(plate).toArray()} center zIndexRange={[25, 21]} style={{ pointerEvents: "none" }}>
      <div className="forest-label planet-nameplate capability" data-capability-id={plate.capability}>{plate.title}</div>
    </Overlay>)}
  </>;
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
