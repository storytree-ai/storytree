/**
 * The forest's globe-only page (the forest story, capability 3; ADR-0655).
 * PlanetView reuses the ported island drawing, with story names, selection and claims.
 * Unchanged islands retain their objects so only changed plates are recomputed.
 * The flat canvas remains available in the engine; the page mounts only the globe.
 */
import { createRoot } from "react-dom/client";
import type { ForestScene, Marker } from "@storytree/forest";
import type { KnowledgeCore } from "@storytree/knowledge-core/view";
import { preloadKit } from "@storytree/forest-world/canvas";
import kitBytes from "@storytree/forest-world/assets/dressing-kit.glb";
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
  scene: ForestScene;
  markers: readonly Marker[];
  selected: string | undefined;
  viewport: { width: number; height: number } | undefined;
}

/**
 * Open the globe in `container`. `onSelect` hears the story picked, or undefined for empty space.
 * The app's existing core supplies the faint points; its inspection page stays deferred.
 */
export async function openForestView(container: HTMLElement, onSelect: (story: string | undefined) => void, core: KnowledgeCore): Promise<ForestView> {
  await preloadKit(kitBytes);
  const root = createRoot(container);
  let drawn: Drawn = {
    places: new Map(), scene: { islands: [] }, markers: [], selected: undefined, viewport: undefined,
  };

  const render = (next: Partial<Drawn>): void => {
    drawn = { ...drawn, ...next };
    if (drawn.viewport === undefined) return;
    container.dataset.view = "globe";
    root.render(<PlanetView core={core} scene={drawn.scene} places={drawn.places} markers={drawn.markers}
      selected={drawn.selected} onPick={pick} />);
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
      const previous = new Map(drawn.scene.islands.map(island => [island.story, island]));
      scene = { ...scene, islands: scene.islands.map(island => previous.get(island.story)?.key === island.key ? previous.get(island.story)! : island) };
      render({ scene, places });
    },
    showMarkers(markers) {
      render({ markers });
    },
    select(story) {
      render({ selected: story });
    },
    dispose() {
      core.dispose();
      observer.disconnect();
      root.unmount();
      container.replaceChildren();
    },
  };
}
