// Capability 2 · Storytree projects
import { drawingOf, drillDown, forestDrawn, forestScene, linkedStores, storyNodes, type ForestReadingOptions, type ForestScene, type KeptDrawing, type StoryPanel } from "@storytree/forest";
import type { AnnotatedTree, SharedStore } from "@storytree/library";

import { followProjects, type ProjectSelection } from "../projects/follow.js";
import { surfaceOn, surfaceSetting, type SurfacesResult } from "../surfaces/bridge.js";
import { renderNoProjects } from "../view/render.js";
import { drawnIslands, locateTarget, readingNear, type Box, type CardTarget, type IslandsAndNotes, type Place } from "./locate.js";
import { mountRail, type Rail, type RailTab } from "./rail.js";
import { pageStatus } from "./status.js";
import { storyPanel, type StoryPanelView } from "./story-panel.js";

type PageReading = NonNullable<ForestReadingOptions["reading"]>;
type News = Parameters<ForestReadingOptions["onTree"]>[1];
type Survey = NonNullable<Parameters<typeof forestScene>[3]>;
type PartStates = Parameters<typeof forestScene>[2];
type Held = ReturnType<PageReading["held"]>;
type Changes = Held["changes"];

export type ForestSelection = { kind: "story"; id: string; capability?: string; gate?: readonly [string, string] } | { kind: "note"; id: string } | { kind: "store"; id: string } | undefined;

export interface ForestGlobe {
  show(scene: ForestScene, places: ReadonlyMap<string, number>): void;
  drawn(): Promise<void>;
  select(story: string | undefined): void;
  circle(capabilities: readonly string[] | undefined, contracts?: readonly string[] | undefined): void;
  dispose(): void;
}

export type TimedRead = <K extends { read(): Promise<unknown> }>(kept: K) => K;

export interface ProjectParts<View extends ForestGlobe = ForestGlobe> {
  page: PageReading;
  states: PartStates & { add(lines: News["lines"]): void };
  kept: { read(): AnnotatedTree | undefined; write(tree: AnnotatedTree): void };
  drawing: { read(): KeptDrawing | undefined; write(drawing: ReturnType<typeof drawingOf>): void };
  arcs(host: HTMLElement, on: { onFreshDraw(): void; onWaiting(count: number): void; onOpened(capabilities: readonly string[] | undefined, contracts: readonly string[] | undefined): void; startAfter: PromiseLike<void> }): { stop(): void; openIncrement(id: string): void };
  openView(holder: HTMLElement, onSelect: (selection: ForestSelection) => void, options: { library: boolean; opening: string | undefined }): Promise<View>;
  sessions(view: View, host: HTMLElement): { stop(): void };
  ciTimes(host: HTMLElement): { stop(): void };
  take(changes: Changes, lines: News["lines"]): void;
  libraryCard(panel: HTMLElement, onClose: () => void): () => void;
  teaching(locate: (target: CardTarget) => Place | undefined, reading: (target: CardTarget) => Box[], islands: () => Box[]): { take(reading: { tree: AnnotatedTree; changes: Changes; lines: Held["lines"]; factory: boolean; library: boolean }): void; stop(): void };
  plugins(on: (surface: string) => boolean): Promise<{ stop(): void; failed: readonly { surface: string; why: string }[] }>;
  reading(options: Pick<ForestReadingOptions, "onTree" | "onError" | "onSettled" | "survey">): { stop(): void };
  renderPanel(drilled: StoryPanel, selected: string | undefined, options: { details: boolean; gate: readonly [string, string] | undefined; open: readonly string[] | undefined }): string;
  renderStore(store: SharedStore, tree: AnnotatedTree | undefined): string;
  foldPanel(panel: HTMLElement): void;
}

