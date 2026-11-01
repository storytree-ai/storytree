/**
 * Capability 2 · Storytree projects: the desktop page's decisions, on stand-in surfaces. Each surface the renderer would mount is a
 * fake that records what the page asked of it, and the project's tree is the forest capture's seed, so the forest's own functions
 * draw it as they do in the app.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import type { AnnotatedTree } from "@storytree/library";
import { Window } from "happy-dom";

import { captureSeed } from "../../../../apps/desktop/src/capture/index.js";
import type { ProjectSelection } from "../projects/selection.js";
import type { SurfacesResult } from "../surfaces/bridge.js";
import { openProjectPage, type ForestGlobe, type ForestSelection, type PageParts, type ProjectParts } from "./page.js";

const { seed } = captureSeed("forest");
const tree = seed.tree as AnnotatedTree;
const story = tree.stories.find((each) => each.capabilities.length >= 2)!;
const settled = () => setImmediate();
/** The tests whose timers are already stood in for: a test may open two pages. */
const timed = new WeakSet<TestContext>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type Reading = Parameters<ProjectParts["reading"]>[0];

/** What the page did with one project's surfaces. */
interface Drawn {
  name: string;
  mounted: string[];
  stopped: string[];
  view: ForestGlobe & { scenes: number; disposed: boolean; onSelect: (selection: ForestSelection) => void };
  reading: Reading | undefined;
  teaching: { factory: boolean }[];
  locate: Parameters<ProjectParts["teaching"]>[0] | undefined;
  rendered: (string | undefined)[];
  spaces: { opened: number; placed: unknown[]; view: unknown }[];
  treeShown: number;
  treeOpen: boolean;
  kept: AnnotatedTree | undefined;
  timed: { read(): Promise<unknown> } | undefined;
}

/** The page on stand-in surfaces; `answers` overrides the bridge and how each project's surfaces answer. */
function page(t: TestContext, answers: Partial<Pick<PageParts, "problem" | "projectSelection" | "readSurfaces" | "globe">> & {
  openView?: (name: string) => Promise<void>;
  plugins?: (name: string) => Promise<{ stop(): void; failed: [] }> | undefined;
  kept?: AnnotatedTree;
} = {}) {
  if (!timed.has(t)) t.mock.timers.enable({ apis: ["setTimeout"] });
  timed.add(t);
  const window = new Window();
  const document = window.document as unknown as Document;
  const content = document.createElement("main");
  const bar = document.createElement("div");
  bar.id = "start-progress";
  document.body.append(bar, content);
  const failures: string[] = [];
  const marks: string[] = [];
  const menus: ProjectSelection[] = [];
  const drawn: Drawn[] = [];
  let selections = 0;
  let selection: ProjectSelection = { projects: ["site", "shop"], current: "site" };
  let surfaces: SurfacesResult = { ok: true, value: [] };
  const opened = openProjectPage({
    document,
    content,
    problem: null,
    menu: { update: (chosen) => { menus.push(chosen); } },
    projectSelection: async () => { selections++; return selection; },
    readSurfaces: async () => surfaces,
    startMark: async (name) => { marks.push(name); },
    failed: (what, error) => { failures.push(`${what}: ${error instanceof Error ? error.message : String(error)}`); },
    answered: () => {},
    globe: () => undefined,
    ...answers,
    project(name, timed) {
      const mine: Drawn = {
        name, mounted: [], stopped: [], reading: undefined, teaching: [], locate: undefined, rendered: [], spaces: [], treeShown: 0, treeOpen: false,
        kept: answers.kept, timed: undefined,
        view: {
          scenes: 0, disposed: false, onSelect: () => {},
          show() { mine.view.scenes++; }, select() {}, dispose() { mine.view.disposed = true; },
        },
      };
      drawn.push(mine);
      const surface = (id: string) => { mine.mounted.push(id); return { stop: () => { mine.stopped.push(id); } }; };
      mine.timed = timed({ read: async () => undefined });
      let kept: unknown;
      return {
        page: { held: () => ({ changes: [], lines: [] }), stop: () => { mine.stopped.push("page"); } } as unknown as ProjectParts["page"],
        states: { part: () => "planned", add() {} },
        kept: { read: () => mine.kept, write: (written) => { mine.kept = written; } },
        drawing: { read: () => kept as never, write: (written) => { kept = written; } },
        arcs: () => surface("arcs"),
        treeSpace: () => {
          mine.mounted.push("capability-tree");
          return {
            show() { mine.treeShown++; mine.treeOpen = true; },
            close() { mine.treeOpen = false; },
            get open() { return mine.treeOpen; },
            stop() { mine.stopped.push("capability-tree"); },
          };
        },
        openView: async (_holder, onSelect, options) => {
          mine.view.onSelect = onSelect;
          if (options.library) mine.mounted.push("library");
          await answers.openView?.(name);
          return mine.view;
        },
        sessions: () => surface("sessions"),
        take() {},
        libraryCard: () => () => {},
        teaching: (locate) => {
          mine.locate = locate;
          return { take: (reading) => { mine.teaching.push({ factory: reading.factory }); }, stop: () => { mine.stopped.push("teaching"); } };
        },
        plugins: () => answers.plugins?.(name),
        reading: (options) => { mine.reading = options; return { stop: () => { mine.stopped.push("reading"); } }; },
        space: () => {
          const space = { opened: 0, placed: [] as unknown[], view: { at: mine.spaces.length } };
          mine.spaces.push(space);
          return { get view() { return space.view; }, place: (view: unknown) => { space.placed.push(view); }, open: () => { space.opened++; }, stop() {} };
        },
        renderPanel: (drilledPanel, selected) => {
          mine.rendered.push(selected);
          return `<div class="panel-tree-frame"><div class="panel-tree-surface"></div></div><button data-open-tree></button>`
            + drilledPanel.capabilities.map(({ id }) => `<section class="panel-detail" data-capability-id="${id}"><details></details></section>`).join("");
        },
      };
    },
  });
  t.after(() => opened.stop());
  const body = document.body;
  return {
    page: opened, body, content, document, failures, marks, menus, drawn,
    get selections() { return selections; },
    choose(next: ProjectSelection) { selection = next; },
    surfaces(next: SurfacesResult) { surfaces = next; },
    /** The project last drawn, once its forest has opened. */
    last: () => drawn.at(-1)!,
    /** The fresh tree landing for the project last drawn. */
    land: (on = drawn.at(-1)!) => on.reading!.onTree(tree, { changes: [], lines: [] }, {}),
    heading: () => content.querySelector("h1")?.textContent,
    line: () => content.querySelector("p")?.textContent,
  };
}

