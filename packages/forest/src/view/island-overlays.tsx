/** Names, wisps and selection use the same drawing on flat ground and on a globe plate. */
import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useRef, useState, type ComponentProps } from "react";
import { DoubleSide, type Group } from "three";
import type { Island, SessionWisp } from "@storytree/forest";
import { GROUND_PER_WORLD_UNIT, islandReach, type Descriptor3D } from "@storytree/forest-world";
import { WispBody, WISP_LIFT } from "@storytree/forest-world/canvas";

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
export function Names({ islands, selected, onGlobe = false, dimmed = false }: { islands: readonly Island[]; selected: string | undefined; onGlobe?: boolean; dimmed?: boolean }) {
  return islands.map((island) => {
    const { x, z } = centreOf(island);
    return (
      <Overlay occlude={onGlobe} key={island.story} position={[x, NAME_HEIGHT, z]} center zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
        <div className={`forest-label${onGlobe ? " planet-label" : ""}${island.story === selected ? " selected" : ""}`} data-story-id={island.story} style={{ opacity: dimmed ? 0.24 : 1 }}>
          {island.title}
        </div>
      </Overlay>
    );
  });
}

/** 0.2's claim wisps went once round their island every nine seconds (ADR-0212). */
const ORBIT_SECONDS = 9;
/** Just outside the island's reach, so the wisp circles the shore rather than cutting the trees. */
const ORBIT_MARGIN = 6;
/** A touch larger than the engine's own sprite, so a session reads at globe distance. */
const WISP_SIZE = 1.4;

/**
 * Each session's wisp orbiting `island` (capability 5, ADR-0736): the engine's wisp body in the
 * session's colour. Hovering one names its session through `onHover`; `highlighted` swells it.
 */
export function Wisps({ wisps, island, descriptors, highlighted, onHover }: {
  wisps: readonly SessionWisp[];
  island: Island;
  descriptors: readonly Descriptor3D[];
  highlighted: string | undefined;
  onHover(session: string | undefined): void;
}) {
  const orbiting = wisps.filter(wisp => wisp.story === island.story);
  const groups = useRef<(Group | null)[]>([]);
  const centre = centreOf(island);
  const reach = islandReach(descriptors, new Map([[island.story, centre]])).get(island.story) ?? 20;
  const radius = reach + ORBIT_MARGIN;
  useFrame(state => {
    if (orbiting.length === 0) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const turn = still ? 0 : (performance.now() / 1000 / ORBIT_SECONDS) * Math.PI * 2;
    orbiting.forEach((wisp, index) => {
      const angle = turn + (wisp.phase * Math.PI) / 180;
      groups.current[index]?.position.set(centre.x + Math.cos(angle) * radius, WISP_LIFT, centre.z + Math.sin(angle) * radius);
    });
    // The canvases draw on demand, so an orbit asks for its next frame.
    if (!still) state.invalidate();
  });
  return orbiting.map((wisp, index) => {
    const lit = wisp.session === highlighted;
    return <group key={wisp.session} ref={group => { groups.current[index] = group; }} userData={{ sessionWisp: wisp.session }}>
      <WispBody colour={wisp.colour} opacity={wisp.faded && !lit ? 0.45 : 1} scale={lit ? WISP_SIZE * 1.6 : WISP_SIZE} />
      <mesh userData={{ sessionWisp: wisp.session }}
        onPointerOver={event => { event.stopPropagation(); onHover(wisp.session); }}
        onPointerOut={() => onHover(undefined)}>
        <sphereGeometry args={[7, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>;
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
      <meshBasicMaterial color={emphasis ? "#edf4ee" : "#ffd75e"} side={DoubleSide} depthTest={onGlobe} transparent opacity={0.9} />
    </mesh>
  );
}
