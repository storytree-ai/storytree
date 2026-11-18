// Capability 3 · Story node render
import { createRoot } from "react-dom/client";
import type { LanesNotice } from "@storytree/forest-world/planet";
import type { ForestScene, SessionWisp } from "@storytree/forest";
import { KnowledgeKinds, KnowledgeNoteCard, type KnowledgeCore } from "@storytree/knowledge-core/view";
import { PlanetView } from "./planet-view.js";
import { nextScene, sameWisps } from "./planet-update.js";
import { PanelSelection, panelPicks, type Selection } from "./panel-selection.js";
import { panelAside } from "./globe-aside.js";
import { globeFraming } from "./planet-navigation.js";
import { LAUNCH_FACE, sheetFaces, type SheetFace } from "./globe-switches.js";
import type { PlacedGlobeControls } from "./globe-guide.js";
import { globeLocator, type GlobeLocator } from "./globe-locator.js";
import { drawnNames } from "./nameplates.js";
import { paintedScenes } from "./painted-scenes.js";
import { onScreenIsland } from "./layout-progress.js";
import { ForestTop } from "./forest-top.js";
import { openWorkCount } from "./open-work.js";
import { EmptyMap } from "./empty-map.js";
import { LibraryProgress, libraryOpening } from "./library-opening.js";
import { searchFirst } from "../territories/kept-layout.js";
import type { GlobeOpening } from "../surfaces/surfaces.js";

export interface ForestView {
  show(scene: ForestScene, places: ReadonlyMap<string, number>): void;
  drawn(): Promise<void>;
  showWisps(wisps: readonly SessionWisp[]): void;
  highlight(stories: readonly string[] | undefined): void;
  circle(capabilities: readonly string[] | undefined, contracts?: readonly string[] | undefined): void;
  select(story: string | undefined): void;
  dispose(): void;
}

interface Drawn {
  face: SheetFace;
  places: ReadonlyMap<string, number>;
  scene: ForestScene;
  wisps: readonly SessionWisp[];
  selected: string | undefined;
  capability: string | undefined;
  highlighted: readonly string[] | undefined;
  circled: readonly string[] | undefined;
  circledContracts: readonly string[] | undefined;
  viewport: { width: number; height: number } | undefined;
  aside: number;
  lanesNotice: LanesNotice | undefined;
  read: boolean;
  libraryBar: boolean;
}

