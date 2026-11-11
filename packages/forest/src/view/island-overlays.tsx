/** Capability 3 · Story node render. The globe's nameplates and selection rings, drawn on each island's plate. */
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useSyncExternalStore, type CSSProperties } from "react";
import { DoubleSide, Quaternion, type Group } from "three";
import type { Island } from "@storytree/forest";
import { onIslandSurface, Overlay, plateTransform, type PlanetSpot } from "@storytree/forest-world/planet";
import type { Coast } from "../territories/territories.js";
import { islandLayout, type Link, type LinkDock } from "../territories/link-layout.js";
import { awaitingLayout, keptVersion, pageTerritorySearcher, subscribeKept } from "../territories/kept-layout.js";
import { capabilityPlates, crowdedNames, facing, southOnPlate, STORY_PLATE_WIDTH, storyPlate } from "./nameplates.js";
import { GROUND_PER_WORLD_UNIT, islandReach, type Descriptor3D } from "@storytree/forest-world";
import type { DetailStore } from "./zoom-detail.js";

/** Where an island's middle is, in 0.2 ground units. */
const centreOf = (island: Island): { x: number; z: number } => ({ x: island.x * GROUND_PER_WORLD_UNIT, z: island.z * GROUND_PER_WORLD_UNIT });

/** Lifted off the island's surface, so the sphere never hides a plate on land that faces the eye. */
const PLATE_LIFT = 2;

/**
 * A story's nameplate, its top edge at a fixed point just south of the island's coast, turning with the island; once the
 * eye is near (3.86), a smaller nameplate on each of its capabilities' territories (below a claimed one's flag); while a
 * story is selected the other stories' plates dim. No plate takes a pointer from the land beneath it.
 */
export function Nameplates({ island, spot, coast, links = [], docks, radius, selected, dimmed = false, claimed = new Map(), detail }: {
  island: Island; spot: PlanetSpot; coast: Coast; radius: number; selected: string | undefined; dimmed?: boolean;
  /** How much of the island the eye's zoom shows; without one, all of it. */
  detail?: DetailStore | undefined;
  /** The scene's links, and the docks the island's lanes come ashore at when it is laid out by them (ADR-1236 D1). */
  links?: readonly Link[]; docks?: readonly LinkDock[] | undefined;
  /** Claimed capabilities: their flags stand where their nameplates would, so those nameplates hang just below (ADR-0968 D1). */
  claimed?: ReadonlyMap<string, unknown>;
}) {
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
    // On the glass sheet nothing hides a name: it reads from either face, so the underside says whose notes are whose (ADR-1043 D3).
    label.current.dataset.facing = String(facing(turned, camera.quaternion));
  }, -1);
  const chosen = island.story === selected;
  // 3.80: the plates follow the arrangement the search kept, as the territories do.
  const kept = useSyncExternalStore(subscribeKept, keptVersion);
  const level = useSyncExternalStore(detail?.subscribe ?? NEVER, detail?.get ?? NEAR);
  // Near only: every island's names at once, from the whole map's zoom, cost the page a frame in two (evidence/zoom-detail).
  const named = level === "near";
  // 3.95: an island awaiting the search that places every territory names none, and says it is laying them out.
  const searcher = useMemo(() => pageTerritorySearcher(), []);
  const awaiting = island.land !== undefined && awaitingLayout(island.story, island.land.territories, searcher);
  const plates = useMemo(() => named && !awaiting && island.land !== undefined ? capabilityPlates(islandLayout(island.story, island.land.territories, coast, links, docks)) : [], [named, awaiting, island.story, island.land, coast, links, docks, kept]);
  const opacity = dimmed ? 0.24 : selected !== undefined && !chosen ? 0.5 : 1;
  // Its opacity is a variable, so a crowded plate's fade (styles.css) can take it to nothing and back.
  const plateStyle = { "--plate-opacity": opacity, maxWidth: STORY_PLATE_WIDTH } as CSSProperties;
  return <>
    <group ref={anchor} position={at}>
      <Overlay zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
        <div ref={label} className={`forest-label planet-nameplate${chosen ? " selected" : ""}`} data-story-id={island.story} data-dimmed={dimmed ? "" : undefined} style={plateStyle}>
          <span className="planet-nameplate-title">{island.title}</span>
          {awaiting && <span className="planet-nameplate-laying-out">laying out parts…</span>}
        </div>
      </Overlay>
    </group>
    {plates.map(plate => <Overlay key={plate.capability} position={surface(plate).toArray()} center zIndexRange={[25, 21]} style={{ pointerEvents: "none" }}>
      <div className="forest-label planet-nameplate capability" data-capability-id={plate.capability} data-size={plate.size} data-claimed={claimed.has(plate.capability) ? "" : undefined}>{plate.title}</div>
    </Overlay>)}
  </>;
}

const NEVER = () => () => {};
const NEAR = () => "near" as const;

/** Whenever the globe draws, fade the story names that overlap another, none moving (ADR-0917), and move apart the capability names that overlap (3.33). */
export function NameplateCrowd({ selected }: { selected: string | undefined }) {
  const gl = useThree(state => state.gl);
  const invalidate = useThree(state => state.invalidate);
  useFrame(() => {
    const host = gl.domElement.parentElement;
    if (host === null) return;
    // Turned away, or hidden behind the sphere: not on screen to crowd another.
    const onScreen = (label: HTMLElement) => label.style.visibility !== "hidden" && label.getBoundingClientRect().width > 0;
    const labels = [...host.querySelectorAll<HTMLElement>(".planet-nameplate[data-story-id]")];
    const shown = labels.filter(onScreen).map(label => ({ story: label.dataset.storyId!, box: label.getBoundingClientRect(),
      facing: Number(label.dataset.facing ?? 0), dimmed: label.dataset.dimmed !== undefined }));
    // A capability's name is never hidden: where names overlap they are moved apart, and off a story's name shown (3.33).
    const capabilities = [...host.querySelectorAll<HTMLElement>(".planet-nameplate.capability")].filter(onScreen);
    const { faded, moves } = crowdedNames(shown, selected, capabilities.map(label => ({ capability: label.dataset.capabilityId!, box: label.getBoundingClientRect(),
      given: { x: Number(label.dataset.moveX ?? 0), y: Number(label.dataset.moveY ?? 0) }, size: Number(label.dataset.size ?? 0) })));
    for (const label of labels) label.classList.toggle("crowded", faded.has(label.dataset.storyId!));
    for (const label of capabilities) {
      const move = moves.get(label.dataset.capabilityId!);
      if (move === undefined) continue;
      label.dataset.moveX = String(move.x);
      label.dataset.moveY = String(move.y);
      label.style.setProperty("--move-x", `${move.x}px`);
      label.style.setProperty("--move-y", `${move.y}px`);
    }
    // The overlays place the names after this pass in the same frame: once they have, a name judged where it no longer stands
    // (a jump with nothing drawn after it, as a reduced-motion step makes) is judged again on one more frame.
    const where = (boxes: readonly DOMRect[]) => boxes.map(box => [box.x, box.y, box.width, box.height].map(Math.round).join()).join(";");
    const judged = where([...labels.filter(onScreen), ...capabilities].map(label => label.getBoundingClientRect()));
    requestAnimationFrame(() => { if (where([...labels, ...capabilities].filter(onScreen).map(label => label.getBoundingClientRect())) !== judged) invalidate(); });
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

/** Whether the reader asked for reduced motion. */
export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
