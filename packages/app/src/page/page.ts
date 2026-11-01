/**
 * Capability 2 · Storytree projects. The desktop page's decisions, apart from Electron and from the surfaces it mounts, which the
 * renderer hands it as parts: which project is on show and when it is drawn again; what the page says while it loads, has nothing
 * to show or fails (`data-state`: loading, ready, empty, missing, error); the forest drawn at once from the tree kept at the last
 * start (`data-fresh="no"`) and the notice over it while the first read fails; which surfaces are mounted as the settings say
 * (every one when they cannot be read); the start-timing marks, each sent once (lifecycle 1.33); and that a read landing after
 * the user switched project changes nothing on show.
 */
import { drawingOf, drillDown, forestDrawn, forestScene, storyNodes, type ForestReadingOptions, type ForestScene, type KeptDrawing, type StoryPanel } from "@storytree/forest";
import type { AnnotatedTree } from "@storytree/library";

import { followProjects, type ProjectSelection } from "../projects/follow.js";
import { surfaceOn, surfaceSetting, type SurfacesResult } from "../surfaces/bridge.js";
import { renderNoProjects } from "../view/render.js";
import { locateTarget, type CardTarget, type IslandsAndNotes, type Place } from "./locate.js";
import { pageStatus } from "./status.js";
import { storyPanel, type PanelSpace, type StoryPanelView, type TreeWindow } from "./story-panel.js";

type PageReading = NonNullable<ForestReadingOptions["reading"]>;
type News = Parameters<ForestReadingOptions["onTree"]>[1];
type Survey = NonNullable<Parameters<typeof forestScene>[3]>;
type PartStates = Parameters<typeof forestScene>[2];
type Held = ReturnType<PageReading["held"]>;
type Changes = Held["changes"];

/** What a click on the forest picked: a story (on one of its territories' capabilities), a note, or empty space. */
export type ForestSelection = { kind: "story"; id: string; capability?: string } | { kind: "note"; id: string } | undefined;

/** The forest's globe (the forest's openForestView), the little of it the page drives. */
export interface ForestGlobe {
  show(scene: ForestScene, places: ReadonlyMap<string, number>): void;
  select(story: string | undefined): void;
  dispose(): void;
}

/** A start-timing mark's sender, wrapped round the kept reading's read-back. */
export type TimedRead = <K extends { read(): Promise<unknown> }>(kept: K) => K;

/** The surfaces that draw one project, each mounted only when the page asks, already joined to the project's reads. */
export interface ProjectParts<View extends ForestGlobe = ForestGlobe> {
  /** The page's one live reading of the project (ADR-0836 D3), its kept reading's read-back timed by the page. */
  page: PageReading;
  states: PartStates & { add(lines: News["lines"]): void };
  /** The tree the forest last drew, and what it drew it with (forest keptTree and keptDrawing). */
  kept: { read(): AnnotatedTree | undefined; write(tree: AnnotatedTree): void };
  drawing: { read(): KeptDrawing | undefined; write(drawing: ReturnType<typeof drawingOf>): void };
  arcs(onFreshDraw: () => void): { stop(): void };
  treeSpace(on: { choose(id: string): void; closed(): void }, opening: string | undefined): TreeWindow;
  openView(holder: HTMLElement, onSelect: (selection: ForestSelection) => void, options: { library: boolean; opening: string | undefined }): Promise<View>;
  /** The sessions list, joined to `view` and the knowledge core both ways. */
  sessions(view: View): { stop(): void };
  /** Hand the knowledge core the library's changes and the log's lines. */
  take(changes: Changes, lines: News["lines"]): void;
  libraryCard(panel: HTMLElement, onClose: () => void): () => void;
  teaching(locate: (target: CardTarget) => Place | undefined): { take(reading: { tree: AnnotatedTree; changes: Changes; lines: Held["lines"]; factory: boolean }): void; stop(): void };
  /** Mount the factory's stand-in surfaces (ADR-1174) that `on` says are on. */
  plugins(on: (surface: string) => boolean): Promise<{ stop(): void; failed: readonly { surface: string; why: string }[] }>;
  reading(options: Pick<ForestReadingOptions, "onTree" | "onError" | "onSettled" | "survey">): { stop(): void };
  space(frame: HTMLElement, surface: HTMLElement, choose: (id: string) => void, opening: string | undefined): PanelSpace;
  renderPanel(drilled: StoryPanel, selected: string | undefined, options: { tree: boolean }): string;
}

