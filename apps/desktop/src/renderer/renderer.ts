/**
 * The page's glue: it asks the main process (through the preload's functions) for the projects, and
 * draws the project on show as its 3D forest (the forest story, capability 3), kept current by the
 * arc surface's live reading (@storytree/arc-surface). `data-state` on the body says where it got to
 * (loading, ready, empty, missing, error), and `data-drew` what the forest drew, both of which the
 * smoke check reads. `data-fresh="no"` marks a forest drawn from the tree kept at the last start,
 * shown while the state is still loading. `data-selected` names the story node a click selected.
 */
import { followProjects, type ProjectSelection } from "@storytree/app/projects";
import { surfaceOn, surfaceSetting } from "@storytree/app/surfaces";
import { mountAppMenu, renderNoProjects } from "@storytree/app/view";
import { mountAddProject, mountDeleteProject, mountRemoveProject, mountSetupHelp } from "@storytree/app-setup/view";
import { joinedReads, keptWorkStates, pageKeptReading, pageReading, type LiveReading, type PageReading } from "@storytree/arc-surface";
import { mountArcSurface, type ArcSurface } from "@storytree/arc-surface/view";
import { drillDown, forestDrawn, forestReading, forestScene, keptTree, selectedCapability, storyNodes, type ForestDrawn } from "@storytree/forest";
import type { AnnotatedTree } from "@storytree/library";

import type { StorytreeBridge } from "../bridge.js";
import { createKnowledgeCore } from "@storytree/knowledge-core/view";

import { attachPanZoom, openForestView, mountLibraryPanel, renderStoryPanel, mountSessionsList, mountTreeSpace, type ForestView, type GlobeOpening, type PanZoom, type TreeOpening, type TreeSpace } from "@storytree/forest/view";

declare global {
  interface Window {
    readonly storytree: StorytreeBridge;
  }
}

const content = element("content");
const params = new URLSearchParams(location.search);
const appMenu = mountAppMenu(element("app-menu-host"), {
  background: content,
  checkForUpdates: (action) => window.storytree.checkForUpdates(action),
  signIn: { read: () => window.storytree.readSignIn(), set: (on) => window.storytree.setSignIn(on) },
  installChoice: { read: () => window.storytree.readInstallChoice(), set: (choice) => window.storytree.setInstallChoice(choice) },
  chooseProject: async (name) => { await window.storytree.chooseProject(name); },
  onChosen: () => following?.refresh(),
  // A surface switched or set in the Surfaces menu shows at once: the project is drawn again.
  onSurfacesChanged: () => { if (current !== undefined && showing !== undefined) void redraw(current); },
  onError: (error) => {
    showMessage("error", "The project could not be selected", messageOf(error));
    void following?.refresh(true);
  },
  mountHelp: (host, returnFocus, onOpen) => mountSetupHelp(host, window.storytree, { returnFocus, embedded: true, onOpen }),
  mountAddProject: (host, onAdded) => mountAddProject(host, window.storytree, { onAdded }),
  mountRemoveProject: (host, current, onRemoved) => mountRemoveProject(host, window.storytree, { current, onRemoved }),
  mountDeleteProject: (host, onDeleted) => mountDeleteProject(host, window.storytree, { onDeleted }),
});
window.addEventListener("beforeunload", () => appMenu.stop());

/** The project on show's forest and live reading, stopped when another project is shown. */
let showing: { page: PageReading | undefined; reading: LiveReading | undefined; view: ForestView | undefined; arcs: ArcSurface | undefined; sessions: ReturnType<typeof mountSessionsList> | undefined; card: (() => void) | undefined; tree: TreeSpace | undefined } | undefined;
let current: string | undefined;
let following: ReturnType<typeof followProjects> | undefined;

void open().catch((error: unknown) => showMessage("error", "Something went wrong", messageOf(error)));