export async function openForestView(container: HTMLElement, onSelect: (selection: Selection) => void, core: KnowledgeCore,
  { library = true, opening = "whole-planet", openGuide, libraryBarAfterMs }: { library?: boolean; opening?: GlobeOpening | undefined; openGuide?: (() => void) | undefined;
    libraryBarAfterMs?: number | undefined } = {}): Promise<ForestView> {
  const root = createRoot(container);
  let drawn: Drawn = {
    face: LAUNCH_FACE, places: new Map(), scene: { islands: [] }, wisps: [], selected: undefined, capability: undefined, highlighted: undefined, circled: undefined, circledContracts: undefined, viewport: undefined, aside: 0, lanesNotice: undefined, read: false, libraryBar: false,
  };
  const painted = paintedScenes(drawn.scene);
  const onScreen = onScreenIsland();

  const render = (next: Partial<Drawn>): void => {
    drawn = { ...drawn, ...next };
    const stories = drawn.scene.islands.map(island => island.story);
    searchFirst(onScreen(stories, drawn.selected));
    if (drawn.viewport === undefined) return;
    const layers = sheetFaces(drawn.face, library);
    container.dataset.view = "globe";
    container.dataset.surfaceId = "globe";
    container.dataset.forestMode = layers.mode;
    container.dataset.globeShown = "true";
    root.render(<>
      <div className="forest-globe">
        <PlanetView core={core} scene={drawn.scene} places={drawn.places} wisps={drawn.wisps}
          selected={drawn.selected} selectedCapability={drawn.capability} highlighted={drawn.highlighted} circled={drawn.circled} circledContracts={drawn.circledContracts}
          onPick={pick} onNote={pickNote} onStore={pickStore} onControls={onControls} onPainted={painted.painted} mode={layers.mode} framing={globeFraming(opening)} aside={drawn.aside} library={layers.library}
          onLanesNotice={onLanesNotice} onLibraryHung={libraryOpens.hung} />
      </div>
      <LibraryProgress shown={drawn.libraryBar} />
      <ForestTop layers={layers} onTurn={turn} notice={drawn.lanesNotice} aside={drawn.aside} rings={openWorkCount(drawn.scene, drawn.circled, drawn.circledContracts)}
        islands={drawn.scene.islands.map(island => ({ story: island.story, territories: island.land?.territories }))} />
      <EmptyMap read={drawn.read} face={drawn.face} islands={drawn.scene.islands.length} onGuide={openGuide} />
      {layers.mode === "library" && <KnowledgeKinds core={core} />}
    </>);
  };
  const selection = new PanelSelection(next => {
    core.pin(next?.kind === "note" ? next.id : undefined);
    render({ selected: next?.kind === "story" ? next.id : undefined, capability: next?.kind === "story" ? next.capability : undefined });
    onSelect(next);
  });
  const libraryOpens = libraryOpening(shown => render({ libraryBar: shown }), libraryBarAfterMs);
  const turn = (face: SheetFace): void => {
    if (face === drawn.face) return;
    if (library) libraryOpens.turned(face);
    render({ face });
    selection.turned(face);
  };
  const pick = (story: string | undefined, capability?: string, gate?: readonly [string, string]): void => selection.picked(story, capability, gate);
  const pickNote = (note: string): void => selection.note(note);
  const pickStore = (address: string): void => selection.store(address);
  const onLanesNotice = (notice: LanesNotice | undefined): void => render({ lanesNotice: notice });
  const onKey = (event: KeyboardEvent): void => selection.key(event.key);
  let controls: PlacedGlobeControls | undefined;
  const onControls = (next: PlacedGlobeControls | undefined): void => { controls = next; };
  const page = window as { storytreeGlobe?: GlobeLocator };
  page.storytreeGlobe = globeLocator({ controls: () => controls, scene: () => drawn.scene,
    box: () => (container.querySelector("canvas") ?? container).getBoundingClientRect(), aside: () => measuredAside(), names: () => drawnNames(container) });
  window.addEventListener("keydown", onKey);

  const panel = container.parentElement?.querySelector<HTMLElement>(":scope > .story-panel") ?? undefined;
  const measuredAside = (): number => panel === undefined ? 0 : panelAside(container.getBoundingClientRect(), [...panel.getClientRects()]);
  const measure = (): void => {
    const { clientWidth: width, clientHeight: height } = container;
    const aside = measuredAside();
    if (width > 0 && height > 0 && (width !== drawn.viewport?.width || height !== drawn.viewport.height || aside !== drawn.aside)) render({ viewport: { width, height }, aside });
  };
  const observer = new ResizeObserver(measure);
  observer.observe(container);
  const shown = new MutationObserver(measure);
  if (panel !== undefined) { observer.observe(panel); shown.observe(panel, { attributes: true, attributeFilter: ["hidden"] }); }
  const stopPicks = panel === undefined ? undefined : panelPicks(panel, selection);

  return {
    show(scene, places) {
      const next = nextScene(drawn, scene, places);
      if (next !== undefined) render({ scene: next, places, read: true });
      else if (!drawn.read) render({ read: true });
      painted.shown(drawn.scene);
    },
    drawn: () => painted.drawn(),
    showWisps(wisps) {
      if (!sameWisps(wisps, drawn.wisps)) render({ wisps });
    },
    highlight(stories) {
      render({ highlighted: stories });
    },
    circle(capabilities, contracts) {
      render({ circled: capabilities, circledContracts: contracts });
    },
    select(story) {
      selection.story(story);
    },
    dispose() {
      libraryOpens.hung();
      window.removeEventListener("keydown", onKey);
      delete page.storytreeGlobe;
      core.dispose();
      observer.disconnect();
      shown.disconnect();
      stopPicks?.();
      root.unmount();
      container.replaceChildren();
    },
  };
}

export function mountLibraryPanel(container: HTMLElement, core: KnowledgeCore, onClose: () => void): () => void {
  const root = createRoot(container);
  root.render(<KnowledgeNoteCard core={core} onClose={onClose} />);
  Object.assign(container.dataset, { surfaceId: "library", surfaceLayer: "panel" });
  return () => {
    root.unmount();
    delete container.dataset.surfaceId;
    delete container.dataset.surfaceLayer;
  };
}