export interface PageParts<View extends ForestGlobe = ForestGlobe> {
  document: Document;
  content: HTMLElement;
  /** The page's `?problem=`: the library could not be opened, and why. */
  problem: string | null;
  menu: { update(selection: ProjectSelection): void };
  projectSelection(): Promise<ProjectSelection>;
  readSurfaces(): Promise<SurfacesResult>;
  startMark(name: string): Promise<unknown>;
  /** A failure the page caught, for the console (lifecycle 1.19 carries it to app.log), said once per outage (8.11). */
  failed(what: string, error: unknown): void;
  /** The library answered again. */
  answered(): void;
  project(name: string, timed: TimedRead): ProjectParts<View>;
  globe(): IslandsAndNotes | undefined;
  /** How many stand-in surface views the user's factory offers. */
  pluginViews: number;
}

export interface ProjectPage {
  /** Read the projects again now; `redraw` draws the project on show again even when nothing changed. */
  refresh(redraw?: boolean): Promise<void>;
  /** A surface was switched or set in the Surfaces menu: draw the project on show again, as the settings now say. */
  surfacesChanged(): Promise<void>;
  /** Choosing a project failed: say why in place of the project, and read the projects again. */
  choiceFailed(error: unknown): void;
  stop(): void;
}

interface Showing {
  page?: PageReading;
  reading?: { stop(): void };
  view?: ForestGlobe;
  arcs?: { stop(): void };
  sessions?: { stop(): void };
  panel?: StoryPanelView;
  tree?: TreeWindow;
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
  /** Whether the project on show is the user's factory, which its teaching cards read (ADR-1048 D3). */
  let onFactory = false;
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
    showing?.tree?.stop();
    showing?.arcs?.stop();
    showing?.reading?.stop();
    showing?.sessions?.stop();
    showing?.page?.stop();
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

  /** Redraw the picker when the list changes; only replace the surface when its project changes. */
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

  /**
   * Draw project `name` as its forest and keep it current: the live reading hands on the library's changes and the agent log's
   * lines as they come, the tree is read again when the library changed, and only the story nodes that changed are redrawn.
   */
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
    // The surfaces switched on in the settings file (ADR-0750); if they cannot be read, all are on.
    const read = await parts.readSurfaces().catch((error: unknown) => ({ ok: false as const, error: messageOf(error) }));
    if (read?.ok === false) parts.failed("the surfaces could not be read, so every surface is on", read.error);
    if (showing !== mine) return;
    const surfaces = read?.ok === true ? read.value : [];
    const withTree = surfaceOn(surfaces, "capability-tree");
    const treeOpening = surfaceSetting(surfaces, "capability-tree", "opening-zoom");
    const globeOpening = surfaceSetting(surfaces, "globe", "opening-zoom");
    const project = parts.project(name, timed);
    const page = project.page;
    mine.page = page;
    const history = () => page.held().changes;
    const states = project.states;
    if (surfaceOn(surfaces, "arcs")) mine.arcs = project.arcs(() => startMark("arcs first fresh draw"));
    let tree: AnnotatedTree | undefined;
    /** The code survey last read, which counts a mapped story's files and lines for its panel. */
    let surveyed: Survey = {};

