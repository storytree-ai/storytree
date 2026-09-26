/**
 * The forest's 3D picture (stories/forest.md, capability 3 · Story node render): 0.2's own forest
 * canvas (`ForestWorldCanvas`, ported whole in @storytree/forest-world), fed @storytree/forest's plan.
 * Every story node is one of 0.2's islands at its place on the spiral, its ground, coast and kit
 * trees drawn as 0.2 drew them, lit by 0.2's calibrated light. It pans and zooms as 0.2's did.
 *
 * On top of the picture, and drawn inside the same scene so they move with it, are what the 0.3
 * forest adds: each story's name over its island (3.4), a click that selects the island whose land
 * is under it (3.3), the selected island's ring, and the claim markers over each held capability's
 * tree (capability 5). A change recomputes only the islands it touched (3.2, `changedIslands`).
 *
 * The look is 0.2's, ported as it stands (ADR-0632 D2, ADR-0633 D2), and judged by the owner's eye.
 * Only the export of the bought pine kit ships (dressing-kit.glb, sha256 9479bc81…), never the kit.
 */
import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { DoubleSide, Plane, Raycaster, Vector2, Vector3 } from "three";

import { changedIslands, type ForestScene, type Island, type Marker } from "@storytree/forest";
import { forestDescriptors, GROUND_PER_WORLD_UNIT, islandAt, islandReach, parcelSpots, type Descriptor3D } from "@storytree/forest-world";
import { ForestWorldCanvas, preloadKit } from "@storytree/forest-world/canvas";
import kitBytes from "@storytree/forest-world/assets/dressing-kit.glb";

/** How high over the ground a story's name floats, and a claim marker over its tree, in 0.2 ground units (a full pine stands 18). */
const NAME_HEIGHT = 30;
const MARKER_HEIGHT = 24;

export interface ForestView {
  /** Draw `scene`, recomputing only the islands that changed since the last one. */
  show(scene: ForestScene): void;
  /** Show which agent holds which capability, each marker over its tree (capability 5). */
  showMarkers(markers: readonly Marker[]): void;
  /** Mark `story` selected (undefined for none), as a click would. */
  select(story: string | undefined): void;
  /** Stop drawing and let go of the GPU. */
  dispose(): void;
}

/** What the page draws, as one value handed to React on every change. */
interface Drawn {
  scene: ForestScene;
  descriptors: Descriptor3D[];
  markers: readonly Marker[];
  selected: string | undefined;
  viewport: { width: number; height: number } | undefined;
}

/** Open the forest in `container`. `onSelect` hears which story a click picked (undefined for the sea). */
export async function openForestView(container: HTMLElement, onSelect: (story: string | undefined) => void): Promise<ForestView> {
  await preloadKit(kitBytes);
  const root = createRoot(container);
  /** Each island's descriptors, kept until its island changes. */
  const cache = new Map<string, { key: string; descriptors: Descriptor3D[] }>();
  let drawn: Drawn = { scene: { islands: [] }, descriptors: [], markers: [], selected: undefined, viewport: undefined };

  const render = (next: Partial<Drawn>): void => {
    drawn = { ...drawn, ...next };
    if (drawn.viewport === undefined) return;
    root.render(<Forest drawn={drawn} onPick={pick} />);
  };
  const pick = (story: string | undefined): void => {
    render({ selected: story });
    onSelect(story);
  };

  const observer = new ResizeObserver(() => {
    const { clientWidth: width, clientHeight: height } = container;
    if (width > 0 && height > 0) render({ viewport: { width, height } });
  });
  observer.observe(container);

  return {
    show(scene) {
      for (const story of changedIslands(drawn.scene, scene)) cache.delete(story);
      for (const island of scene.islands) {
        if (!cache.has(island.story)) cache.set(island.story, { key: island.key, descriptors: forestDescriptors({ islands: [island] }) });
      }
      render({ scene, descriptors: scene.islands.flatMap(({ story }) => cache.get(story)?.descriptors ?? []) });
    },
    showMarkers(markers) {
      render({ markers });
    },
    select(story) {
      render({ selected: story });
    },
    dispose() {
      observer.disconnect();
      root.unmount();
      container.replaceChildren();
    },
  };
}

