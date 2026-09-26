/**
 * The page's glue: it asks the main process (through the preload's functions) for the projects, and
 * draws the project on show as its 3D forest (stories/forest.md, capability 3), kept current by the
 * arc surface's live reading (@storytree/arc-surface). `data-state` on the body says where it got to
 * (loading, ready, empty, missing, error), and `data-drew` what the forest drew, both of which the
 * smoke check reads. `data-selected` names the story node a click selected.
 */
import type { Line } from "@storytree/agent-link";
import { liveReading, workStates, type LiveReading } from "@storytree/arc-surface";
import { claimMarkers, drillDown, forestDrawn, forestScene, openBook, shelved, unclaimedWork, type Book, type ForestDrawn } from "@storytree/forest";
import type { AnnotatedTree, Change, SchemaRecord } from "@storytree/library";

import type { StorytreeBridge } from "../bridge.js";
import { openForestView, type ForestView } from "../forest/forest-view.js";
import { renderStoryPanel } from "../forest/story-panel.js";
import { renderUnclaimed } from "../forest/unclaimed-list.js";
import { renderNoProjects, renderSwitcher } from "../view/view.js";

declare global {
  interface Window {
    readonly storytree: StorytreeBridge;
  }
}

const content = element("content");
const switcher = element("switcher");
const params = new URLSearchParams(location.search);

/** The project on show's forest and live reading, stopped when another project is shown. */
let showing: { reading: LiveReading | undefined; view: ForestView | undefined } | undefined;

void open().catch((error: unknown) => showMessage("error", "Something went wrong", messageOf(error)));

async function open(): Promise<void> {
  const problem = params.get("problem");
  if (problem !== null) return showMessage("error", "The library could not be opened", problem);
  const projects = await window.storytree.listProjects();
  if (projects.length === 0) {
    content.innerHTML = renderNoProjects();
    return setState("empty");
  }
  await show(params.get("project") ?? projects[0] ?? "", projects);
}

/** Show project `name`, with the switcher listing `projects`. */
async function show(name: string, projects: readonly string[]): Promise<void> {
  stopShowing();
  setState("loading");
  delete document.body.dataset.drew;
  delete document.body.dataset.selected;
  switcher.innerHTML = renderSwitcher(projects, projects.includes(name) ? name : undefined);
  const select = switcher.querySelector("select");
  if (select !== null) {
    if (!projects.includes(name)) select.selectedIndex = -1;
    select.addEventListener("change", () => void show(select.value, projects).catch((error: unknown) => showMessage("error", "Something went wrong", messageOf(error))));
  }
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
  const mine: NonNullable<typeof showing> = { reading: undefined, view: undefined };
  showing = mine;
  const history: Change[] = [];
  const lines: Line[] = [];
  let tree: AnnotatedTree | undefined;
  /**
   * The front covers of each story and its capabilities, as asked for and as read (capability 7),
   * asked again when the knowledge changes; and the book open on them.
   */
  const asked = new Set<string>();
  const shelvesRead = new Map<string, SchemaRecord<"decision">[]>();
  let book: Book | undefined;

  /** Read the front covers of `story` and its capabilities, once, and show the panel again when they come. */
  const readShelves = (story: string, nodes: readonly string[]): void => {
    if (asked.has(story)) return;
    asked.add(story);
    Promise.all(nodes.map((node) => window.storytree.frontCovers(name, node))).then(
      (shelves) => {
        shelvesRead.set(story, shelves.flat());
        showPanel();
      },
      () => asked.delete(story),
    );
  };

  /** Open the book `id` on the panel's shelves, or close it if it is the one open. */
  const toggleBook = async (id: string): Promise<void> => {
    if (book?.id === id) {
      book = undefined;
      return showPanel();
    }
    const cover = [...shelvesRead.values()].flat().find((each) => each.id === id);
    if (cover === undefined) return;
    book = openBook(cover, await window.storytree.relatedNotes(name, id), history);
    showPanel();
  };

  /** The drill-down for the selected story node, or none (capability 4), with its shelves once read (capability 7). */
  const showPanel = (): void => {
    const story = document.body.dataset.selected;
    const drilled = story === undefined || tree === undefined ? undefined : drillDown(tree, story, workStates(lines), history);
    panel.hidden = drilled === undefined;
    if (story === undefined || drilled === undefined) return panel.replaceChildren();
    readShelves(story, [drilled.story, ...drilled.capabilities.map(({ id }) => id)]);
    const read = shelvesRead.get(story);
    const opened = read === undefined ? drilled : shelved(drilled, read);
    const open = new Set([...panel.querySelectorAll<HTMLElement>("details[open]")].map((node) => node.closest<HTMLElement>("[data-capability-id]")?.dataset.capabilityId));
    panel.innerHTML = renderStoryPanel(opened, book);
    for (const node of panel.querySelectorAll<HTMLElement>("[data-capability-id]")) {
      if (open.has(node.dataset.capabilityId)) node.querySelector("details")?.setAttribute("open", "");
    }
    for (const spine of panel.querySelectorAll<HTMLElement>("[data-book-id]")) {
      spine.addEventListener("click", () => void toggleBook(spine.dataset.bookId ?? "").catch(() => {}));
    }
    panel.querySelector(".panel-close")?.addEventListener("click", () => {
      delete document.body.dataset.selected;
      mine.view?.select(undefined);
      showPanel();
    });
  };
  const view = await openForestView(holder, (story) => {
    if (story === undefined) delete document.body.dataset.selected;
    else document.body.dataset.selected = story;
    book = undefined;
    showPanel();
  });
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
        // A note written or edited may change a shelf, or the book open: read them again.
        if (news.changes.some(({ type }) => type === "decision" || type === "memory" || type === "definition")) {
          asked.clear(); // the shelves on show stay until they are read again, so they never blink
          book = undefined;
        }
        lines.push(...news.lines);
        if (tree === undefined || news.changes.length > 0) tree = await window.storytree.projectTree(name);
        if (showing !== mine) return;
        const scene = forestScene(tree, history, workStates(lines));
        view.show(scene);
        view.showMarkers(claimMarkers(lines, new Date()));
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
  showing?.reading?.stop();
  showing?.view?.dispose();
  showing = undefined;
  delete document.body.dataset.surface;
}

/**
 * Say what the forest drew, as every surface does once it has drawn a project: the stories and
 * capabilities it drew, by id, with its own fields added. The smoke check judges the surface on
 * show by it.
 */
function sayWhatWasDrawn(drawn: ForestDrawn & { unclaimed: number }): void {
  document.body.dataset.drew = JSON.stringify(drawn);
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
