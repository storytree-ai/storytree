/**
 * Capability 3 · Story node render. The forest's globe-only page (the forest story, capability 3; ADR-0655).
 * PlanetView reuses the ported island drawing, with story names, selection and claims.
 * Unchanged islands retain their objects, and a live update that changed nothing on show is not drawn again.
 * The page mounts only the globe, and loads none of 0.2's pine kit: no island carries a tree (ADR-0804 D1).
 */
import { createRoot } from "react-dom/client";
import type { ForestScene, SessionWisp } from "@storytree/forest";
import { KnowledgeNoteCard, type KnowledgeCore } from "@storytree/knowledge-core/view";
import { PlanetView } from "./planet-view.js";
import { nextScene, sameWisps } from "./planet-update.js";
import { PanelSelection, type Selection } from "./panel-selection.js";
import { globeFraming, type ForestMode } from "./planet-navigation.js";
import type { GlobeOpening } from "../surfaces/surfaces.js";

export interface ForestView {
  /** Draw `scene`, recomputing only the islands that changed since the last one. */
  show(scene: ForestScene, places: ReadonlyMap<string, number>): void;
  /** Show where each running session works: the outline on each territory it claimed (capability 5, ADR-0923). */
  showWisps(wisps: readonly SessionWisp[]): void;
  /** Light a session’s claimed islands, without changing the selected story. */
  highlight(stories: readonly string[] | undefined): void;
  /** Mark `story` selected (undefined for none), as a click would. */
  select(story: string | undefined): void;
  /** Stop drawing and let go of the GPU. */
  dispose(): void;
}

/** What the page draws, as one value handed to React on every change. */
interface Drawn {
  mode: ForestMode;
  places: ReadonlyMap<string, number>;
  scene: ForestScene;
  wisps: readonly SessionWisp[];
  selected: string | undefined;
  highlighted: readonly string[] | undefined;
  viewport: { width: number; height: number } | undefined;
}

/**
 * Open the globe in `container`. `onSelect` hears the story or artifact picked, or empty space.
 * The app's existing core supplies the faint points; its inspection page stays deferred.
 * With `library` off (ADR-0750) the globe stays solid and has no Forest and Library buttons;
 * `opening` is how close it opens.
 */
export async function openForestView(container: HTMLElement, onSelect: (selection: Selection) => void, core: KnowledgeCore,
  { library = true, opening = "whole-planet" }: { library?: boolean; opening?: GlobeOpening | undefined } = {}): Promise<ForestView> {
  const root = createRoot(container);
  let drawn: Drawn = {
    mode: "forest", places: new Map(), scene: { islands: [] }, wisps: [], selected: undefined, highlighted: undefined, viewport: undefined,
  };

  const render = (next: Partial<Drawn>): void => {
    drawn = { ...drawn, ...next };
    if (drawn.viewport === undefined) return;
    container.dataset.view = "globe";
    container.dataset.forestMode = drawn.mode;
    root.render(<>
      <PlanetView core={core} scene={drawn.scene} places={drawn.places} wisps={drawn.wisps}
        selected={drawn.selected} highlighted={drawn.highlighted}
        onPick={pick} onNote={pickNote} mode={drawn.mode} framing={globeFraming(opening)} library={library} />
      {library && <div className="forest-views" role="group" aria-label="Globe view">
        {(["forest", "library"] as const).map(mode => <button key={mode} type="button"
          data-forest-mode={mode} aria-pressed={drawn.mode === mode} onClick={() => changeMode(mode)}>
          {mode === "forest" ? "Forest" : "Library"}
        </button>)}
      </div>}
    </>);
  };
  const selection = new PanelSelection(next => {
    core.pin(next?.kind === "note" ? next.id : undefined);
    render({ selected: next?.kind === "story" ? next.id : undefined });
    onSelect(next);
  });
  const changeMode = (mode: ForestMode): void => {
    render({ mode });
    selection.modeChosen(mode);
  };
  const pick = (story: string | undefined, capability?: string): void => selection.story(story, capability);
  const pickNote = (note: string): void => selection.note(note);
  const onKey = (event: KeyboardEvent): void => selection.key(event.key);
  window.addEventListener("keydown", onKey);

  const observer = new ResizeObserver(() => {
    const { clientWidth: width, clientHeight: height } = container;
    if (width > 0 && height > 0) render({ viewport: { width, height } });
  });
  observer.observe(container);

  return {
    show(scene, places) {
      const next = nextScene(drawn, scene, places);
      if (next !== undefined) render({ scene: next, places });
    },
    showWisps(wisps) {
      if (!sameWisps(wisps, drawn.wisps)) render({ wisps });
    },
    highlight(stories) {
      render({ highlighted: stories });
    },
    select(story) {
      selection.story(story);
    },
    dispose() {
      window.removeEventListener("keydown", onKey);
      core.dispose();
      observer.disconnect();
      root.unmount();
      container.replaceChildren();
    },
  };
}

/** Mount the Library panel, the knowledge core's card for the note picked, in the slot the story panel also uses. */
export function mountLibraryPanel(container: HTMLElement, core: KnowledgeCore, onClose: () => void): () => void {
  const root = createRoot(container);
  root.render(<KnowledgeNoteCard core={core} onClose={onClose} />);
  return () => root.unmount();
}