function Forest({ drawn, onPick }: { drawn: Drawn; onPick: (story: string | undefined) => void }) {
  // The frame it is delivered into, so the canvas opens on 0.2's designed resting view (ADR-0471), as
  // 0.2's studio land view did.
  return (
    <ForestWorldCanvas descriptors={drawn.descriptors} viewport={drawn.viewport!} kitBytes={kitBytes}>
      <Names islands={drawn.scene.islands} selected={drawn.selected} />
      <Claims markers={drawn.markers} descriptors={drawn.descriptors} />
      <SelectionRing island={drawn.scene.islands.find(({ story }) => story === drawn.selected)} descriptors={drawn.descriptors} />
      <ClickToSelect descriptors={drawn.descriptors} onPick={onPick} />
    </ForestWorldCanvas>
  );
}

/** Where an island's middle is, in 0.2 ground units. */
const centreOf = (island: Island): { x: number; z: number } => ({ x: island.x * GROUND_PER_WORLD_UNIT, z: island.z * GROUND_PER_WORLD_UNIT });

/** Each story's name over its island, facing the viewer as the camera pans and zooms (3.4). */
function Names({ islands, selected }: { islands: readonly Island[]; selected: string | undefined }) {
  return islands.map((island) => {
    const { x, z } = centreOf(island);
    return (
      <Html key={island.story} position={[x, NAME_HEIGHT, z]} center zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
        <div className={`forest-label${island.story === selected ? " selected" : ""}`} data-story-id={island.story}>
          {island.title}
        </div>
      </Html>
    );
  });
}

/** Which agent holds which capability, over that capability's tree (capability 5). */
function Claims({ markers, descriptors }: { markers: readonly Marker[]; descriptors: readonly Descriptor3D[] }) {
  const spots = parcelSpots(descriptors);
  return markers.map((marker) => {
    const spot = spots.get(marker.capability);
    if (spot === undefined) return null;
    return (
      <Html key={`${marker.capability}:${marker.text}`} position={[spot.x, MARKER_HEIGHT, spot.z]} center zIndexRange={[30, 20]} style={{ pointerEvents: "none" }}>
        <div
          className={`forest-claim${marker.faded ? " faded" : ""}${marker.hooksNotRunning ? " no-hooks" : ""}`}
          data-capability-id={marker.capability}
          title={marker.faded ? "quiet past the quiet time: it still holds this capability" : ""}
        >
          {marker.hooksNotRunning ? `${marker.text} · hooks not running` : marker.text}
        </div>
      </Html>
    );
  });
}

/** A ring on the water round the selected island (3.3). */
function SelectionRing({ island, descriptors }: { island: Island | undefined; descriptors: readonly Descriptor3D[] }) {
  if (island === undefined) return null;
  const centre = centreOf(island);
  const reach = islandReach(descriptors, new Map([[island.story, centre]])).get(island.story) ?? 20;
  return (
    <mesh position={[centre.x, 0.4, centre.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
      <ringGeometry args={[reach + 3, reach + 5, 96]} />
      <meshBasicMaterial color="#ffd75e" side={DoubleSide} depthTest={false} transparent opacity={0.9} />
    </mesh>
  );
}

/** A click, not a drag, selects the island whose land is under the pointer; open sea selects none (3.3). */
function ClickToSelect({ descriptors, onPick }: { descriptors: readonly Descriptor3D[]; onPick: (story: string | undefined) => void }) {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const down = useRef<{ x: number; y: number } | undefined>(undefined);
  useEffect(() => {
    const element = gl.domElement;
    const onDown = (event: PointerEvent): void => {
      down.current = { x: event.clientX, y: event.clientY };
    };
    const onUp = (event: PointerEvent): void => {
      const from = down.current;
      if (from === undefined || Math.hypot(event.clientX - from.x, event.clientY - from.y) > 5) return;
      const box = element.getBoundingClientRect();
      const ray = new Raycaster();
      ray.setFromCamera(new Vector2(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1), camera);
      const hit = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3());
      onPick(hit === null ? undefined : islandAt(descriptors, hit.x, hit.z));
    };
    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointerup", onUp);
    return () => {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointerup", onUp);
    };
  }, [gl, camera, descriptors, onPick]);
  return null;
}
