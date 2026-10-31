/**
 * Capability 2 · Storytree projects. The page's glue: it asks the main process (through the preload's functions) for the projects, and
 * draws the project on show as its 3D forest (the forest story, capability 3), kept current by the
 * arc surface's live reading (@storytree/arc-surface). `data-state` on the body says where it got to
 * (loading, ready, empty, missing, error), and `data-drew` what the forest drew, both of which the
 * smoke check reads. `data-fresh="no"` marks a forest drawn from the tree kept at the last start,
 * shown while the state is still loading. `data-selected` names the story node a click selected. `data-start` says whether the
 * forest on show is still settling (the fresh tree or the start's first code survey still to come), while a bar is on show, or
 * settled (7.31), which the lag run reads.
 */
import { followProjects, type ProjectSelection } from "@storytree/app/projects";
import { surfaceOn, surfaceSetting } from "@storytree/app/surfaces";
import { mountAppMenu, renderNoProjects } from "@storytree/app/view";
import { mountAddProject, mountDeleteProject, mountFactory, mountProjectSentence, mountRemoveProject, mountSetupHelp } from "@storytree/app-setup/view";
import { joinedReads, keptWorkStates, pageKeptReading, pageReading, type LiveReading, type PageReading } from "@storytree/arc-surface";
import { mountArcSurface, type ArcSurface } from "@storytree/arc-surface/view";
import { drawingOf, drillDown, forestDrawn, forestReading, forestScene, keptDrawing, keptTree, selectedCapability, storyNodes, type ForestDrawn } from "@storytree/forest";
import { mountJourneyConsent, mountJourneySettings } from "@storytree/app-setup/journey-events/view";
import { journal, type Target } from "@storytree/teaching-cards";
import { mountJournal, mountTeaching } from "@storytree/teaching-cards/view";
import { mountLagRecorder } from "@storytree/app/lag/view";
import { mountFeedbackCorner } from "@storytree/surface-feedback/view";
import type { AnnotatedTree } from "@storytree/library";
import { outageSaidOnce } from "@storytree/library/connection-error";

import type { StorytreeBridge } from "../bridge.js";
import { mountPluginViews } from "./plugin-views.js";
import { createKnowledgeCore } from "@storytree/knowledge-core/view";

import { attachPanZoom, openForestView, mountLibraryPanel, renderStoryPanel, mountSessionsList, mountTreeSpace, type ForestView, type GlobeLocator, type GlobeOpening, type PanZoom, type TreeOpening, type TreeSpace } from "@storytree/forest/view";

declare global {
  interface Window {
    readonly storytree: StorytreeBridge;
  }
}

const content = element("content");
/** The cards seen, kept for this user on this machine, so a kind is taught once across projects (Learning as you build). */
const seenCards = journal(window.localStorage);
const params = new URLSearchParams(location.search);
const appMenu = mountAppMenu(element("app-menu-host"), {
  background: content,
  checkForUpdates: (action) => window.storytree.checkForUpdates(action),
  signIn: { read: () => window.storytree.readSignIn(), set: (on) => window.storytree.setSignIn(on) },
  installChoice: { read: () => window.storytree.readInstallChoice(), set: (choice) => window.storytree.setInstallChoice(choice) },
  releaseChannel: { read: () => window.storytree.readReleaseChannel(), set: (channel) => window.storytree.setReleaseChannel(channel) },
  chooseProject: async (name) => { await window.storytree.chooseProject(name); },
  onChosen: () => following?.refresh(),
  // A surface switched or set in the Surfaces menu shows at once: the project is drawn again.
  onSurfacesChanged: () => { if (current !== undefined && showing !== undefined) void redraw(current); },
  onError: (error) => {
    logFailure("the project could not be selected", error);
    showMessage("error", "The project could not be selected", messageOf(error));
    void following?.refresh(true);
  },
  mountJourney: (host) => mountJourneySettings(host, window.storytree),
  // Help holds the setup guide and, below it, the journal of teaching cards seen.
  mountHelp: (host, returnFocus, onOpen) => {
    const setup = mountSetupHelp(host, window.storytree, { returnFocus, embedded: true, onOpen });
    const learned = mountJournal(host, { journal: seenCards });
    return {
      open() { setup.open(); learned.open(); },
      close() { setup.close(); learned.close(); },
      stop() { setup.stop(); learned.stop(); },
    };
  },
  mountAddProject: (host, onAdded) => mountAddProject(host, window.storytree, { onAdded }),
  mountProjectSentence: (host, current) => mountProjectSentence(host, window.storytree, { current }),
  mountRemoveProject: (host, current, onRemoved) => mountRemoveProject(host, window.storytree, { current, onRemoved }),
  mountDeleteProject: (host, onDeleted) => mountDeleteProject(host, window.storytree, { onDeleted }),
  mountFactory: (host) => mountFactory(host, window.storytree),
});
const consentHost = document.createElement("div");
document.body.append(consentHost);
const consent = mountJourneyConsent(consentHost, window.storytree);
const lagRecorder = mountLagRecorder(window.storytree);
// The feedback corner, above every canvas; a note records the project on show and the story node or note selected.
const corner = mountFeedbackCorner(document, window.storytree, {
  shown: () => ({ project: document.body.dataset.project, selection: document.body.dataset.selected ?? document.body.dataset.note }),
});
window.addEventListener("beforeunload", () => { appMenu.stop(); consent.stop(); consentHost.remove(); lagRecorder?.stop(); corner.stop(); });