async function open(): Promise<void> {
  const problem = params.get("problem");
  if (problem !== null) return showMessage("error", "The library could not be opened", problem);
  following = followProjects({
    read: () => window.storytree.projectSelection(),
    onChange: (selection) => show(selection),
    onError: (error) => {
      // An intermittent read must not tear down a working forest; the next poll retries.
      if (document.body.dataset.state !== "ready" && document.body.dataset.state !== "empty") {
        showMessage("error", "The projects could not be read", messageOf(error));
      }
    },
  });
  window.addEventListener("beforeunload", () => { following?.stop(); stopShowing(); });
}

/** Redraw the picker when the list changes; only replace the surface when its project changes. */
async function show({ current: name, projects }: ProjectSelection): Promise<void> {
  appMenu.update({ projects, current: name });
  if (name === undefined) {
    current = undefined;
    stopShowing();
    delete document.body.dataset.project;
    delete document.body.dataset.drew;
    delete document.body.dataset.selected;
    content.innerHTML = renderNoProjects();
    return setState("empty");
  }
  if (name === current && showing !== undefined) return;
  current = name;
  stopShowing();
  setState("loading");
  document.body.dataset.project = name;
  delete document.body.dataset.drew;
  delete document.body.dataset.selected;
  if (!projects.includes(name)) {
    return showMessage("missing", `There is no project called “${name}”`, "Pick a project from the gear menu in the top-right corner.");
  }
  document.title = `${name} · storytree 0.3`;
  await showForest(name);
}

/**
 * Draw project `name` as its forest and keep it current: the live reading hands on the library's
 * changes and the agent log's lines as they come, the tree is read again when the library changed,
 * and only the story nodes that changed are redrawn, without a reload.
 */
