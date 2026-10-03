// The mounted Forest views, entered through their public module as the desktop app and website mount them.
// The scene is the saved code-rows reading; one labelled fixture session holds one capability.
import { drillDown, forestScene, storyNodes } from "@storytree/forest";
import { workStates } from "@storytree/arc-surface";
import { createKnowledgeCore } from "@storytree/knowledge-core/view";
import * as forestView from "../../src/view/index.js";
import "../../src/view/styles.css";

declare const __SEED__: any;
declare const __SURVEY__: any;
const seed = __SEED__, survey = __SURVEY__;
const states = workStates([]);
const scene = forestScene(seed.tree, seed.changes.changes, states, survey);
const places = new Map(storyNodes(seed.tree, seed.changes.changes, survey).map(node => [node.id, node.place]));
const held = scene.islands.find(island => island.land?.territories.some(territory => territory.capability))!;
const capability = held.land!.territories.find(territory => territory.capability)!.capability!;
const wisps = [{ session: "proof-fixture", story: held.story, colour: "#a688ed", phase: 0, faded: false, capabilities: [capability] }];

// Every name the public module exports, read through it: the desktop renderer and the website import these.
const exported = Object.fromEntries(Object.keys(forestView).map(name => [name, typeof Reflect.get(forestView, name)]));
const { openForestView, mountLibraryPanel, mountTreeSpace } = forestView;

let globe: (() => any) | undefined;
(globalThis as any).__storytreeCaptureGlobe = (get: () => any) => { globe = get; };
const host = document.querySelector<HTMLElement>("#globe")!;
const selections: unknown[] = [];
let view: forestView.ForestView | undefined;

/** Each plate mesh's session brightness, by its island's story: undefined where nothing lights or dims it. */
function brightness() {
  const found: Record<string, number[]> = {};
  globe!().scene.traverse((object: any) => {
    const value = object.material?.userData?.sessionBrightness;
    if (value === undefined) return;
    let at = object;
    while (at && !String(at.name).startsWith("planet:")) at = at.parent;
    const story = String(at?.name ?? "planet:").slice("planet:".length);
    (found[story] ??= []).push(value);
  });
  return found;
}

Object.assign(window, { proof: {
  exported, story: held.story, stories: scene.islands.map(island => island.story),
  async open() {
    const core = createKnowledgeCore("mounted-views-proof");
    core.take(seed.changes.changes, []);
    view = await openForestView(host, selection => selections.push(selection ?? null), core);
    view.show(scene, places);
    view.showWisps(wisps);
  },
  ready: () => globe !== undefined && document.querySelectorAll(".planet-nameplate").length > 0,
  canvas: () => globe?.().gl.domElement,
  selections: () => selections,
  marks: (prefix: string) => { const names: string[] = []; globe!().scene.traverse((o: any) => { if (String(o.name).startsWith(prefix)) names.push(o.name); }); return names; },
  highlight: (stories: string[] | undefined, session?: string) => view!.highlight(stories, session),
  select: (story: string | undefined) => view!.select(story),
  brightness,
  libraryCard() {
    const slot = document.querySelector<HTMLElement>("#panel")!;
    let closed = 0;
    const unmount = mountLibraryPanel(slot, createKnowledgeCore("mounted-views-proof"), () => { closed++; });
    return { unmount: () => { unmount(); return closed; } };
  },
  dispose: () => { view!.dispose(); view = undefined; },
  tree(story: string) {
    const panel = drillDown(seed.tree, story, states, seed.changes.changes)!;
    const chosen: string[] = [];
    let closed = 0;
    const space = mountTreeSpace(document.querySelector<HTMLElement>("#content")!, { choose: id => chosen.push(id), closed: () => { closed++; } });
    space.show(panel, undefined);
    return { capabilities: panel.capabilities.map(row => row.id), chosen: () => chosen, closed: () => closed, open: () => space.open,
      redraw: (selected: string) => space.show(panel, selected), stop: () => space.stop() };
  },
} });