export interface PageParts<View extends ForestGlobe = ForestGlobe> {
  document: Document;
  content: HTMLElement;
  problem: string | null;
  waiting: string | null;
  menu: { update(selection: ProjectSelection): void };
  projectSelection(): Promise<ProjectSelection>;
  readSurfaces(): Promise<SurfacesResult>;
  startMark(name: string): Promise<unknown>;
  failed(what: string, error: unknown): void;
  answered(): void;
  project(name: string, timed: TimedRead): ProjectParts<View>;
  globe(): IslandsAndNotes | undefined;
  pluginViews: number;
}

export interface ProjectPage {
  libraryOn(): boolean;
  refresh(redraw?: boolean): Promise<void>;
  surfacesChanged(): Promise<void>;
  choiceFailed(error: unknown): void;
  stop(): void;
}

interface Showing {
  page?: PageReading;
  reading?: { stop(): void };
  view?: ForestGlobe;
  arcs?: { stop(): void; openIncrement(id: string): void };
  sessions?: { stop(): void };
  ciTimes?: { stop(): void };
  rail?: Rail;
  panel?: StoryPanelView;
  teaching?: { take: ReturnType<ProjectParts["teaching"]>["take"]; stop(): void };
  plugins?: { stop(): void };
}

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

export function openProjectPage<View extends ForestGlobe>(parts: PageParts<View>): ProjectPage {
  const { document, content } = parts;
  const body = document.body;
  const status = pageStatus(document, content);
  let showing: Showing | undefined;
  let current: string | undefined;
  let onFactory = false;
  let libraryOn = true;
  let following: ReturnType<typeof followProjects> | undefined;
  const marked = new Set<string>();

  const startMark = (name: string): void => {
    if (marked.has(name)) return;
    marked.add(name);
    void parts.startMark(name).catch((error: unknown) => parts.failed(`the start mark "${name}" could not be sent`, error));
  };
  const timed: TimedRead = (kept) => ({
    ...kept,
    read: async () => {
      startMark("kept reading read start");
      try { return await kept.read(); } finally { startMark("kept reading read end"); }
    },
  });

  const stopShowing = (): void => {
    showing?.plugins?.stop();
    showing?.teaching?.stop();
    showing?.panel?.stop();
    showing?.arcs?.stop();
    showing?.reading?.stop();
    showing?.sessions?.stop();
    showing?.ciTimes?.stop();
    showing?.page?.stop();
    showing?.rail?.stop();
    showing?.view?.dispose();
    showing = undefined;
    status.showFreshness(undefined);
    status.showReadError(undefined);
    delete body.dataset.surface;
    delete body.dataset.note;
  };
  const showMessage = (state: string, heading: string, text: string): void => {
    stopShowing();
    status.showMessage(state, heading, text);
  };

  const show = async ({ current: name, projects, factory }: ProjectSelection): Promise<void> => {
    parts.menu.update({ projects, current: name, ...(factory === undefined ? {} : { factory }) });
    onFactory = factory?.place === "factory";
    if (name === undefined) {
      current = undefined;
      stopShowing();
      status.showProgress(false);
      delete body.dataset.project;
      delete body.dataset.drew;
      delete body.dataset.selected;
      content.innerHTML = renderNoProjects();
      return status.setState("empty");
    }
    if (name === current && showing !== undefined) return;
    current = name;
    stopShowing();
    status.setState("loading");
    body.dataset.project = name;
    delete body.dataset.drew;
    delete body.dataset.selected;
    if (!projects.includes(name)) {
      return showMessage("missing", `There is no project called “${name}”`, "Pick a project from the project list in the top-left corner.");
    }
    document.title = `${name} · storytree 0.3`;
    await showForest(name);
  };

  const showForest = async (name: string): Promise<void> => {
    status.showProgress(true);
    const holder = document.createElement("div");
    holder.className = "forest";
    const panelHost = document.createElement("aside");
    panelHost.className = "story-panel";
    panelHost.hidden = true;
    content.replaceChildren(holder, panelHost);
    body.dataset.surface = "forest";
    const mine: Showing = {};
    showing = mine;
    const read = await parts.readSurfaces().catch((error: unknown) => ({ ok: false as const, error: messageOf(error) }));
    if (read?.ok === false) parts.failed("the surfaces could not be read, so every surface is on", read.error);
    if (showing !== mine) return;
    const surfaces = read?.ok === true ? read.value : [];
    libraryOn = surfaceOn(surfaces, "library");
    const withDetails = surfaceOn(surfaces, "capability-details");
    const globeOpening = surfaceSetting(surfaces, "globe", "opening-zoom");
    const project = parts.project(name, timed);
    const page = project.page;
    mine.page = page;
    const history = () => page.held().changes;
    const states = project.states;
    const toggleHost = content.ownerDocument.querySelector<HTMLElement>(".app-bar > .app-factory") ?? undefined;
    const rail = mountRail(content, { project: name, tabs: (["sessions", "arcs"] as const).filter((tab: RailTab) => surfaceOn(surfaces, tab)), ...(toggleHost ? { toggleHost } : {}) });
    if (rail) mine.rail = rail;
    const ciHost = content.ownerDocument.createElement("aside");
    ciHost.className = "ci-times";
    ciHost.hidden = true;
    content.append(ciHost);
    mine.ciTimes = project.ciTimes(ciHost);
    let started!: () => void;
    const startAfter = new Promise<void>((resolve) => { started = resolve; });
    let tree: AnnotatedTree | undefined;
    let surveyed: Survey = {};
    let opened: readonly string[] | undefined;

    const panel = storyPanel(panelHost, {
      body,
      drill: (story) => tree === undefined ? undefined : drillDown(tree, story, states, history(), surveyed),
      render: (drilled, selected, gate) => project.renderPanel(drilled, selected, { details: withDetails, gate, open: opened }),
      store: (address) => { const store = tree === undefined ? undefined : linkedStores(tree.stories).find((each) => each.address === address); return store === undefined ? undefined : project.renderStore(store, tree); },
      folds: (host) => project.foldPanel(host),
      libraryCard: (host, onClose) => project.libraryCard(host, onClose),
      deselect: () => mine.view?.select(undefined),
      openIncrement: (id) => { rail?.show("arcs"); mine.arcs?.openIncrement(id); },
    });
    mine.panel = panel;
    const view = await project.openView(holder, (selection) => {
      delete body.dataset.selected;
      delete body.dataset.note;
      delete body.dataset.store;
      if (selection?.kind === "story") body.dataset.selected = selection.id;
      if (selection?.kind === "store") body.dataset.store = selection.id;
      if (selection?.kind === "note") body.dataset.note = selection.id;
      panel.choose(selection?.kind === "story" ? selection.capability : undefined, selection?.kind === "story" ? selection.gate : undefined);
    }, { library: surfaceOn(surfaces, "library"), opening: globeOpening });
    if (showing !== mine) return view.dispose();
    mine.view = view;
    if (rail && surfaceOn(surfaces, "sessions")) mine.sessions = project.sessions(view, rail.panel("sessions"));
    mine.teaching = project.teaching((target) => locateTarget(target, { document, globe: parts.globe }), (target) => readingNear(target, document), () => drawnIslands(parts.globe()));
    if (parts.pluginViews > 0) {
      const plugins = await project.plugins((id) => surfaceOn(surfaces, id));
      if (showing !== mine) return plugins.stop();
      mine.plugins = plugins;
      for (const { surface, why } of plugins.failed) console.error(`The ${surface} surface could not be loaded from the factory: ${why}`);
    }

    const last = project.kept.read();
    const drawnWith = last === undefined ? undefined : project.drawing.read();
    if (last !== undefined) {
      const { created, states: was, survey } = drawnWith ?? { created: history(), states, survey: {} };
      view.show(forestScene(last, created, was, survey), new Map(storyNodes(last, created, survey).map((node) => [node.id, node.place])));
      status.showFreshness("Showing the forest as last read. Refreshing…");
    }
    const failed = (error: unknown): void => {
      if (showing !== mine) return;
      started();
      parts.failed(`the forest of ${name} could not be read`, error);
      if (status.state() === "ready") return;
      const heading = "The forest could not be read";
      if (body.dataset.fresh === "no") status.showFreshness(`${heading}: ${messageOf(error)}. Showing it as last read; retrying…`);
      else status.showReadError(heading, `${messageOf(error)}. Retrying…`);
    };
    const reading: Parameters<ProjectParts["reading"]>[0] = {
      onTree: (fresh, news, survey, pins) => {
        if (showing !== mine) return;
        parts.answered();
        tree = fresh;
        surveyed = survey;
        states.add(news.lines);
        const scene = forestScene(fresh, history(), states, survey, pins);
        view.show(scene, new Map(storyNodes(fresh, history(), survey).map((node) => [node.id, node.place])));
        project.take(history(), news.lines);
        status.sayWhatWasDrawn(forestDrawn(scene));
        mine.teaching?.take({ tree: fresh, changes: history(), lines: page.held().lines, factory: onFactory, library: libraryOn });
        if (!panelHost.hidden) panel.show();
        project.kept.write(fresh);
        project.drawing.write(drawingOf(fresh, history(), states, survey));
        status.showFreshness(undefined);
        status.showReadError(undefined);
        status.setState("ready");
        startMark("forest first fresh draw");
      },
      onError: failed,
      onSettled: () => {
        void (last === undefined ? Promise.resolve() : view.drawn()).then(() => { if (showing === mine) { status.showProgress(false); started(); } });
      },
    };
    mine.reading = project.reading(drawnWith === undefined ? reading : { ...reading, survey: drawnWith.survey });
    if (rail && surfaceOn(surfaces, "arcs")) {
      let stopWaiting: (() => void) | undefined;
      let mounted = false;
      const mountArcs = (): void => {
        if (mounted) return;
        mounted = true;
        stopWaiting?.();
        if (showing === mine) mine.arcs = project.arcs(rail.panel("arcs"), { onFreshDraw: () => startMark("arcs first fresh draw"), onWaiting: (count) => rail.badge(count), onOpened: (capabilities, contracts) => {
          mine.view?.circle(capabilities, contracts);
          opened = contracts;
          panel.show();
        }, startAfter });
      };
      stopWaiting = page.subscribe({ onNews: mountArcs, onError: mountArcs });
    }
  };

  const redraw = async (name: string): Promise<void> => {
    stopShowing();
    status.setState("loading");
    delete body.dataset.drew;
    delete body.dataset.selected;
    await showForest(name).catch((error: unknown) => {
      parts.failed(`the forest of ${name} could not be drawn again`, error);
      showMessage("error", "Something went wrong", messageOf(error));
    });
  };

  const open = async (): Promise<void> => {
    if (parts.problem !== null) return showMessage("error", "The library could not be opened", parts.problem);
    if (parts.waiting !== null) return showMessage("waiting", "Waiting for the library", parts.waiting);
    following = followProjects({
      read: () => parts.projectSelection().then((selection) => { parts.answered(); return selection; }),
      onChange: (selection) => show(selection),
      onError: (error) => {
        parts.failed("the projects could not be read", error);
        const state = status.state();
        if (state !== "ready" && state !== "empty") showMessage("error", "The projects could not be read", messageOf(error));
      },
    });
  };
  void open().catch((error: unknown) => {
    parts.failed("the page could not open", error);
    showMessage("error", "Something went wrong", messageOf(error));
  });

  return {
    libraryOn: () => libraryOn,
    refresh: (again) => following?.refresh(again) ?? Promise.resolve(),
    surfacesChanged: () => current !== undefined && showing !== undefined ? redraw(current) : Promise.resolve(),
    choiceFailed(error) {
      parts.failed("the project could not be selected", error);
      showMessage("error", "The project could not be selected", messageOf(error));
      void following?.refresh(true);
    },
    stop() {
      following?.stop();
      stopShowing();
    },
  };
}