    const panel = storyPanel(panelHost, {
      body,
      drill: (story) => tree === undefined ? undefined : drillDown(tree, story, states, history(), surveyed),
      render: (drilled, selected) => project.renderPanel(drilled, selected, { tree: withTree }),
      space: (frame, surface, choose) => project.space(frame, surface, choose, treeOpening),
      tree: () => mine.tree,
      libraryCard: (host, onClose) => project.libraryCard(host, onClose),
      deselect: () => mine.view?.select(undefined),
    });
    mine.panel = panel;
    if (withTree) mine.tree = project.treeSpace({
      choose: (id) => panel.choose(id),
      closed: () => panelHost.querySelector<HTMLButtonElement>("[data-open-tree]")?.focus(),
    }, treeOpening);
    const view = await project.openView(holder, (selection) => {
      delete body.dataset.selected;
      delete body.dataset.note;
      if (selection?.kind === "story") body.dataset.selected = selection.id;
      if (selection?.kind === "note") body.dataset.note = selection.id;
      // A click on a territory opens its story on that capability (forest 3.15).
      panel.choose(selection?.kind === "story" ? selection.capability : undefined);
    }, { library: surfaceOn(surfaces, "library"), opening: globeOpening });
    if (showing !== mine) return view.dispose();
    mine.view = view;
    // Sessions off is a quiet globe: no list, no session tints and no islands lit on hover.
    if (surfaceOn(surfaces, "sessions")) mine.sessions = project.sessions(view);
    // The first time each kind appears on this map, its card shows beside it (ADR-1048 D1).
    mine.teaching = project.teaching((target) => locateTarget(target, { document, globe: parts.globe }));
    // A factory plugin standing in for a switched-off part draws its surfaces from the factory, while each is on.
    if (parts.pluginViews > 0) {
      const plugins = await project.plugins((id) => surfaceOn(surfaces, id));
      if (showing !== mine) return plugins.stop();
      mine.plugins = plugins;
      for (const { surface, why } of plugins.failed) console.error(`The ${surface} surface could not be loaded from the factory: ${why}`);
    }

    // The tree this project last drew, at once and marked as not yet fresh, while the first read runs, drawn with the survey,
    // story order and work states it was drawn with, so the fresh drawing of an unchanged project lays out nothing again. The
    // page stays "loading" until that read lands; a failure meanwhile keeps the kept forest on show.
    const last = project.kept.read();
    const drawnWith = last === undefined ? undefined : project.drawing.read();
    if (last !== undefined) {
      const { created, states: was, survey } = drawnWith ?? { created: history(), states, survey: {} };
      view.show(forestScene(last, created, was, survey), new Map(storyNodes(last, created, survey).map((node) => [node.id, node.place])));
      status.showFreshness("Showing the forest as last read. Refreshing…");
    }
    // A read that fails before the first one lands keeps the reading going: the next ask tries again, and the forest is drawn
    // once the library answers. Once drawn, a failed read changes nothing on show.
    const failed = (error: unknown): void => {
      if (showing !== mine) return;
      parts.failed(`the forest of ${name} could not be read`, error);
      if (status.state() === "ready") return;
      const heading = "The forest could not be read";
      if (body.dataset.fresh === "no") status.showFreshness(`${heading}: ${messageOf(error)}. Showing it as last read; retrying…`);
      else status.showReadError(heading, `${messageOf(error)}. Retrying…`);
    };
    const reading: Parameters<ProjectParts["reading"]>[0] = {
      onTree: (fresh, news, survey) => {
        if (showing !== mine) return;
        parts.answered();
        tree = fresh;
        surveyed = survey;
        states.add(news.lines);
        const scene = forestScene(fresh, history(), states, survey);
        view.show(scene, new Map(storyNodes(fresh, history(), survey).map((node) => [node.id, node.place])));
        project.take(history(), news.lines);
        status.sayWhatWasDrawn(forestDrawn(scene));
        mine.teaching?.take({ tree: fresh, changes: history(), lines: page.held().lines, factory: onFactory });
        if (!panelHost.hidden) panel.show();
        project.kept.write(fresh);
        project.drawing.write(drawingOf(fresh, history(), states, survey));
        status.showFreshness(undefined);
        status.showReadError(undefined);
        status.setState("ready");
        startMark("forest first fresh draw");
      },
      onError: failed,
      onSettled: () => { if (showing === mine) status.showProgress(false); },
    };
    mine.reading = project.reading(drawnWith === undefined ? reading : { ...reading, survey: drawnWith.survey });
  };

  /** Draw project `name` again from the start, as the surfaces now say. */
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
    following = followProjects({
      // The projects poll every few seconds, so their answer is the page's word that the library answers again.
      read: () => parts.projectSelection().then((selection) => { parts.answered(); return selection; }),
      onChange: (selection) => show(selection),
      onError: (error) => {
        parts.failed("the projects could not be read", error);
        // An intermittent read must not tear down a working forest; the next poll retries.
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
