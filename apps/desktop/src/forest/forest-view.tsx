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
import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Plane, Raycaster, Vector2, Vector3 } from "three";

import { changedIslands, type ForestScene, type Marker } from "@storytree/forest";
import { forestDescriptors, islandAt, type Descriptor3D } from "@storytree/forest-world";
import { ForestWorldCanvas, preloadKit } from "@storytree/forest-world/canvas";
import kitBytes from "@storytree/forest-world/assets/dressing-kit.glb";

import { Names, Claims, SelectionRing } from "./island-overlays.js";
import { PlanetView } from "./planet-view.js";

export interface ForestView {
  /** Draw `scene`, recomputing only the islands that changed since the last one. */
  show(scene: ForestScene, places: ReadonlyMap<string, number>): void;
  /** Show which agent holds which capability, each marker over its tree (capability 5). */
  showMarkers(markers: readonly Marker[]): void;
  /** Mark `story` selected (undefined for none), as a click would. */
  select(story: string | undefined): void;
  /** Stop drawing and let go of the GPU. */
  dispose(): void;
}

/** What the page draws, as one value handed to React on every change. */
interface Drawn {
  places: ReadonlyMap<string, number>;
  mode: "globe" | "forest";
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
  let drawn: Drawn = { places: new Map(), mode: "globe", scene: { islands: [] }, descriptors: [], markers: [], selected: undefined, viewport: undefined };

  const render = (next: Partial<Drawn>): void => {
    drawn = { ...drawn, ...next };
    if (drawn.viewport === undefined) return;
    container.dataset.view = drawn.mode;
    root.render(<>
      <nav className="forest-views" aria-label="Forest view">
        {(["globe", "forest"] as const).map(mode => <button key={mode} type="button" data-view={mode}
          aria-pressed={drawn.mode === mode} onClick={() => render({ mode })}>
          {mode === "globe" ? "Globe" : "Forest"}
        </button>)}
      </nav>
      {drawn.mode === "globe"
        ? <PlanetView scene={drawn.scene} places={drawn.places} markers={drawn.markers} selected={drawn.selected} onPick={pick} />
        : <Forest drawn={drawn} onPick={pick} />}
    </>);
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
    show(scene, places) {
      for (const story of changedIslands(drawn.scene, scene)) cache.delete(story);
      for (const island of scene.islands) {
        if (!cache.has(island.story)) cache.set(island.story, { key: island.key, descriptors: forestDescriptors({ islands: [island] }) });
      }
      // Preserve unchanged islands for the globe's memoized plates, as for the flat descriptor cache.
      const previous = new Map(drawn.scene.islands.map(island => [island.story, island]));
      scene = { islands: scene.islands.map(island => previous.get(island.story)?.key === island.key ? previous.get(island.story)! : island) };
      render({ scene, places, descriptors: scene.islands.flatMap(({ story }) => cache.get(story)?.descriptors ?? []) });
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