/** The project on show's forest and live reading, stopped when another project is shown. */
let showing: { page: PageReading | undefined; reading: LiveReading | undefined; view: ForestView | undefined; arcs: ArcSurface | undefined; sessions: ReturnType<typeof mountSessionsList> | undefined; card: (() => void) | undefined; tree: TreeSpace | undefined; teaching: ReturnType<typeof mountTeaching> | undefined; plugins?: { stop(): void } } | undefined;
let current: string | undefined;
/** Whether the project on show is the user's factory, which its teaching cards read (ADR-1048 D3). */
let onFactory = false;
let following: ReturnType<typeof followProjects> | undefined;

void open().catch((error: unknown) => {
  logFailure("the page could not open", error);
  showMessage("error", "Something went wrong", messageOf(error));
});

async function open(): Promise<void> {
  const problem = params.get("problem");
  if (problem !== null) return showMessage("error", "The library could not be opened", problem);
  following = followProjects({
    // The projects poll every few seconds, so their answer is the page's word that the library answers again.
    read: () => window.storytree.projectSelection().then((selection) => { outage.answered(); return selection; }),
    onChange: (selection) => show(selection),
    onError: (error) => {
      logFailure("the projects could not be read", error);
      // An intermittent read must not tear down a working forest; the next poll retries.
      if (document.body.dataset.state !== "ready" && document.body.dataset.state !== "empty") {
        showMessage("error", "The projects could not be read", messageOf(error));
      }
    },
  });
  window.addEventListener("beforeunload", () => { following?.stop(); stopShowing(); });
}