async function showForest(name: string): Promise<void> {
  const holder = document.createElement("div");
  holder.className = "forest";
  const panel = document.createElement("aside");
  panel.className = "story-panel";
  panel.hidden = true;
  content.replaceChildren(holder, panel);
  document.body.dataset.surface = "forest";
  const mine: NonNullable<typeof showing> = { page: undefined, reading: undefined, view: undefined, arcs: undefined, sessions: undefined, card: undefined, tree: undefined };
  showing = mine;
  // The surfaces switched on in the settings file (ADR-0750); if they cannot be read, all are on.
  const read = await window.storytree.readSurfaces().catch(() => undefined);
  if (showing !== mine) return;
  const surfaces = read?.ok === true ? read.value : [];
  const withTree = surfaceOn(surfaces, "capability-tree");
  // Each is one of the choices the forest declared, or undefined for its default (the app checks it).
  const treeOpening = surfaceSetting(surfaces, "capability-tree", "opening-zoom") as TreeOpening | undefined;
  const globeOpening = surfaceSetting(surfaces, "globe", "opening-zoom") as GlobeOpening | undefined;
  // One live reading for every surface on the page, started from the reading kept at the last start
  // (ADR-0836 D3, D4); the surfaces hearing one news share one read of the tree.
  const reads = joinedReads(window.storytree);
  const page = pageReading({ project: name, reads, kept: pageKeptReading(`storytree.page-reading.v1:${name}`) });
  mine.page = page;
  const history = () => page.held().changes;
  const states = keptWorkStates();
  if (surfaceOn(surfaces, "arcs")) mine.arcs = mountArcSurface(content, { project: name, reads, reading: page });
  let tree: AnnotatedTree | undefined;
  /**
   * The capability shown below the open story's diagram (ADR-0659 D2): the one clicked, or the one
   * the panel opened on, so it holds while the live reading redraws. Cleared when another story opens.
   */
  let chosen: string | undefined;
  /** The panel's own tree space, moved by the pointer, and whose story it shows. */
  let inPanel: { story: string; moving: PanZoom } | undefined;

  /** The drill-down for the selected story node, or none (capability 4), with one capability shown below its diagram. */
  const showPanel = (): void => {
    if (document.body.dataset.note !== undefined) {
      mine.tree?.close();
      inPanel?.moving.stop();
      inPanel = undefined;
      panel.hidden = false;
      mine.card ??= mountLibraryPanel(panel, core, () => mine.view?.select(undefined));
      return;
    }
    mine.card?.();
    mine.card = undefined;
    const story = document.body.dataset.selected;
    const drilled = story === undefined || tree === undefined ? undefined : drillDown(tree, story, states, history());
    panel.hidden = drilled === undefined;
    if (story === undefined || drilled === undefined) {
      mine.tree?.close();
      inPanel?.moving.stop();
      inPanel = undefined;
      return panel.replaceChildren();
    }
    const selected = selectedCapability(drilled, chosen);
    chosen = selected;
    const open = new Set([...panel.querySelectorAll<HTMLElement>("details[open]")].map((node) => node.closest<HTMLElement>("[data-capability-id]")?.dataset.capabilityId));
    panel.innerHTML = renderStoryPanel(drilled, selected, { tree: withTree });
    for (const node of panel.querySelectorAll<HTMLElement>(".panel-detail")) {
      if (open.has(node.dataset.capabilityId)) node.querySelector("details")?.setAttribute("open", "");
    }
    // The tree's own space in the panel (ADR-0743): it keeps its view while the same story redraws.
    const kept = inPanel?.story === drilled.story ? inPanel.moving.view : undefined;
    inPanel?.moving.stop();
    inPanel = undefined;
    const frame = panel.querySelector<HTMLElement>(".panel-tree-frame");
    const surface = frame?.querySelector<HTMLElement>(".panel-tree-surface");
    if (frame != null && surface != null) {
      const moving = attachPanZoom(frame, surface, (id) => {
        chosen = id;
        showPanel();
        panel.querySelector<SVGGElement>(".panel-diagram .selected")?.focus({ preventScroll: true });
      }, treeOpening);
      if (kept === undefined) moving.open();
      else moving.place(kept);
      inPanel = { story: drilled.story, moving };
    }
    // The larger window: popped out from the panel's space, redrawn with it while open.
    const openTree = (): void => mine.tree?.show(drilled, selected);
    panel.querySelector("[data-open-tree]")?.addEventListener("click", openTree);
    if (mine.tree?.open === true) openTree();
    panel.querySelector(".panel-close")?.addEventListener("click", () => {
      mine.view?.select(undefined);
    });
  };
  if (withTree) mine.tree = mountTreeSpace(content, {
    choose: (id) => {
      chosen = id;
      showPanel();
    },
    closed: () => panel.querySelector<HTMLButtonElement>("[data-open-tree]")?.focus(),
    opening: treeOpening,
  });
  const core = createKnowledgeCore(name, { reads: window.storytree });
  const view = await openForestView(holder, (selection) => {
    delete document.body.dataset.selected;
    delete document.body.dataset.note;
    if (selection?.kind === "story") document.body.dataset.selected = selection.id;
    if (selection?.kind === "note") document.body.dataset.note = selection.id;
    // A click on a territory opens its story on that capability (forest 3.15).
    chosen = selection?.kind === "story" ? selection.capability : undefined;
    showPanel();
  }, core, session => mine.sessions?.hover(session), { library: surfaceOn(surfaces, "library"), opening: globeOpening });
  if (showing !== mine) return view.dispose();
  mine.view = view;
  // Sessions off is a quiet globe: no list, no session tints and no islands lit on hover.
  if (surfaceOn(surfaces, "sessions")) mine.sessions = mountSessionsList(content, { project: name, reads, reading: page,
    onHighlight: (stories, session) => view.highlight(stories, session), onWisps: wisps => view.showWisps(wisps),
    onRoster: roster => core.showRoster(roster), onSelect: session => core.select(session) });
  core.onSelect(session => mine.sessions?.select(session));

  // The tree this project last drew, at once and marked as not yet fresh, while the first read runs.
  // The page stays "loading" until that read lands; a failure meanwhile keeps the kept forest on show.
  const kept = keptTree(name);
  const last = kept.read();
  if (last !== undefined) {
    view.show(forestScene(last, history(), states), new Map(storyNodes(last, history()).map(node => [node.id, node.place])));
    showFreshness("Showing the forest as last read. Refreshing…");
  }
  // A read that fails before the first one lands keeps the reading going: the next ask tries again,
  // and the forest is drawn once the library answers. Once drawn, a failed read changes nothing on show.
  const failed = (error: unknown): void => {
    if (showing !== mine || document.body.dataset.state === "ready") return;
    const heading = "The forest could not be read";
    if (document.body.dataset.fresh === "no") showFreshness(`${heading}: ${messageOf(error)}. Showing it as last read; retrying…`);
    else showReadError(heading, `${messageOf(error)}. Retrying…`);
  };
  mine.reading = forestReading({
    project: name,
    reads,
    reading: page,
    onTree: (read, news, survey) => {
      if (showing !== mine) return;
      tree = read;
      states.add(news.lines);
      const scene = forestScene(tree, history(), states, survey);
      view.show(scene, new Map(storyNodes(tree, history(), survey).map(node => [node.id, node.place])));
      core.take(history(), news.lines);
      sayWhatWasDrawn(forestDrawn(scene));
      if (!panel.hidden) showPanel();
      kept.write(tree);
      showFreshness(undefined);
      showReadError(undefined);
      setState("ready");
    },
    onError: failed,
  });
}

