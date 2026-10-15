/**
 * Capability 3 · Story node render. The forest's page (the forest story, capability 3): its stories on the glass sheet, depth
 * running west to east (ADR-1043, which supersedes ADR-0655 D1's globe-only page), and the knowledge graph on the sheet's
 * underside, which the Library face turns it over to. PlanetView reuses the ported island drawing, with story names, selection and claims.
 * Unchanged islands retain their objects, and a live update that changed nothing on show is not drawn again.
 * The page mounts only the globe, and loads none of 0.2's pine kit: no island carries a tree (ADR-0804 D1).
 */
import { createRoot } from "react-dom/client";
import type { ForestScene, SessionWisp } from "@storytree/forest";
import { KnowledgeKinds, KnowledgeNoteCard, type KnowledgeCore } from "@storytree/knowledge-core/view";
import { PlanetView } from "./planet-view.js";
import { nextScene, sameWisps } from "./planet-update.js";
import { PanelSelection, type Selection } from "./panel-selection.js";
import { panelAside } from "./globe-aside.js";
import { globeFraming } from "./planet-navigation.js";
import { faceAt, openingFace, sheetFaces, type SheetFace } from "./globe-switches.js";
import { sheetKey } from "./sheet-navigation.js";
import type { PlacedGlobeControls } from "./globe-guide.js";
import { globeLocator, type GlobeLocator } from "./globe-locator.js";
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
  /** The glass sheet's face toward the eye (ADR-1043 D3). */
  face: SheetFace;
  places: ReadonlyMap<string, number>;
  scene: ForestScene;
  wisps: readonly SessionWisp[];
  selected: string | undefined;
  highlighted: readonly string[] | undefined;
  viewport: { width: number; height: number } | undefined;
  /** CSS pixels of the page's right the story panel or note card covers (3.40). */
  aside: number;
}

/**
 * Open the globe in `container`. `onSelect` hears the story or artifact picked, or empty space.
 * The app's existing core supplies the faint points; its inspection page stays deferred.
 * Its Stories and Library buttons are the glass sheet's two resting views, one pressed at a time: pressing the other swings
 * the tilt to its rest from above or below, and the pressed one follows the side of the glass the eye is on as the user tilts
 * it by hand (ADR-1062 D3, replacing ADR-1002's four combinations here). With `library` off (ADR-0750) nothing hangs beneath and only
 * Stories is offered; `opening` is how close it opens, and `factory` opens the user's factory on its Library face (3.63).
 * The page offers `window.storytreeGlobe`, the locator the lag instrument clicks islands by (3.41).
 */
export async function openForestView(container: HTMLElement, onSelect: (selection: Selection) => void, core: KnowledgeCore,
  { library = true, opening = "whole-planet", factory = false }: { library?: boolean; opening?: GlobeOpening | undefined; factory?: boolean } = {}): Promise<ForestView> {
  const root = createRoot(container);
  let drawn: Drawn = {
    face: openingFace({ factory, libraryOffered: library }), places: new Map(), scene: { islands: [] }, wisps: [], selected: undefined, highlighted: undefined, viewport: undefined, aside: 0,
  };

  const render = (next: Partial<Drawn>): void => {
    drawn = { ...drawn, ...next };
    if (drawn.viewport === undefined) return;
    const layers = sheetFaces(drawn.face, library);
    container.dataset.view = "globe";
    container.dataset.forestMode = layers.mode;
    container.dataset.globeShown = "true";
    root.render(<>
      <div className="forest-globe">
        <PlanetView sheet core={core} scene={drawn.scene} places={drawn.places} wisps={drawn.wisps}
          selected={drawn.selected} highlighted={drawn.highlighted}
          onPick={pick} onNote={pickNote} onControls={onControls} mode={layers.mode} framing={globeFraming(opening)} aside={drawn.aside} library={layers.library} liveRoads
          onSide={tilt => turn(faceAt(tilt))} />
      </div>
      <div className="forest-views" role="group" aria-label="Sheet faces">
        {layers.offered.map(which => <button key={which} type="button"
          data-globe-switch={which} aria-pressed={layers.pressed[which]} title={layers.offered.length > 1 ? SWING_TITLE : TILT_TITLE} onClick={() => turn(which)}>
          {which === "stories" ? "Stories" : "Library"}
        </button>)}
      </div>
      {/* The knowledge core's kind list unfolds under the Library button, while the eye is below the glass (knowledge core 5, D1). */}
      {layers.mode === "library" && <KnowledgeKinds core={core} />}
    </>);
  };
  const selection = new PanelSelection(next => {
    core.pin(next?.kind === "note" ? next.id : undefined);
    render({ selected: next?.kind === "story" ? next.id : undefined });
    onSelect(next);
  });
  const turn = (face: SheetFace): void => {
    if (face === drawn.face) return;
    render({ face });
    selection.turned(face);
  };
  const pick = (story: string | undefined, capability?: string): void => selection.story(story, capability);
  const pickNote = (note: string): void => selection.note(note);
  // T swings the sheet to the other resting view, as the Stories and Library buttons do (ADR-1060 D4, ADR-1062 D3).
  const onKey = (event: KeyboardEvent): void => {
    selection.key(event.key);
    if (library && sheetKey(event)?.kind === "turn") turn(drawn.face === "stories" ? "library" : "stories");
  };
  let controls: PlacedGlobeControls | undefined;
  const onControls = (next: PlacedGlobeControls | undefined): void => { controls = next; };
  const page = window as { storytreeGlobe?: GlobeLocator };
  page.storytreeGlobe = globeLocator({ controls: () => controls, scene: () => drawn.scene,
    box: () => (container.querySelector("canvas") ?? container).getBoundingClientRect(), aside: () => measuredAside() });
  window.addEventListener("keydown", onKey);

  // The right-hand slot (the story panel or the Library's note card) is the globe's sibling; the globe moves aside for
  // the width it measures, so a panel's own width (narrowed while the tree has its space) reaches it as drawn.
  const panel = container.parentElement?.querySelector<HTMLElement>(":scope > .story-panel") ?? undefined;
  const measuredAside = (): number => panel === undefined ? 0 : panelAside(container.getBoundingClientRect(), [...panel.getClientRects()]);
  const measure = (): void => {
    const { clientWidth: width, clientHeight: height } = container;
    const aside = measuredAside();
    if (width > 0 && height > 0 && (width !== drawn.viewport?.width || height !== drawn.viewport.height || aside !== drawn.aside)) render({ viewport: { width, height }, aside });
  };
  const observer = new ResizeObserver(measure);
  observer.observe(container);
  // Opening or closing the panel toggles its `hidden`, which a size observer alone may miss.
  const shown = new MutationObserver(measure);
  if (panel !== undefined) { observer.observe(panel); shown.observe(panel, { attributes: true, attributeFilter: ["hidden"] }); }

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
      delete page.storytreeGlobe;
      core.dispose();
      observer.disconnect();
      shown.disconnect();
      root.unmount();
      container.replaceChildren();
    },
  };
}

/** What the face buttons say they do: swing between the resting views, and how to tilt the sheet by hand (ADR-1062 D2). */
const TILT_TITLE = "Tilt the sheet: R and F, or right-drag up and down";
const SWING_TITLE = `Swing to the other side of the glass (T). ${TILT_TITLE}`;

/** Mount the Library panel, the knowledge core's card for the note picked, in the slot the story panel also uses. */
export function mountLibraryPanel(container: HTMLElement, core: KnowledgeCore, onClose: () => void): () => void {
  const root = createRoot(container);
  root.render(<KnowledgeNoteCard core={core} onClose={onClose} />);
  return () => root.unmount();
}