/** Redraw the picker when the list changes; only replace the surface when its project changes. */
async function show({ current: name, projects, factory }: ProjectSelection): Promise<void> {
  appMenu.update({ projects, current: name, ...(factory === undefined ? {} : { factory }) });
  onFactory = factory?.place === "factory";
  if (name === undefined) {
    current = undefined;
    stopShowing();
    showProgress(false);
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
    return showMessage("missing", `There is no project called “${name}”`, "Pick a project from the project list in the top-left corner.");
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
  showProgress(true);
  const holder = document.createElement("div");
  holder.className = "forest";
  const panel = document.createElement("aside");
  panel.className = "story-panel";
  panel.hidden = true;
  content.replaceChildren(holder, panel);
  document.body.dataset.surface = "forest";
  const mine: NonNullable<typeof showing> = { page: undefined, reading: undefined, view: undefined, arcs: undefined, sessions: undefined, card: undefined, tree: undefined, teaching: undefined };
  showing = mine;
  // The surfaces switched on in the settings file (ADR-0750); if they cannot be read, all are on.
  const read = await window.storytree.readSurfaces().catch((error: unknown) => ({ ok: false as const, error: messageOf(error) }));
  if (read?.ok === false) logFailure("the surfaces could not be read, so every surface is on", read.error);
  if (showing !== mine) return;
  const surfaces = read?.ok === true ? read.value : [];
  const withTree = surfaceOn(surfaces, "capability-tree");
  // Each is one of the choices the forest declared, or undefined for its default (the app checks it).
  const treeOpening = surfaceSetting(surfaces, "capability-tree", "opening-zoom") as TreeOpening | undefined;
  const globeOpening = surfaceSetting(surfaces, "globe", "opening-zoom") as GlobeOpening | undefined;
  // One live reading for every surface on the page, started from the reading kept at the last start
  // (ADR-0836 D3, D4); the surfaces hearing one news share one read of the tree.
  const reads = joinedReads(window.storytree);
  const page = pageReading({ project: name, reads, kept: timedRead(pageKeptReading(`storytree.page-reading.v1:${name}`)) });
  mine.page = page;
  const history = () => page.held().changes;
  const states = keptWorkStates();
  if (surfaceOn(surfaces, "arcs")) mine.arcs = mountArcSurface(content, { project: name, reads, reading: page, onFreshDraw: () => startMark("arcs first fresh draw") });
  let tree: AnnotatedTree | undefined;
  /** The code survey last read, which counts a mapped story's files and lines for its panel. */
  let surveyed: Parameters<typeof forestScene>[3] = {};
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
    const drilled = story === undefined || tree === undefined ? undefined : drillDown(tree, story, states, history(), surveyed);
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
  }, core, { library: surfaceOn(surfaces, "library"), opening: globeOpening });
  if (showing !== mine) return view.dispose();
  mine.view = view;
  // Sessions off is a quiet globe: no list, no session tints and no islands lit on hover.
  if (surfaceOn(surfaces, "sessions")) mine.sessions = mountSessionsList(content, { project: name, reads, reading: page,
    onHighlight: stories => view.highlight(stories), onWisps: wisps => view.showWisps(wisps),
    onRoster: roster => core.showRoster(roster), onSelect: session => core.select(session) });
  core.onSelect(session => mine.sessions?.select(session));
  // The first time each kind appears on this map, its card shows beside it (ADR-1048 D1).
  mine.teaching = mountTeaching(content, { journal: seenCards, locate });
  // A factory plugin standing in for a switched-off part draws its surfaces from the factory, while each is on.
  if (window.storytree.pluginViews.length > 0) {
    const plugins = await mountPluginViews(content, window.storytree.pluginViews, (id) => surfaceOn(surfaces, id), { project: name, bridge: window.storytree });
    if (showing !== mine) return plugins.stop();
    mine.plugins = plugins;
    for (const { surface, why } of plugins.failed) console.error(`The ${surface} surface could not be loaded from the factory: ${why}`);
  }

  // The tree this project last drew, at once and marked as not yet fresh, while the first read runs,
  // drawn with the survey, story order and work states it was drawn with, so the fresh drawing of an
  // unchanged project lays out nothing again. The page stays "loading" until that read lands; a
  // failure meanwhile keeps the kept forest on show.
  const kept = keptTree(name);
  const drawing = keptDrawing(name);
  const last = kept.read();
  const drawnWith = last === undefined ? undefined : drawing.read();
  if (last !== undefined) {
    const { created, states: was, survey } = drawnWith ?? { created: history(), states, survey: {} };
    view.show(forestScene(last, created, was, survey), new Map(storyNodes(last, created, survey).map(node => [node.id, node.place])));
    showFreshness("Showing the forest as last read. Refreshing…");
  }
  // A read that fails before the first one lands keeps the reading going: the next ask tries again,
  // and the forest is drawn once the library answers. Once drawn, a failed read changes nothing on show.
  const failed = (error: unknown): void => {
    if (showing !== mine) return;
    logFailure(`the forest of ${name} could not be read`, error);
    if (document.body.dataset.state === "ready") return;
    const heading = "The forest could not be read";
    if (document.body.dataset.fresh === "no") showFreshness(`${heading}: ${messageOf(error)}. Showing it as last read; retrying…`);
    else showReadError(heading, `${messageOf(error)}. Retrying…`);
  };
  mine.reading = forestReading({
    project: name,
    reads,
    reading: page,
    ...(drawnWith === undefined ? {} : { survey: drawnWith.survey }),
    onTree: (read, news, survey) => {
      if (showing !== mine) return;
      outage.answered();
      tree = read;
      surveyed = survey;
      states.add(news.lines);
      const scene = forestScene(tree, history(), states, survey);
      view.show(scene, new Map(storyNodes(tree, history(), survey).map(node => [node.id, node.place])));
      core.take(history(), news.lines);
      sayWhatWasDrawn(forestDrawn(scene));
      mine.teaching?.take({ tree, changes: history(), lines: page.held().lines, factory: onFactory });
      if (!panel.hidden) showPanel();
      kept.write(tree);
      drawing.write(drawingOf(tree, history(), states, survey));
      showFreshness(undefined);
      showReadError(undefined);
      setState("ready");
      startMark("forest first fresh draw");
    },
    onError: failed,
    onSettled: () => { if (showing === mine) showProgress(false); },
  });
}

