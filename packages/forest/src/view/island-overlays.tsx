// Capability 3 · Story node render
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
import { badgeShown, markSpot, pinMarks, PIN_ICONS, type PinMark } from "./pin-marks.js";

const centreOf = (island: Island): { x: number; z: number } => ({ x: island.x * GROUND_PER_WORLD_UNIT, z: island.z * GROUND_PER_WORLD_UNIT });

const PLATE_LIFT = 2;

export function Nameplates({ island, spot, coast, links = [], docks, radius, selected, dimmed = false, claimed = new Map(), detail, opened }: {
  island: Island; spot: PlanetSpot; coast: Coast; radius: number; selected: string | undefined; dimmed?: boolean;
  detail?: DetailStore | undefined;
  opened?: OpenedStore | undefined;
  links?: readonly Link[]; docks?: readonly LinkDock[] | undefined;
  claimed?: ReadonlyMap<string, unknown>;
}) {
  const surface = useMemo(() => onIslandSurface(radius, PLATE_LIFT), [radius]);
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
    label.current.dataset.facing = String(facing(turned, camera.quaternion));
  }, -1);
  const chosen = island.story === selected;
  const kept = useSyncExternalStore(subscribeKept, keptVersion);
  const level = useSyncExternalStore(detail?.subscribe ?? NEVER, detail?.get ?? NEAR);
  const named = showsNear(level);
  const searcher = useMemo(() => pageTerritorySearcher(), []);
  const awaiting = island.land !== undefined && awaitingLayout(island.story, island.land.territories, searcher);
  const plates = useMemo(() => named && !awaiting && island.land !== undefined ? capabilityPlates(islandLayout(island.story, island.land.territories, coast, links, docks)) : [], [named, awaiting, island.story, island.land, coast, links, docks, kept]);
  const partPlates = useSyncExternalStore(opened?.subscribe ?? NEVER, () => opened?.platesOn(island.story));
  const open = partPlates === undefined ? undefined : opened?.get()?.capability;
  const shown = namesShown(plates, partPlates, open);
  const opacity = dimmed ? 0.24 : selected !== undefined && !chosen ? 0.5 : 1;
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
      <div className={`forest-label planet-nameplate capability part${plate.reach === true ? " reach" : ""}`} data-capability-id={open} data-part-id={plate.part} data-island-id={island.story}>{plate.title}</div>
    </Overlay>)}
    {shown.plates.map(plate => <Overlay key={plate.capability} position={surface(plate).toArray()} center zIndexRange={[25, 21]} style={{ pointerEvents: "none" }}>
      <div className="forest-label planet-nameplate capability" data-capability-id={plate.capability} data-island-id={island.story} data-size={plate.size} data-claimed={claimed.has(plate.capability) ? "" : undefined}>{plate.title}</div>
    </Overlay>)}
  </>;
}

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
    const at = markSpot(mark.place, plates, partPlates);
    return at === undefined ? null : <Overlay key={mark.key} position={surface(at).toArray()} center zIndexRange={[26, 22]} style={{ pointerEvents: "none" }}>
      <PinBadge mark={mark} near={near} />
    </Overlay>;
  })}</>;
}

export function StorePins({ address, at, pins, detail }: { address: string; at: readonly [number, number, number]; pins: readonly PinReading[]; detail?: DetailStore | undefined }) {
  const level = useSyncExternalStore(detail?.subscribe ?? NEVER, detail?.get ?? NEAR);
  const mark = useMemo(() => pinMarks(pins, { capabilities: new Set(), stores: new Set([address]) })[0], [pins, address]);
  return mark === undefined ? null : <Overlay position={[...at]} center zIndexRange={[26, 22]} style={{ pointerEvents: "none" }}><PinBadge mark={mark} near={showsNear(level)} /></Overlay>;
}

function PinBadge({ mark, near }: { mark: PinMark; near: boolean }) {
  const shown = badgeShown(mark, near);
  return <div className="forest-label planet-pin" data-pin-place={mark.key} data-pin-count={mark.count} data-pin-icons={mark.icons.join(" ")} data-pin-stale={mark.stale} data-pin-level={near ? "near" : "far"}>
    {shown.near
      ? shown.rows.map((pin) => <span key={pin.id} className="planet-pin-row" data-pin-id={pin.id} data-stale={pin.stale === undefined ? undefined : ""} title={pin.stale}>
        <PinGlyph icon={pin.icon} /><span className="planet-pin-label">{pin.label}</span>{pin.stale !== undefined && <span className="planet-pin-stale">stale</span>}
      </span>)
      : <span className="planet-pin-row">{shown.icons.map(({ icon, stale }) => <PinGlyph key={icon} icon={icon} stale={stale} />)}<span className="planet-pin-count">{shown.count}</span></span>}
  </div>;
}

function PinGlyph({ icon, stale = false }: { icon: PinIcon; stale?: boolean }) {
  return <svg className="planet-pin-icon" viewBox="0 0 24 24" aria-label={icon} data-icon={icon} data-stale={stale ? "" : undefined}><path d={PIN_ICONS[icon]} /></svg>;
}

const NEVER = () => () => {};
const NEAR = () => "near" as const;

export function NameplateCrowd({ selected, aside = 0 }: { selected: string | undefined; aside?: number }) {
  const gl = useThree(state => state.gl);
  const invalidate = useThree(state => state.invalidate);
  useFrame(() => {
    const host = gl.domElement.parentElement;
    if (host === null) return;
    const onScreen = (label: HTMLElement) => label.style.visibility !== "hidden" && label.getBoundingClientRect().width > 0;
    const labels = [...host.querySelectorAll<HTMLElement>(".planet-nameplate[data-story-id]")];
    const shown = labels.filter(onScreen).map(label => ({ story: label.dataset.storyId!, box: label.getBoundingClientRect(),
      facing: Number(label.dataset.facing ?? 0), dimmed: label.dataset.dimmed !== undefined }));
    const capabilities = [...host.querySelectorAll<HTMLElement>(".planet-nameplate.capability")].filter(onScreen);
    const frame = mapFrame(gl.domElement.getBoundingClientRect(), { width: innerWidth, height: innerHeight }, aside);
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
    const where = (boxes: readonly DOMRect[]) => boxes.map(box => [box.x, box.y, box.width, box.height].map(Math.round).join()).join(";");
    const judged = where([...labels.filter(onScreen), ...capabilities].map(label => label.getBoundingClientRect()));
    requestAnimationFrame(() => { if (where([...labels, ...capabilities].filter(onScreen).map(label => label.getBoundingClientRect())) !== judged) invalidate(); });
  });
  return null;
}

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

export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
