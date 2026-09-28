/**
 * The page's glue: it asks the main process (through the preload's functions) for the projects, and
 * draws the project on show as its 3D forest (the forest story, capability 3), kept current by the
 * arc surface's live reading (@storytree/arc-surface). `data-state` on the body says where it got to
 * (loading, ready, empty, missing, error), and `data-drew` what the forest drew, both of which the
 * smoke check reads. `data-selected` names the story node a click selected.
 */
import type { Line } from "@storytree/agent-link";
import { followProjects, type ProjectSelection } from "@storytree/app/projects";
import { mountAppMenu } from "@storytree/app/view";
import { mountSetupHelp } from "@storytree/app-setup/view";
import { liveReading, workStates, type LiveReading } from "@storytree/arc-surface";
import { mountArcSurface, type ArcSurface } from "@storytree/arc-surface/view";
import { drillDown, forestDrawn, forestScene, selectedCapability, storyNodes, type ForestDrawn } from "@storytree/forest";
import type { AnnotatedTree, Change } from "@storytree/library";

import type { StorytreeBridge } from "../bridge.js";
import { createKnowledgeCore } from "@storytree/knowledge-core/view";

import { attachPanZoom, openForestView, mountArtifactCard, renderStoryPanel, mountSessionsList, mountTreeSpace, type ForestView, type PanZoom, type TreeSpace } from "@storytree/forest/view";
import { renderNoProjects } from "../view/view.js";

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
  chooseProject: async (name) => { await window.storytree.chooseProject(name); },
  onChosen: () => following?.refresh(),
  onError: (error) => {
    showMessage("error", "The project could not be selected", messageOf(error));
    void following?.refresh(true);
  },
  mountHelp: (host, returnFocus, onOpen) => mountSetupHelp(host, window.storytree, { returnFocus, embedded: true, onOpen }),
});
window.addEventListener("beforeunload", () => appMenu.stop());

/** The project on show's forest and live reading, stopped when another project is shown. */
let showing: { reading: LiveReading | undefined; view: ForestView | undefined; arcs: ArcSurface | undefined; sessions: ReturnType<typeof mountSessionsList> | undefined; card: (() => void) | undefined; tree: TreeSpace | undefined } | undefined;
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
  const mine: NonNullable<typeof showing> = { reading: undefined, view: undefined, arcs: undefined, sessions: undefined, card: undefined, tree: undefined };
  showing = mine;
  mine.arcs = mountArcSurface(content, { project: name, reads: window.storytree });
  const history: Change[] = [];
  const lines: Line[] = [];
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
      mine.card ??= mountArtifactCard(panel, core, () => mine.view?.select(undefined));
      return;
    }
    mine.card?.();
    mine.card = undefined;
    const story = document.body.dataset.selected;
    const drilled = story === undefined || tree === undefined ? undefined : drillDown(tree, story, workStates(lines), history);
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
    panel.innerHTML = renderStoryPanel(drilled, selected);
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
      });
      if (kept === undefined) moving.fit();
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
  mine.tree = mountTreeSpace(content, {
    choose: (id) => {
      chosen = id;
      showPanel();
    },
    closed: () => panel.querySelector<HTMLButtonElement>("[data-open-tree]")?.focus(),
  });
  const core = createKnowledgeCore(name);
  const view = await openForestView(holder, (selection) => {
    delete document.body.dataset.selected;
    delete document.body.dataset.note;
    if (selection?.kind === "story") document.body.dataset.selected = selection.id;
    if (selection?.kind === "note") document.body.dataset.note = selection.id;
    chosen = undefined;
    showPanel();
  }, core, session => mine.sessions?.hover(session));
  if (showing !== mine) return view.dispose();
  mine.view = view;
  mine.sessions = mountSessionsList(content, { project: name, reads: window.storytree,
    onHighlight: (stories, session) => view.highlight(stories, session), onWisps: wisps => view.showWisps(wisps),
    onRoster: roster => core.showRoster(roster), onSelect: session => core.select(session) });
  core.onSelect(session => mine.sessions?.select(session));

  let drawing = Promise.resolve();
  mine.reading = liveReading({
    project: name,
    reads: window.storytree,
    onNews: (news) => {
      // One news at a time, in the order it came, so a slow tree read never draws over a newer one.
      drawing = drawing.then(async () => {
        history.push(...news.changes);
        lines.push(...news.lines);
        if (tree === undefined || news.changes.length > 0) tree = await window.storytree.projectTree(name);
        if (showing !== mine) return;
        const scene = forestScene(tree, history, workStates(lines));
        view.show(scene, new Map(storyNodes(tree, history).map(node => [node.id, node.place])));
        core.take(history, news.lines);
        sayWhatWasDrawn(forestDrawn(scene));
        if (!panel.hidden) showPanel();
        setState("ready");
      }).catch((error: unknown) => {
        if (showing === mine && document.body.dataset.state !== "ready") showMessage("error", "Something went wrong", messageOf(error));
      });
    },
    // A quiet holder's wisp fades on the sessions list's own clock (capability 5), not this one.
    onClock: () => {},
    onError: (error) => {
      if (showing === mine && document.body.dataset.state !== "ready") showMessage("error", "The forest could not be read", messageOf(error));
    },
  });
}

function stopShowing(): void {
  showing?.card?.();
  showing?.tree?.stop();
  showing?.arcs?.stop();
  showing?.reading?.stop();
  showing?.sessions?.stop();
  showing?.view?.dispose();
  showing = undefined;
  delete document.body.dataset.surface;
  delete document.body.dataset.note;
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