/** Draw project `name` again from the start, as the surfaces now say. */
async function redraw(name: string): Promise<void> {
  stopShowing();
  setState("loading");
  delete document.body.dataset.drew;
  delete document.body.dataset.selected;
  await showForest(name).catch((error: unknown) => showMessage("error", "Something went wrong", messageOf(error)));
}

function stopShowing(): void {
  showing?.card?.();
  showing?.tree?.stop();
  showing?.arcs?.stop();
  showing?.reading?.stop();
  showing?.sessions?.stop();
  showing?.page?.stop();
  showing?.view?.dispose();
  showing = undefined;
  showFreshness(undefined);
  showReadError(undefined);
  delete document.body.dataset.surface;
  delete document.body.dataset.note;
}

/** Mark the forest on show as the one last read, with why (`data-fresh="no"`), or clear the mark. */
function showFreshness(text: string | undefined): void {
  let mark = document.getElementById("freshness");
  if (text === undefined) {
    mark?.remove();
    delete document.body.dataset.fresh;
    return;
  }
  if (mark === null) {
    mark = document.createElement("p");
    mark.id = "freshness";
    mark.setAttribute("role", "status");
    content.append(mark);
  }
  mark.textContent = text;
  document.body.dataset.fresh = "no";
}

/**
 * Say over the forest why its first read failed, while the reading keeps trying (`data-state="error"`
 * until a read lands), or take the notice away.
 */
function showReadError(heading: string, text: string): void;
function showReadError(clear: undefined): void;
function showReadError(heading: string | undefined, text?: string): void {
  document.getElementById("read-error")?.remove();
  if (heading === undefined) return;
  const box = document.createElement("div");
  box.id = "read-error";
  box.className = "empty";
  box.setAttribute("role", "status");
  const title = document.createElement("h1");
  title.textContent = heading;
  const body = document.createElement("p");
  body.textContent = text ?? "";
  box.append(title, body);
  content.append(box);
  setState("error");
}

/**
 * Say what the forest drew, as every surface does once it has drawn a project: the stories and
 * capabilities it drew, by id, with its own fields added. The smoke check judges the surface on
 * show by it.
 */
function sayWhatWasDrawn(drawn: ForestDrawn): void {
  // Each mounted surface contributes its own reading to the page census.
  document.body.dataset.drew = JSON.stringify({ ...JSON.parse(document.body.dataset.drew ?? "{}"), ...drawn });
}

/** A heading and a line of text in place of the project, written as text (never as HTML). */
function showMessage(state: string, heading: string, text: string): void {
  stopShowing();
  const box = document.createElement("div");
  box.className = "empty";
  const title = document.createElement("h1");
  title.textContent = heading;
  const body = document.createElement("p");
  body.textContent = text;
  box.append(title, body);
  content.replaceChildren(box);
  setState(state);
}

function setState(state: string): void {
  document.body.dataset.state = state;
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`the page has no #${id}`);
  return found;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