test("2.22 · a page opened with a problem says the library could not be opened, and why, and reads no projects", async (t) => {
  const on = page(t, { problem: "the database refused the password" });
  await settled();
  assert.equal(on.body.dataset.state, "error");
  assert.equal(on.heading(), "The library could not be opened");
  assert.equal(on.line(), "the database refused the password");
  assert.equal(on.selections, 0);
});

test("2.23 · a failed projects read is said only while nothing is on show; a drawn forest or the empty page stays", async (t) => {
  let fail = true;
  let selection: ProjectSelection = { projects: ["site"], current: "site" };
  const on = page(t, { projectSelection: async () => { if (fail) throw new Error("the library stopped answering"); return selection; } });
  await settled();
  assert.equal(on.body.dataset.state, "error");
  assert.equal(on.heading(), "The projects could not be read");
  assert.equal(on.line(), "the library stopped answering");

  fail = false;
  await on.page.refresh();
  await settled();
  on.land();
  assert.equal(on.body.dataset.state, "ready");
  fail = true;
  await on.page.refresh();
  assert.equal(on.body.dataset.state, "ready", "a drawn forest stays on show");
  assert.equal(on.last().stopped.length, 0);

  fail = false;
  selection = { projects: [], current: undefined };
  await on.page.refresh();
  assert.equal(on.body.dataset.state, "empty");
  fail = true;
  await on.page.refresh();
  assert.equal(on.body.dataset.state, "empty", "the empty page stays");
  assert.equal(on.failures.filter((line) => line.startsWith("the projects could not be read")).length, 3);
});

test("2.24 · a failed choice is said in place of the project and the projects are read again; a failed surfaces read mounts every surface", async (t) => {
  const on = page(t, { readSurfaces: async () => { throw new Error("the main process did not answer"); } });
  await settled();
  assert.deepEqual(on.last().mounted.sort(), ["arcs", "capability-tree", "library", "sessions"]);
  assert.ok(on.failures.some((line) => line === "the surfaces could not be read, so every surface is on: the main process did not answer"));

  const before = on.selections;
  on.page.choiceFailed(new Error("that project's library is not reachable"));
  assert.equal(on.body.dataset.state, "error");
  assert.equal(on.heading(), "The project could not be selected");
  assert.equal(on.line(), "that project's library is not reachable");
  await settled();
  assert.equal(on.selections, before + 1, "the projects are read again");
  assert.equal(on.drawn.length, 2, "the unchanged project is drawn again over the message");
  assert.equal(on.body.dataset.state, "loading");
});