/** The start-timing marks this page has sent; the main process writes each once to app.log (lifecycle 1.33). */
const marked = new Set<string>();
function startMark(name: string): void {
  if (marked.has(name)) return;
  marked.add(name);
  void window.storytree.startMark(name).catch((error: unknown) => logFailure(`the start mark "${name}" could not be sent`, error));
}

/** The kept reading, its read-back marked as it starts and ends (lifecycle 1.33). */
function timedRead(kept: ReturnType<typeof pageKeptReading>): ReturnType<typeof pageKeptReading> {
  return {
    ...kept,
    read: async () => {
      startMark("kept reading read start");
      try { return await kept.read(); } finally { startMark("kept reading read end"); }
    },
  };
}

/** Draw project `name` again from the start, as the surfaces now say. */
async function redraw(name: string): Promise<void> {
  stopShowing();
  setState("loading");
  delete document.body.dataset.drew;
  delete document.body.dataset.selected;
  await showForest(name).catch((error: unknown) => {
    logFailure(`the forest of ${name} could not be drawn again`, error);
    showMessage("error", "Something went wrong", messageOf(error));
  });
}

function stopShowing(): void {
  showing?.plugins?.stop();
  showing?.teaching?.stop();
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

/**
 * Where a teaching card's target is on the page: a story or capability at its island, a decision at its
 * note on the globe, a plan or a question at the arcs drawer, the factory beside the app bar's project dropdown; undefined when it
 * is not on show.
 */
function locate(target: Target): { x: number; y: number; visible: boolean } | undefined {
  const globe = (window as { storytreeGlobe?: GlobeLocator }).storytreeGlobe;
  if (target.kind === "story" || target.kind === "capability") return globe?.islands().find(island => island.story === target.story);
  if (target.kind === "note") return globe?.notes().find(note => note.note === target.note);
  if (target.kind === "switch") {
    const box = document.querySelector(".app-factory")?.getBoundingClientRect();
    return box === undefined || box.width === 0 ? undefined : { x: box.right, y: box.top + box.height / 2, visible: true };
  }
  if (target.kind === "arc" || target.kind === "question") {
    // Just past the Arcs bar's label, on the bar.
    const box = document.querySelector(".arc-surface-mount [data-open-arcs]")?.getBoundingClientRect();
    return box === undefined || box.width === 0 ? undefined : { x: box.left + 60, y: box.top + box.height / 2, visible: true };
  }
  return undefined;
}

/** Show the start's bar (index.html's, on show from the window opening) while the forest settles, or take it away when settled. */
function showProgress(on: boolean): void {
  const bar = document.getElementById("start-progress");
  if (bar !== null) bar.hidden = !on;
  document.body.dataset.start = on ? "settling" : "settled";
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
  box.dataset.surfaceId = "app-message";
  const title = document.createElement("h1");
  title.textContent = heading;
  const body = document.createElement("p");
  body.textContent = text;
  box.append(title, body);
  content.replaceChildren(box);
  showProgress(false);
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

/** The page's failures, an unreachable library said once per outage, however many polls fail meanwhile (8.11). */
const outage = outageSaidOnce((line, ...error) => console.error(`desktop renderer: ${line}`, ...error));

/** A failure the page caught, written to the console, which lifecycle 1.19 carries to app.log. */
function logFailure(what: string, error: unknown): void {
  outage.failed(what, error);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
