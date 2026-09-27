/**
 * The page's glue: it asks the main process (through the preload's functions) for the projects, and
 * draws the project on show as its 3D forest (the forest story, capability 3), kept current by the
 * arc surface's live reading (@storytree/arc-surface). `data-state` on the body says where it got to
 * (loading, ready, empty, missing, error), and `data-drew` what the forest drew, both of which the
 * smoke check reads. `data-selected` names the story node a click selected.
 */
import type { Line } from "@storytree/agent-link";
import { followProjects, type ProjectSelection } from "@storytree/app/projects";
import { mountSetupHelp } from "@storytree/app-setup/view";
import { liveReading, workStates, type LiveReading } from "@storytree/arc-surface";
import { mountArcSurface, type ArcSurface } from "@storytree/arc-surface/view";
import { claimMarkers, drillDown, forestDrawn, forestScene, selectedCapability, storyNodes, unclaimedWork, type ForestDrawn } from "@storytree/forest";
import type { AnnotatedTree, Change } from "@storytree/library";

import type { StorytreeBridge } from "../bridge.js";
import { createKnowledgeCore } from "@storytree/knowledge-core/view";

import { openForestView, mountArtifactCard, renderStoryPanel, renderUnclaimed, type ForestView } from "@storytree/forest/view";
import { renderNoProjects, renderSwitcher } from "../view/view.js";

declare global {
  interface Window {
    readonly storytree: StorytreeBridge;
  }
}

const content = element("content");
const switcher = element("switcher");
const params = new URLSearchParams(location.search);
const help = mountSetupHelp(element("help"), window.storytree);
window.addEventListener("beforeunload", () => help.stop());

/** The project on show's forest and live reading, stopped when another project is shown. */
let showing: { reading: LiveReading | undefined; view: ForestView | undefined; arcs: ArcSurface | undefined; card: (() => void) | undefined } | undefined;
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
  switcher.innerHTML = projects.length === 0 ? "" : renderSwitcher(projects, projects.includes(name ?? "") ? name : undefined);
  const select = switcher.querySelector("select");
  if (select !== null) {
    if (!projects.includes(name ?? "")) select.selectedIndex = -1;
    select.addEventListener("change", () => {
      void window.storytree.chooseProject(select.value).then(() => following?.refresh())
        .catch((error: unknown) => {
          showMessage("error", "The project could not be selected", messageOf(error));
          void following?.refresh(true);
        });
    });
  }
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
    return showMessage("missing", `There is no project called “${name}”`, "Pick one of the projects in the switcher above.");
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
  const unclaimed = document.createElement("aside");
  unclaimed.className = "unclaimed";
  content.replaceChildren(holder, panel, unclaimed);
  document.body.dataset.surface = "forest";
  const mine: NonNullable<typeof showing> = { reading: undefined, view: undefined, arcs: undefined, card: undefined };
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

  /** The drill-down for the selected story node, or none (capability 4), with one capability shown below its diagram. */
  const showPanel = (): void => {
    if (document.body.dataset.note !== undefined) {
      panel.hidden = false;
      mine.card ??= mountArtifactCard(panel, core, () => mine.view?.select(undefined));
      return;
    }
    mine.card?.();
    mine.card = undefined;
    const story = document.body.dataset.selected;
    const drilled = story === undefined || tree === undefined ? undefined : drillDown(tree, story, workStates(lines), history);
    panel.hidden = drilled === undefined;
    if (story === undefined || drilled === undefined) return panel.replaceChildren();
    const selected = selectedCapability(drilled, chosen);
    chosen = selected;
    const open = new Set([...panel.querySelectorAll<HTMLElement>("details[open]")].map((node) => node.closest<HTMLElement>("[data-capability-id]")?.dataset.capabilityId));
    panel.innerHTML = renderStoryPanel(drilled, selected);
    for (const node of panel.querySelectorAll<HTMLElement>(".panel-detail")) {
      if (open.has(node.dataset.capabilityId)) node.querySelector("details")?.setAttribute("open", "");
    }
    for (const box of panel.querySelectorAll<SVGGElement>(".panel-diagram [data-capability-id]")) {
      const choose = (): void => {
        chosen = box.dataset.capabilityId;
        showPanel();
        panel.querySelector<SVGGElement>(".panel-diagram .selected")?.focus();
      };
      box.addEventListener("click", choose);
      box.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        choose();
      });
    }
    panel.querySelector(".panel-close")?.addEventListener("click", () => {
      mine.view?.select(undefined);
    });
  };
  const core = createKnowledgeCore(name);
  const view = await openForestView(holder, (selection) => {
    delete document.body.dataset.selected;
    delete document.body.dataset.note;
    if (selection?.kind === "story") document.body.dataset.selected = selection.id;
    if (selection?.kind === "note") document.body.dataset.note = selection.id;
    chosen = undefined;
    showPanel();
  }, core);
  if (showing !== mine) return view.dispose();
  mine.view = view;

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
        view.showMarkers(claimMarkers(lines, new Date()));
        core.take(history, news.lines);
        const work = unclaimedWork(lines);
        unclaimed.innerHTML = renderUnclaimed(work, unclaimed.querySelector("details")?.open === true);
        sayWhatWasDrawn({ ...forestDrawn(scene), unclaimed: work.count });
        if (!panel.hidden) showPanel();
        setState("ready");
      }).catch((error: unknown) => {
        if (showing === mine && document.body.dataset.state !== "ready") showMessage("error", "Something went wrong", messageOf(error));
      });
    },
    // Once a minute, with no new line, a quiet holder's marker fades (capability 5).
    onClock: (now) => {
      if (showing === mine) view.showMarkers(claimMarkers(lines, new Date(now)));
    },
    onError: (error) => {
      if (showing === mine && document.body.dataset.state !== "ready") showMessage("error", "The forest could not be read", messageOf(error));
    },
  });
}

function stopShowing(): void {
  showing?.card?.();
  showing?.arcs?.stop();
  showing?.reading?.stop();
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
function sayWhatWasDrawn(drawn: ForestDrawn & { unclaimed: number }): void {
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