test("2.25 · a surface switched in the Surfaces menu draws the project on show again, as the settings now say", async (t) => {
  const on = page(t);
  await settled();
  const first = on.last();
  assert.ok(first.mounted.includes("arcs"));
  on.surfaces({ ok: true, value: [{ id: "arcs", on: false, settings: [] }] as never });
  await on.page.surfacesChanged();
  assert.equal(on.drawn.length, 2);
  assert.ok(first.stopped.includes("arcs") && first.view.disposed, "the old drawing is let go");
  assert.ok(!on.last().mounted.includes("arcs"), "the switched-off surface is not mounted again");
  assert.ok(on.last().mounted.includes("sessions"));
});

test("2.26 · what lands after the page left the project's drawing changes nothing on show, and what it mounted is let go", async (t) => {
  const views: ReturnType<typeof deferred<void>>[] = [];
  const plugins = deferred<{ stop(): void; failed: [] }>();
  let pluginStops = 0;
  let pluginsAsked = 0;
  const on = page(t, {
    openView: () => { const wait = deferred<void>(); views.push(wait); return wait.promise; },
    plugins: () => ++pluginsAsked === 1 ? plugins.promise : undefined,
  });
  await settled();
  const opening = on.last();
  // A surface is switched while the globe is still opening: the project is drawn again, and the first globe lands too late.
  const again = on.page.surfacesChanged();
  await settled();
  views[0]!.resolve();
  await settled();
  assert.equal(opening.view.disposed, true, "a globe opened too late is disposed");
  assert.equal(opening.reading, undefined, "and never reads");
  assert.equal(on.drawn.length, 2);

  // The second drawing's factory views are on their way when a failed choice takes the project off show.
  views[1]!.resolve();
  await settled();
  on.page.choiceFailed(new Error("that project's library is not reachable"));
  plugins.resolve({ stop: () => { pluginStops++; }, failed: [] });
  await again;
  assert.equal(pluginStops, 1, "plugin views mounted too late are stopped");
  assert.equal(on.drawn[1]!.reading, undefined);

  // A tree or a failure the left drawing's reading had in flight draws nothing and says nothing.
  await settled();
  views.at(-1)!.resolve();
  await settled();
  const shown = on.last();
  on.land(shown);
  assert.equal(on.body.dataset.state, "ready");
  void on.page.surfacesChanged();
  await settled();
  const scenes = shown.view.scenes;
  const failures = on.failures.length;
  on.land(shown);
  shown.reading!.onError(new Error("too late"));
  assert.equal(shown.view.scenes, scenes);
  assert.equal(on.body.dataset.state, "loading", "the new drawing is still loading, whatever the old reading says");
  assert.equal(on.failures.length, failures);
});

test("2.27 · the kept forest is drawn at once, marked not fresh; a first read that fails says so over it or over the page, and once drawn a failure changes nothing", async (t) => {
  const kept = page(t, { kept: tree });
  await settled();
  const project = kept.last();
  assert.equal(project.view.scenes, 1, "the kept forest is drawn before any read");
  assert.equal(kept.body.dataset.fresh, "no");
  assert.equal(kept.body.dataset.state, "loading");
  project.reading!.onError(new Error("the tree could not be read"));
  assert.equal(kept.document.getElementById("freshness")?.textContent, "The forest could not be read: the tree could not be read. Showing it as last read; retrying…");
  assert.equal(kept.body.dataset.state, "loading", "the kept forest stays on show");

  const none = page(t);
  await settled();
  none.last().reading!.onError(new Error("the tree could not be read"));
  assert.equal(none.body.dataset.state, "error");
  assert.equal(none.document.getElementById("read-error")?.textContent, "The forest could not be readthe tree could not be read. Retrying…");
  none.land();
  assert.equal(none.body.dataset.state, "ready");
  assert.equal(none.document.getElementById("read-error"), null);
  assert.equal(none.body.dataset.fresh, undefined);
  assert.equal(none.last().kept, tree, "the fresh tree is kept for the next start");
  none.last().reading!.onError(new Error("the library stopped answering"));
  assert.equal(none.body.dataset.state, "ready");
  assert.equal(none.document.getElementById("read-error"), null);
  assert.equal(none.failures.filter((line) => line.startsWith("the forest of site could not be read")).length, 2);
});

