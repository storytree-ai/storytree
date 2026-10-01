/** The globe's nameplates and selection rings, drawn on each island's plate. */
import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useState, type ComponentProps } from "react";
import { DoubleSide, Quaternion, type Group } from "three";
import type { Island } from "@storytree/forest";
import { globeOccluder, onIslandSurface } from "@storytree/forest-world/planet";
import { territories, type Coast } from "../territories/territories.js";
import { capabilityPlates, facesEye, screenOnPlate, storyPlate } from "./nameplates.js";
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
 * A story's nameplate, its top edge just below the island's coast as the screen sees it; while the story is
 * selected, a smaller nameplate on each of its capabilities' territories, and the other stories' plates dim. No plate takes a pointer from the land beneath it.
 */
export function Nameplates({ island, coast, radius, selected, dimmed = false }: {
  island: Island; coast: Coast; radius: number; selected: string | undefined; dimmed?: boolean;
}) {
  // Plates hide behind the sphere only (whatever radius it has grown to): one exact test each, not a raycast of the land.
  const occluder = useMemo(() => [{ current: globeOccluder(radius) }], [radius]);
  const surface = useMemo(() => onIslandSurface(radius, PLATE_LIFT), [radius]);
  // The plate hangs below its island as the screen sees it, so it follows every turn: placed each frame, before the overlay reads it.
  const anchor = useRef<Group>(null);
  const label = useRef<HTMLDivElement>(null);
  const camera = useThree(state => state.camera);
  const turned = useMemo(() => new Quaternion(), []);
  useFrame(() => {
    const group = anchor.current;
    if (group?.parent == null) return;
    group.parent.getWorldQuaternion(turned);
    // Kept on the globe, so the sphere still hides a plate whose island is edge-on at the rim.
    group.position.copy(surface(storyPlate(coast, screenOnPlate(turned, camera.quaternion), radius * 0.9)));
    group.updateMatrixWorld();
    if (label.current !== null) label.current.style.visibility = facesEye(turned, camera.quaternion) ? "" : "hidden";
  }, -1);
  const chosen = island.story === selected;
  const plates = useMemo(() => chosen && island.land !== undefined ? capabilityPlates(territories(island.land.territories, coast)) : [], [chosen, island.land, coast]);
  const opacity = dimmed ? 0.24 : selected !== undefined && !chosen ? 0.5 : 1;
  return <>
    <group ref={anchor}>
      <Overlay occlude={occluder} zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
        <div ref={label} className={`forest-label planet-nameplate${chosen ? " selected" : ""}`} data-story-id={island.story} style={{ opacity }}>{island.title}</div>
      </Overlay>
    </group>
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
