/** The forest's globe book: lane B's plates at lane A's places, with lane C's failure turns. */
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Quaternion, Raycaster, Vector2, Vector3 } from "three";
import { openingTurn, PLANET_RADIUS, type EdgeMarker, type FacingIsland, type ForestScene, type Island, type Marker } from "@storytree/forest";
import type { Descriptor3D } from "@storytree/forest-world";
import { PlanetWorldCanvas } from "@storytree/forest-world/planet";
import kitBytes from "@storytree/forest-world/assets/dressing-kit.glb";
import { KnowledgeGlobePoints, type KnowledgeCore } from "@storytree/knowledge-core/view";
import { Claims, Names, Overlay, SelectionRing } from "./island-overlays.js";
import { focusRotation, hiddenMarkers, pickIsland, planetLayout, type ForestMode } from "./planet-navigation.js";

export function PlanetView({ core, scene, places, markers, selected, onPick, mode = "forest" }: {
  mode?: ForestMode;
  core: KnowledgeCore;
  scene: ForestScene;
  places: ReadonlyMap<string, number>;
  markers: readonly Marker[];
  selected: string | undefined;
  /** Hears a click on an island, or undefined for empty space. */
  onPick: (story: string | undefined) => void;
}) {
  const layout = useMemo(() => planetLayout(scene, places), [scene, places]);
  const [rotation, setRotation] = useState(() => new Quaternion());
  const overlays = useCallback((island: Island, descriptors: readonly Descriptor3D[]) => {
    // Lane B has already centred the descriptors in the plate's own ground coordinates.
    const local = { ...island, x: 0, z: 0 };
    return <>
      <Names islands={[local]} selected={selected} onGlobe />
      <Claims markers={markers} descriptors={descriptors} occlude />
      <SelectionRing island={island.story === selected ? local : undefined} descriptors={descriptors} onGlobe />
    </>;
  }, [markers, selected]);
  return <PlanetWorldCanvas scene={layout.scene} spots={layout.spots} radius={PLANET_RADIUS}
    surface={mode === "forest"}
    inside={<KnowledgeGlobePoints core={core} spots={layout.spots} radius={PLANET_RADIUS} />}
    rotation={rotation.toArray()} kitBytes={kitBytes} plateChildren={overlays}>
    <Navigation islands={layout.islands} titles={new Map(scene.islands.map(i => [i.story, i.title]))}
      rotation={rotation} onRotate={setRotation} onPick={onPick} mode={mode} />
  </PlanetWorldCanvas>;
}

type ScreenMarker = EdgeMarker & { left: number; top: number };

function Navigation({ islands, titles, rotation, onRotate, onPick, mode }: {
  mode: ForestMode;
  islands: readonly FacingIsland[];
  titles: ReadonlyMap<string, string>;
  rotation: Quaternion;
  onRotate: (rotation: Quaternion) => void;
  onPick: (story: string | undefined) => void;
}) {
  const { camera, gl, scene, size } = useThree();
  const opened = useRef(false);
  const lastMarkers = useRef("");
  const [markers, setMarkers] = useState<ScreenMarker[]>([]);
  useEffect(() => {
    if (opened.current || islands.length === 0) return;
    opened.current = true;
    onRotate(focusRotation(openingTurn(islands), camera.quaternion));
  }, [islands, camera, onRotate]);

  // OrbitControls runs before this frame. Project the rim with the current eye AND zoom.
  useFrame(() => {
    const centre = new Vector3().project(camera);
    const rim = PLANET_RADIUS * camera.zoom + 16;
    const next = hiddenMarkers(islands, rotation, camera.quaternion, mode).map(marker => ({
      ...marker,
      left: Math.round(Math.max(20, Math.min(size.width - 20, (centre.x + 1) * size.width / 2 + marker.at.x * rim))),
      top: Math.round(Math.max(20, Math.min(size.height - 20, (1 - centre.y) * size.height / 2 - marker.at.y * rim))),
    }));
    const key = JSON.stringify(next);
    if (key !== lastMarkers.current) {
      lastMarkers.current = key;
      setMarkers(next);
    }
  });

  useEffect(() => {
    if (mode === "library") return;
    const element = gl.domElement;
    let down: { x: number; y: number; id: number } | undefined;
    const onDown = (event: PointerEvent): void => {
      down = event.button === 0 && event.isPrimary ? { x: event.clientX, y: event.clientY, id: event.pointerId } : undefined;
    };
    const onCancel = (): void => { down = undefined; };
    const onUp = (event: PointerEvent): void => {
      const from = down;
      down = undefined;
      if (from === undefined || from.id !== event.pointerId || Math.hypot(event.clientX - from.x, event.clientY - from.y) > 5) return;
      const box = element.getBoundingClientRect();
      const ray = new Raycaster();
      ray.setFromCamera(new Vector2(2 * (event.clientX - box.left) / box.width - 1, 1 - 2 * (event.clientY - box.top) / box.height), camera);
      scene.updateMatrixWorld(true);
      onPick(pickIsland(ray, scene));
    };
    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointerup", onUp);
    element.addEventListener("pointercancel", onCancel);
    return () => {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointercancel", onCancel);
    };
  }, [camera, gl, scene, onPick, mode]);

  if (mode === "library") return null;
  return <Overlay fullscreen zIndexRange={[40, 40]} style={{ pointerEvents: "none" }}>
    {markers.map(marker => <button key={marker.story} type="button" className="planet-edge-marker"
      data-failing-story={marker.story}
      style={{ left: marker.left, top: marker.top }}
      title={`${titles.get(marker.story)} · failing (agent's report)`}
      aria-label={`Show failing story: ${titles.get(marker.story)}`}
      onClick={() => onRotate(focusRotation(marker.turn, camera.quaternion))}>!</button>)}
  </Overlay>;
}
