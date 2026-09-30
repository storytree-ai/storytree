/**
 * The forest's globe-only page (the forest story, capability 3; ADR-0655).
 * PlanetView reuses the ported island drawing, with story names, selection and claims.
 * Unchanged islands retain their objects so only changed plates are recomputed.
 * The flat canvas remains available in the engine; the page mounts only the globe.
 */
import { createRoot } from "react-dom/client";
import type { ForestScene, SessionWisp } from "@storytree/forest";
import { KnowledgeNoteCard, type KnowledgeCore } from "@storytree/knowledge-core/view";
import { preloadKit } from "@storytree/forest-world/canvas";
import kitBytes from "@storytree/forest-world/assets/dressing-kit.glb";
import { PlanetView } from "./planet-view.js";
import { PanelSelection, type Selection } from "./panel-selection.js";
import { globeFraming, type ForestMode } from "./planet-navigation.js";
import type { GlobeOpening } from "../surfaces/surfaces.js";

export interface ForestView {
  /** Draw `scene`, recomputing only the islands that changed since the last one. */
  show(scene: ForestScene, places: ReadonlyMap<string, number>): void;
  /** Show where each running session works: its tint on its islands' coasts and claimed land (capability 5, ADR-0804 D9). */
  showWisps(wisps: readonly SessionWisp[]): void;
  /** Light a session’s claimed islands and swell its wisps, without changing the selected story. */
  highlight(stories: readonly string[] | undefined, session?: string): void;
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
  highlightedSession: string | undefined;
  viewport: { width: number; height: number } | undefined;
}

/**
 * Open the globe in `container`. `onSelect` hears the story or artifact picked, or empty space.
 * The app's existing core supplies the faint points; its inspection page stays deferred.
 * `onWispHover` hears the session whose wisp the pointer is over, or undefined when it leaves.
 * With `library` off (ADR-0750) the globe stays solid and has no Forest and Library buttons;
 * `opening` is how close it opens.
 */
export async function openForestView(container: HTMLElement, onSelect: (selection: Selection) => void, core: KnowledgeCore,
  onWispHover: (session: string | undefined) => void = () => {}, { library = true, opening = "whole-planet" }: { library?: boolean; opening?: GlobeOpening | undefined } = {}): Promise<ForestView> {
  await preloadKit(kitBytes);
  const root = createRoot(container);
  let drawn: Drawn = {
    mode: "forest", places: new Map(), scene: { islands: [] }, wisps: [], selected: undefined, highlighted: undefined, highlightedSession: undefined, viewport: undefined,
  };

  const render = (next: Partial<Drawn>): void => {
    drawn = { ...drawn, ...next };
    if (drawn.viewport === undefined) return;
    container.dataset.view = "globe";
    container.dataset.forestMode = drawn.mode;
    root.render(<>
      <PlanetView core={core} scene={drawn.scene} places={drawn.places} wisps={drawn.wisps}
        selected={drawn.selected} highlighted={drawn.highlighted} highlightedSession={drawn.highlightedSession}
        onPick={pick} onNote={pickNote} onWispHover={onWispHover} mode={drawn.mode} framing={globeFraming(opening)} library={library} />
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
    if (mode === "library" && selection.current?.kind === "story") selection.close();
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
      const previous = new Map(drawn.scene.islands.map(island => [island.story, island]));
      scene = { ...scene, islands: scene.islands.map(island => previous.get(island.story)?.key === island.key ? previous.get(island.story)! : island) };
      render({ scene, places });
    },
    showWisps(wisps) {
      render({ wisps });
    },
    highlight(stories, session) {
      render({ highlighted: stories, highlightedSession: session });
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
