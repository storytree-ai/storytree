/** The globe's nameplates and selection rings, drawn on each island's plate. */
import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { DoubleSide, Quaternion, RingGeometry, type Group, type Mesh, type MeshBasicMaterial } from "three";
import { ringPulse, type Island } from "@storytree/forest";
import { LANE_COLOUR } from "@storytree/forest-world/geometry";
import { globeOccluder, onIslandSurface } from "@storytree/forest-world/planet";
import { territories, type Coast } from "../territories/territories.js";
import { capabilityPlates, facing, screenOnPlate, settlePlates, STORY_PLATE_WIDTH, storyPlate } from "./nameplates.js";
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
    if (label.current === null) return;
    const faces = facing(turned, camera.quaternion);
    label.current.style.visibility = faces > 0 ? "" : "hidden";
    label.current.dataset.facing = String(faces);
  }, -1);
  const chosen = island.story === selected;
  const plates = useMemo(() => chosen && island.land !== undefined ? capabilityPlates(territories(island.land.territories, coast)) : [], [chosen, island.land, coast]);
  const opacity = dimmed ? 0.24 : selected !== undefined && !chosen ? 0.5 : 1;
  return <>
    <group ref={anchor}>
      <Overlay occlude={occluder} zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
        <div ref={label} className={`forest-label planet-nameplate${chosen ? " selected" : ""}`} data-story-id={island.story} style={{ opacity, maxWidth: STORY_PLATE_WIDTH }}>{island.title}</div>
      </Overlay>
    </group>
    {plates.map(plate => <Overlay key={plate.capability} occlude={occluder} position={surface(plate).toArray()} center zIndexRange={[25, 21]} style={{ pointerEvents: "none" }}>
      <div className="forest-label planet-nameplate capability" data-capability-id={plate.capability}>{plate.title}</div>
    </Overlay>)}
  </>;
}

/** Settle the story names against each other and the Sessions strip whenever the globe draws. */
export function NameplateCrowd({ selected }: { selected: string | undefined }) {
  const gl = useThree(state => state.gl);
  const invalidate = useThree(state => state.invalidate);
  const strip = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const globe = gl.domElement.closest("[data-view='globe']");
    const surface = globe?.parentElement;
    if (surface == null) return;
    const resize = new ResizeObserver(() => invalidate());
    const refresh = () => {
      const next = surface.querySelector<HTMLElement>(":scope > .sessions-list, :scope > * > .sessions-list");
      if (next !== strip.current) {
        resize.disconnect();
        strip.current = next;
        if (next !== null) resize.observe(next);
      }
      // The strip's sibling host is appended first; React mounts its aside afterwards.
      mounted.disconnect();
      mounted.observe(surface, { childList: true });
      for (const child of surface.children) {
        if (child !== globe) mounted.observe(child, { childList: true });
      }
      invalidate();
    };
    const mounted = new MutationObserver(refresh);
    refresh();
    return () => {
      mounted.disconnect();
      resize.disconnect();
      strip.current = null;
    };
  }, [gl, invalidate]);
  useFrame(() => {
    const host = gl.domElement.parentElement;
    if (host === null) return;
    const labels = [...host.querySelectorAll<HTMLElement>(".planet-nameplate[data-story-id]")];
    const shown = labels.flatMap(label => {
      const box = label.getBoundingClientRect();
      // Turned away, or hidden behind the sphere: not on screen to crowd another.
      if (label.style.visibility === "hidden" || box.width === 0) return [];
      // Where it hangs, without the step it took last frame.
      const drop = Number(label.dataset.drop ?? 0);
      return [{ story: label.dataset.storyId!, box: { left: box.left, right: box.right, top: box.top - drop, bottom: box.bottom - drop }, facing: Number(label.dataset.facing ?? 0) }];
    });
    const stripBox = strip.current?.getBoundingClientRect();
    const { drops, hidden } = settlePlates(shown, selected, stripBox && stripBox.width > 0 && stripBox.height > 0 ? stripBox : undefined);
    for (const label of labels) {
      const story = label.dataset.storyId!, drop = drops.get(story) ?? 0;
      label.classList.toggle("crowded", hidden.has(story));
      if (Number(label.dataset.drop ?? 0) === drop) continue;
      label.dataset.drop = String(drop);
      label.style.setProperty("--drop", `${drop}px`);
    }
  });
  return null;
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

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A neighbour of the selected story, ringed in its relation's lane colour, pulsing in once (contract 3.27). */
export function NeighbourRing({ island, descriptors, relation }: { island: Island; descriptors: readonly Descriptor3D[]; relation: "up" | "down" }) {
  const centre = centreOf(island);
  const reach = islandReach(descriptors, new Map([[island.story, centre]])).get(island.story) ?? 20;
  const { clock, invalidate } = useThree();
  const mesh = useRef<Mesh>(null);
  const started = useRef({ at: clock.getElapsedTime(), reduced: reducedMotion() });
  // One ring per width the pulse passes through, kept until the ring goes.
  const geometries = useMemo(() => new Map<number, RingGeometry>(), [reach]);
  useEffect(() => () => geometries.forEach(geometry => geometry.dispose()), [geometries]);
  const ringFor = (pulseWidth: number) => {
    const width = Math.round(pulseWidth * 20) / 20;
    let geometry = geometries.get(width);
    if (geometry === undefined) geometries.set(width, geometry = new RingGeometry(reach + 3, reach + 3 + width, 96));
    return geometry;
  };
  useFrame(() => {
    const { at, reduced } = started.current;
    const pulse = ringPulse(clock.getElapsedTime() - at, reduced);
    if (mesh.current) {
      mesh.current.geometry = ringFor(pulse.width);
      (mesh.current.material as MeshBasicMaterial).opacity = 0.9 * pulse.opacity;
    }
    // The canvas draws on demand: ask for frames only while the pulse is still settling.
    if (pulse.opacity < 1) invalidate();
  });
  useEffect(() => invalidate(), [invalidate]);
  return (
    <mesh ref={mesh} name={`neighbour-ring:${relation}:${island.story}`} raycast={() => {}} position={[centre.x, 0.4, centre.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}
      geometry={ringFor(ringPulse(0, started.current.reduced).width)} dispose={null}>
      <meshBasicMaterial color={LANE_COLOUR[relation]} side={DoubleSide} transparent opacity={0.9 * ringPulse(0, started.current.reduced).opacity} forceSinglePass />
    </mesh>
  );
}
