/** Capability 3 · Story node render. The globe's nameplates and selection rings, drawn on each island's plate. */
import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties } from "react";
import { DoubleSide, Quaternion, RingGeometry, type Group, type Mesh, type MeshBasicMaterial } from "three";
import { ringPulse, type Island } from "@storytree/forest";
import { LANE_COLOUR } from "@storytree/forest-world/geometry";
import { globeOccluder, onIslandSurface, plateTransform, type PlanetSpot } from "@storytree/forest-world/planet";
import { territories, type Coast } from "../territories/territories.js";
import { capabilityPlates, facing, fadedCapabilities, fadedPlates, southOnPlate, STORY_PLATE_WIDTH, storyPlate } from "./nameplates.js";
import { islandProgress } from "./island-progress.js";
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
 * A story's nameplate, its top edge at a fixed point just south of the island's coast, turning with the island; while the story is
 * selected, a smaller nameplate on each of its capabilities' territories, and the other stories' plates dim. No plate takes a pointer from the land beneath it.
 */
export function Nameplates({ island, spot, coast, radius, selected, dimmed = false }: {
  island: Island; spot: PlanetSpot; coast: Coast; radius: number; selected: string | undefined; dimmed?: boolean;
}) {
  // Plates hide behind the sphere only (whatever radius it has grown to): one exact test each, not a raycast of the land.
  const occluder = useMemo(() => [{ current: globeOccluder(radius) }], [radius]);
  const surface = useMemo(() => onIslandSurface(radius, PLATE_LIFT), [radius]);
  // Placed once on the island's own plate, like print on a map: it moves only as the island does (ADR-0917).
  const at = useMemo(() => surface(storyPlate(coast, southOnPlate(plateTransform(spot, radius).quaternion))).toArray(), [surface, coast, spot, radius]);
  const anchor = useRef<Group>(null);
  const label = useRef<HTMLDivElement>(null);
  const camera = useThree(state => state.camera);
  const turned = useMemo(() => new Quaternion(), []);
  useFrame(() => {
    const group = anchor.current;
    if (group?.parent == null) return;
    group.parent.getWorldQuaternion(turned);
    if (label.current === null) return;
    const faces = facing(turned, camera.quaternion);
    label.current.style.visibility = faces > 0 ? "" : "hidden";
    label.current.dataset.facing = String(faces);
  }, -1);
  const chosen = island.story === selected;
  const plates = useMemo(() => chosen && island.land !== undefined ? capabilityPlates(territories(island.land.territories, coast)) : [], [chosen, island.land, coast]);
  const progress = islandProgress(island);
  const opacity = dimmed ? 0.24 : selected !== undefined && !chosen ? 0.5 : 1;
  // Its opacity is a variable, so a crowded plate's fade (styles.css) can take it to nothing and back.
  const plateStyle = { "--plate-opacity": opacity, maxWidth: STORY_PLATE_WIDTH } as CSSProperties;
  return <>
    <group ref={anchor} position={at}>
      <Overlay occlude={occluder} zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
        <div ref={label} className={`forest-label planet-nameplate${chosen ? " selected" : ""}${progress !== undefined ? " with-progress" : ""}`} data-story-id={island.story} data-dimmed={dimmed ? "" : undefined} style={plateStyle}>
          <span className="planet-nameplate-title">{island.title}</span>
          {progress !== undefined && <span className="planet-progress">
            {progress.landed} / {progress.total} landed
            <span className="planet-progress-meter" aria-hidden="true"><span style={{ width: `${progress.landed / progress.total * 100}%` }} /></span>
          </span>}
        </div>
      </Overlay>
    </group>
    {plates.map(plate => <Overlay key={plate.capability} occlude={occluder} position={surface(plate).toArray()} center zIndexRange={[25, 21]} style={{ pointerEvents: "none" }}>
      <div className="forest-label planet-nameplate capability" data-capability-id={plate.capability} data-size={plate.size}>{plate.title}</div>
    </Overlay>)}
  </>;
}

/** Fade the names that overlap another or the Sessions strip whenever the globe draws: no name moves to clear another (ADR-0917). */
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
    // Turned away, or hidden behind the sphere: not on screen to crowd another.
    const onScreen = (label: HTMLElement) => label.style.visibility !== "hidden" && label.getBoundingClientRect().width > 0;
    const labels = [...host.querySelectorAll<HTMLElement>(".planet-nameplate[data-story-id]")];
    const shown = labels.filter(onScreen).map(label => ({ story: label.dataset.storyId!, box: label.getBoundingClientRect(),
      facing: Number(label.dataset.facing ?? 0), dimmed: label.dataset.dimmed !== undefined }));
    const stripBox = strip.current?.getBoundingClientRect();
    const faded = fadedPlates(shown, selected, stripBox && stripBox.width > 0 && stripBox.height > 0 ? stripBox : undefined);
    for (const label of labels) label.classList.toggle("crowded", faded.has(label.dataset.storyId!));
    const capabilities = [...host.querySelectorAll<HTMLElement>(".planet-nameplate.capability")];
    const fadedNames = fadedCapabilities(capabilities.filter(onScreen).map(label => ({ capability: label.dataset.capabilityId!,
      box: label.getBoundingClientRect(), size: Number(label.dataset.size ?? 0) })));
    for (const label of capabilities) label.classList.toggle("crowded", fadedNames.has(label.dataset.capabilityId!));
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

/** A neighbour of the selected story, ringed in its relation's lane colour, pulsing in once when a lane's front
 * reaches its dock (`reached` holds its story then; contract 3.27). */
export function NeighbourRing({ island, descriptors, relation, reached }: { island: Island; descriptors: readonly Descriptor3D[]; relation: "up" | "down"; reached: ReadonlySet<string> }) {
  const centre = centreOf(island);
  const reach = islandReach(descriptors, new Map([[island.story, centre]])).get(island.story) ?? 20;
  const { clock, invalidate } = useThree();
  const mesh = useRef<Mesh>(null);
  const started = useRef<{ at: number | undefined; reduced: boolean }>({ at: undefined, reduced: reducedMotion() });
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
    if (started.current.at === undefined && reached.has(island.story)) started.current.at = clock.getElapsedTime();
    const { at, reduced } = started.current;
    if (mesh.current) mesh.current.visible = at !== undefined;
    if (at === undefined) return;
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
    <mesh ref={mesh} name={`neighbour-ring:${relation}:${island.story}`} raycast={() => {}} visible={false} position={[centre.x, 0.4, centre.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}
      geometry={ringFor(ringPulse(0, started.current.reduced).width)} dispose={null}>
      <meshBasicMaterial color={LANE_COLOUR[relation]} side={DoubleSide} transparent opacity={0.9 * ringPulse(0, started.current.reduced).opacity} forceSinglePass />
    </mesh>
  );
}