test("2.28 · a territory click opens its story on that capability, and a redraw keeps its open details, the panel tree's place and the popped-out tree", async (t) => {
  const on = page(t);
  await settled();
  on.land();
  const project = on.last();
  const [, second] = story.capabilities;
  project.view.onSelect({ kind: "story", id: story.id, capability: second!.id });
  assert.equal(on.body.dataset.selected, story.id);
  assert.equal(project.rendered.at(-1), second!.id, "the panel opens on the capability clicked");
  assert.equal(project.spaces[0]!.opened, 1, "the panel's tree opens as its zoom says");

  const panel = on.content.querySelector<HTMLElement>(".story-panel")!;
  panel.querySelector(`[data-capability-id="${second!.id}"] details`)!.setAttribute("open", "");
  panel.querySelector<HTMLElement>("[data-open-tree]")!.click();
  assert.equal(project.treeShown, 1);
  on.land();
  assert.equal(project.rendered.at(-1), second!.id, "the redraw keeps the capability chosen");
  assert.ok(panel.querySelector(`[data-capability-id="${second!.id}"] details`)!.hasAttribute("open"), "and its open details");
  assert.deepEqual(project.spaces[1]!.placed, [project.spaces[0]!.view], "and the tree's place");
  assert.equal(project.spaces[1]!.opened, 0);
  assert.equal(project.treeShown, 2, "and redraws the popped-out tree");
});

test("2.29 · teaching cards hear whether the project on show is the factory, and each card is placed beside its target", async (t) => {
  const islands = [{ story: story.id, x: 10, y: 20, visible: true }];
  const on = page(t, {
    projectSelection: async () => ({ projects: ["site"], current: "site", factory: { place: "factory", product: undefined } }),
    globe: () => ({ islands: () => islands, notes: () => [{ note: "note_1", x: 5, y: 6, visible: false }] }),
  });
  await settled();
  on.land();
  assert.deepEqual(on.last().teaching, [{ factory: true }]);

  const locate = on.last().locate!;
  assert.deepEqual(locate({ kind: "capability", story: story.id }), { x: 10, y: 20, visible: true });
  assert.deepEqual(locate({ kind: "note", note: "note_1" }), { x: 5, y: 6, visible: false });
  assert.equal(locate({ kind: "switch" }), undefined, "no factory tab on show");
  const tab = on.document.createElement("button");
  tab.className = "app-factory";
  tab.getBoundingClientRect = () => ({ left: 100, right: 140, top: 4, width: 40, height: 40 }) as DOMRect;
  const arcs = on.document.createElement("div");
  arcs.className = "arc-surface-mount";
  arcs.innerHTML = "<button data-open-arcs></button>";
  arcs.querySelector<HTMLElement>("[data-open-arcs]")!.getBoundingClientRect = () => ({ left: 8, right: 300, top: 48, width: 292, height: 48 }) as DOMRect;
  on.document.body.append(tab, arcs);
  assert.deepEqual(locate({ kind: "switch" }), { x: 140, y: 24, visible: true });
  assert.deepEqual(locate({ kind: "question" }), { x: 68, y: 72, visible: true });
  assert.equal(locate({ kind: "map" }), undefined);
});

test("2.30 · each start mark is sent once, and what the forest drew joins the page's census", async (t) => {
  const on = page(t);
  await settled();
  // The arc surface has said what it drew once the project is on show.
  on.body.dataset.drew = JSON.stringify({ arcs: ["arc_1"] });
  const project = on.last();
  await project.timed!.read();
  await project.timed!.read();
  on.land();
  on.land();
  await settled();
  assert.deepEqual(on.marks.sort(), ["forest first fresh draw", "kept reading read end", "kept reading read start"]);
  const drew = JSON.parse(on.body.dataset.drew!) as Record<string, unknown>;
  assert.deepEqual(drew.arcs, ["arc_1"], "another surface's reading stays");
  assert.equal(drew.surface, "forest");
  assert.ok(Array.isArray(drew.stories) && drew.stories.includes(story.id));
});
