/** Capability 3 · Story node render. The globe's nameplates, agents' pins and selection rings, drawn on each island's plate. */
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useSyncExternalStore, type CSSProperties } from "react";
import { DoubleSide, Quaternion, type Group } from "three";
import type { Island } from "@storytree/forest";
import type { PinIcon, PinReading } from "@storytree/map/pins";
import { onIslandSurface, Overlay, plateTransform, type PlanetSpot } from "@storytree/forest-world/planet";
import type { Coast } from "../territories/territories.js";
import { islandLayout, type Link, type LinkDock } from "../territories/link-layout.js";
import { awaitingLayout, keptVersion, pageTerritorySearcher, subscribeKept } from "../territories/kept-layout.js";
import { capabilityPlates, crowdedNames, facing, mapControls, mapFrame, southOnPlate, STORY_PLATE_WIDTH, storyPlate } from "./nameplates.js";
import { GROUND_PER_WORLD_UNIT, islandReach, type Descriptor3D } from "@storytree/forest-world";
import { showsNear, type DetailStore } from "./zoom-detail.js";
import { namesShown, type OpenedStore } from "./opened-capability.js";
import { LayingOutLabel } from "./layout-progress.js";
import { pinMarks, PIN_ICONS, type PinMark } from "./pin-marks.js";

/** Where an island's middle is, in 0.2 ground units. */
const centreOf = (island: Island): { x: number; z: number } => ({ x: island.x * GROUND_PER_WORLD_UNIT, z: island.z * GROUND_PER_WORLD_UNIT });

/** Lifted off the island's surface, so the sphere never hides a plate on land that faces the eye. */
const PLATE_LIFT = 2;

/**
 * A story's nameplate, its top edge at a fixed point just south of the island's coast, turning with the island; once the
 * eye is near (3.86), a smaller nameplate on each of its capabilities' territories (below a claimed one's flag); while a
 * story is selected the other stories' plates dim. No plate takes a pointer: the map reads a click's names at its release (3.104), so a drag from one pans.
 */
