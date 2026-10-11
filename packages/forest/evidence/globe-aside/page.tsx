// Forest 3.40: the mounted globe beside the right-hand story panel, as the desktop app lays them out.
// The scene is the saved code-rows reading; a pick opens the story's own drill-down in the panel.
import { drillDown, forestScene, storyNodes } from "@storytree/forest";
import { workStates } from "@storytree/arc-surface";
import { createKnowledgeCore } from "@storytree/knowledge-core/view";
import { openForestView, renderStoryPanel } from "../../src/view/index.js";
import "../../src/view/styles.css";

declare const __SEED__: any;
declare const __SURVEY__: any;
const seed = __SEED__, survey = __SURVEY__;
const states = workStates([]);
const scene = forestScene(seed.tree, seed.changes.changes, states, survey);
const places = new Map(storyNodes(seed.tree, seed.changes.changes, survey).map(node => [node.id, node.place]));

let globe: (() => any) | undefined;
(globalThis as any).__storytreeCaptureGlobe = (get: () => any) => { globe = get; };
const holder = document.querySelector<HTMLElement>("#globe")!;
const panel = document.querySelector<HTMLElement>("#content > .story-panel")!;

Object.assign(window, { proof: {
  stories: scene.islands.map(island => island.story),
  async open() {
    const view = await openForestView(holder, selection => {
      const drilled = selection?.kind === "story" ? drillDown(seed.tree, selection.id, states, seed.changes.changes, survey) : undefined;
      panel.hidden = drilled === undefined;
      panel.innerHTML = drilled === undefined ? "" : renderStoryPanel(drilled, undefined);
    }, createKnowledgeCore("globe-aside-proof"));
    view.show(scene, places);
    Object.assign(window, { view });
  },
  ready: () => globe !== undefined && document.querySelectorAll(".planet-nameplate").length > 0,
  select: (story: string | undefined) => (window as any).view.select(story),
  /** Where the globe's centre is drawn, in CSS pixels, and how close it is framed. */
  globe() {
    const { camera, size } = globe!();
    return { centre: size.width / 2 - (camera.view?.enabled ? camera.view.offsetX : 0), zoom: camera.zoom, width: size.width };
  },
} });