export function Nameplates({ island, spot, coast, links = [], docks, radius, selected, dimmed = false, claimed = new Map(), detail, opened }: {
  island: Island; spot: PlanetSpot; coast: Coast; radius: number; selected: string | undefined; dimmed?: boolean;
  /** How much of the island the eye's zoom shows; without one, all of it. */
  detail?: DetailStore | undefined;
  /** The capability open on the map: on this island, its parts' names stand in for its own (3.112). */
  opened?: OpenedStore | undefined;
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
  const named = showsNear(level);
  // 3.95: an island awaiting the search that places every territory names none, and says it is laying them out.
  const searcher = useMemo(() => pageTerritorySearcher(), []);
  const awaiting = island.land !== undefined && awaitingLayout(island.story, island.land.territories, searcher);
  const plates = useMemo(() => named && !awaiting && island.land !== undefined ? capabilityPlates(islandLayout(island.story, island.land.territories, coast, links, docks)) : [], [named, awaiting, island.story, island.land, coast, links, docks, kept]);
  // 3.112: an opened capability's parts are named on its land, in place of its own name.
  const partPlates = useSyncExternalStore(opened?.subscribe ?? NEVER, () => opened?.platesOn(island.story));
  const open = partPlates === undefined ? undefined : opened?.get()?.capability;
  const shown = namesShown(plates, partPlates, open);
  const opacity = dimmed ? 0.24 : selected !== undefined && !chosen ? 0.5 : 1;
  // Its opacity is a variable, so a crowded plate's fade (styles.css) can take it to nothing and back.
  const plateStyle = { "--plate-opacity": opacity, maxWidth: STORY_PLATE_WIDTH } as CSSProperties;
  return <>
    <group ref={anchor} position={at}>
      <Overlay zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
        <div ref={label} className={`forest-label planet-nameplate${chosen ? " selected" : ""}`} data-story-id={island.story} data-dimmed={dimmed ? "" : undefined} style={plateStyle}>
          <span className="planet-nameplate-title">{island.title}</span>
          <LayingOutLabel awaiting={awaiting} />
        </div>
      </Overlay>
    </group>
    {shown.parts.map(plate => <Overlay key={`part:${plate.part}`} position={surface(plate).toArray()} center zIndexRange={[25, 21]} style={{ pointerEvents: "none" }}>
      <div className="forest-label planet-nameplate capability part" data-capability-id={open} data-part-id={plate.part} data-island-id={island.story}>{plate.title}</div>
    </Overlay>)}
    {shown.plates.map(plate => <Overlay key={plate.capability} position={surface(plate).toArray()} center zIndexRange={[25, 21]} style={{ pointerEvents: "none" }}>
      <div className="forest-label planet-nameplate capability" data-capability-id={plate.capability} data-island-id={island.story} data-size={plate.size} data-claimed={claimed.has(plate.capability) ? "" : undefined}>{plate.title}</div>
    </Overlay>)}
  </>;
}

/**
 * 3.119: the agents' pins on an island, each place's mark just above its name: on its capabilities' territories, and on the
 * parts of the one opened, which hold their own pins once drawn. Near, each pin's icon and label; zoomed out, the icons and how
 * many. Nothing is laid out for an island no pin is on.
 */
export function IslandPins({ island, coast, links = [], docks, radius, pins, detail, opened }: {
  island: Island; coast: Coast; radius: number; pins: readonly PinReading[];
  links?: readonly Link[]; docks?: readonly LinkDock[] | undefined;
  detail?: DetailStore | undefined; opened?: OpenedStore | undefined;
}) {
  const surface = useMemo(() => onIslandSurface(radius, PLATE_LIFT), [radius]);
  const capabilities = useMemo(() => new Set(island.land?.territories.flatMap(({ capability }) => capability === undefined ? [] : [capability]) ?? []), [island.land]);
  const here = useMemo(() => pins.filter(({ pin }) => "capability" in pin.fields.anchor && capabilities.has(pin.fields.anchor.capability)), [pins, capabilities]);
  const kept = useSyncExternalStore(subscribeKept, keptVersion);
  const level = useSyncExternalStore(detail?.subscribe ?? NEVER, detail?.get ?? NEAR);
  const searcher = useMemo(() => pageTerritorySearcher(), []);
  const awaiting = island.land !== undefined && awaitingLayout(island.story, island.land.territories, searcher);
  const plates = useMemo(() => here.length === 0 || awaiting || island.land === undefined ? [] : capabilityPlates(islandLayout(island.story, island.land.territories, coast, links, docks)),
    [here.length, awaiting, island.story, island.land, coast, links, docks, kept]);
  const partPlates = useSyncExternalStore(opened?.subscribe ?? NEVER, () => opened?.platesOn(island.story));
  const open = partPlates === undefined ? undefined : opened?.get()?.capability;
  const marks = useMemo(() => pinMarks(here, { capabilities, ...(open === undefined || partPlates === undefined ? {} : { parts: new Map([[open, new Set(partPlates.map(({ part }) => part))]]) }) }),
    [here, capabilities, open, partPlates]);
  const near = showsNear(level);
  return <>{marks.map((mark) => {
    if ("store" in mark.place) return null;
    const { capability, part } = mark.place;
    const at = part === undefined ? plates.find((plate) => plate.capability === capability) : partPlates?.find((plate) => plate.part === part);
    return at === undefined ? null : <Overlay key={mark.key} position={surface(at).toArray()} center zIndexRange={[26, 22]} style={{ pointerEvents: "none" }}>
      <PinBadge mark={mark} near={near} />
    </Overlay>;
  })}</>;
}

/** 3.119: the pins on a shared store's slab, just above its name; a store shows them at every zoom it is drawn at. */
export function StorePins({ address, at, pins, detail }: { address: string; at: readonly [number, number, number]; pins: readonly PinReading[]; detail?: DetailStore | undefined }) {
  const level = useSyncExternalStore(detail?.subscribe ?? NEVER, detail?.get ?? NEAR);
  const mark = useMemo(() => pinMarks(pins, { capabilities: new Set(), stores: new Set([address]) })[0], [pins, address]);
  return mark === undefined ? null : <Overlay position={[...at]} center zIndexRange={[26, 22]} style={{ pointerEvents: "none" }}><PinBadge mark={mark} near={showsNear(level)} /></Overlay>;
}

/** A place's pins: near, a row per pin, its icon and label, a stale one greyed and saying so; far, each icon once and how many. */
function PinBadge({ mark, near }: { mark: PinMark; near: boolean }) {
  const allStale = (icon: PinIcon) => mark.pins.every((pin) => pin.icon !== icon || pin.stale !== undefined);
  return <div className="forest-label planet-pin" data-pin-place={mark.key} data-pin-count={mark.count} data-pin-icons={mark.icons.join(" ")} data-pin-stale={mark.stale} data-pin-level={near ? "near" : "far"}>
    {near
      ? mark.pins.map((pin) => <span key={pin.id} className="planet-pin-row" data-pin-id={pin.id} data-stale={pin.stale === undefined ? undefined : ""} title={pin.stale}>
        <PinGlyph icon={pin.icon} /><span className="planet-pin-label">{pin.label}</span>{pin.stale !== undefined && <span className="planet-pin-stale">stale</span>}
      </span>)
      : <span className="planet-pin-row">{mark.icons.map((icon) => <PinGlyph key={icon} icon={icon} stale={allStale(icon)} />)}<span className="planet-pin-count">{mark.count}</span></span>}
  </div>;
}

/** A preset icon's mark (pin-marks.ts). */
function PinGlyph({ icon, stale = false }: { icon: PinIcon; stale?: boolean }) {
  return <svg className="planet-pin-icon" viewBox="0 0 24 24" aria-label={icon} data-icon={icon} data-stale={stale ? "" : undefined}><path d={PIN_ICONS[icon]} /></svg>;
}

const NEVER = () => () => {};
const NEAR = () => "near" as const;

/** Whenever the globe draws, fade the story names that overlap another, that the map's frame cuts or that its controls cover, none moving (ADR-0917, 3.4, 3.106), and move apart the capability names that overlap (3.33). */
export function NameplateCrowd({ selected, aside = 0 }: { selected: string | undefined; aside?: number }) {
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
    // The map shows only where its canvas lies in the window, left of the story panel: a story's name cut by the rail's edge,
    // the panel's or the window's fades (3.4).
    const frame = mapFrame(gl.domElement.getBoundingClientRect(), { width: innerWidth, height: innerHeight }, aside);
    // The map's controls drawn over it cover no name: a story's under one fades, a capability's moves off it (3.106).
    const controls = mapControls(host);
    const { faded, moves } = crowdedNames(shown, selected, capabilities.map(label => ({ capability: label.dataset.capabilityId!, box: label.getBoundingClientRect(),
      given: { x: Number(label.dataset.moveX ?? 0), y: Number(label.dataset.moveY ?? 0) }, size: Number(label.dataset.size ?? 0) })), frame, controls);
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
