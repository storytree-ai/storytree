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

/** Who hears the page's one reading, as the page reading takes them. */
type NewsListener = Parameters<ProjectParts["page"]["subscribe"]>[0];

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
  view: ForestGlobe & { scenes: number; disposed: boolean; circled: (readonly string[] | undefined)[]; circledContracts: (readonly string[] | undefined)[]; chosen: string[]; onSelect: (selection: ForestSelection) => void; painted: ReturnType<typeof deferred<void>> };
  reading: Reading | undefined;
  teaching: { factory: boolean }[];
  locate: Parameters<ProjectParts["teaching"]>[0] | undefined;
  readingNear: Parameters<ProjectParts["teaching"]>[1] | undefined;
  islands: Parameters<ProjectParts["teaching"]>[2] | undefined;
  rendered: (string | undefined)[];
  gates: (readonly [string, string] | undefined)[];
  spaces: { opened: number; placed: unknown[]; view: unknown; choose: (id: string) => void }[];
  /** How the popped-out tree tells the page a capability was picked in it. */
  treeChoose: ((id: string) => void) | undefined;
  treeShown: number;
  treeOpen: boolean;
  kept: AnnotatedTree | undefined;
  timed: { read(): Promise<unknown> } | undefined;
  /** Where the arcs and the sessions list were mounted, and how the arcs speak to their tab's badge. */
  hosts: { arcs?: HTMLElement; sessions?: HTMLElement };
  waiting: ((count: number) => void) | undefined;
  /** How the arcs tell the page the open arc's capabilities. */
  opened: ((capabilities: readonly string[] | undefined, contracts: readonly string[] | undefined) => void) | undefined;
  /** What the arcs were told to start reading after. */
  arcsStart: PromiseLike<unknown> | undefined;
  /** Who hears the page's one reading, in the order they subscribed: the forest's reading among them, as in the app. */
  listeners: NewsListener[];
  /** What the forest and the arcs did, in order: the forest asking its tree on its first news, the arcs mounting. */
  events: string[];
}

/** The page on stand-in surfaces; `answers` overrides the bridge and how each project's surfaces answer. */
function page(t: TestContext, answers: Partial<Pick<PageParts, "problem" | "projectSelection" | "readSurfaces" | "globe" | "pluginViews">> & {
  openView?: (name: string) => Promise<void>;
  plugins?: (on: (surface: string) => boolean) => Promise<{ stop(): void; failed: [] }>;
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
    pluginViews: 0,
    ...answers,
    project(name, timed) {
      const mine: Drawn = {
        name, mounted: [], stopped: [], reading: undefined, teaching: [], locate: undefined, readingNear: undefined, islands: undefined, rendered: [], gates: [], spaces: [], treeChoose: undefined, treeShown: 0, treeOpen: false,
        kept: answers.kept, timed: undefined, hosts: {}, waiting: undefined, opened: undefined, arcsStart: undefined, listeners: [], events: [],
        view: {
          scenes: 0, disposed: false, circled: [], circledContracts: [], chosen: [], onSelect: () => {}, painted: deferred<void>(),
          show() { mine.view.scenes++; }, drawn: () => mine.view.painted.promise, select() {}, chose(capability) { mine.view.chosen.push(capability); }, circle(capabilities, contracts) { mine.view.circled.push(capabilities); mine.view.circledContracts.push(contracts); }, dispose() { mine.view.disposed = true; },
        },
      };
      drawn.push(mine);
      const surface = (id: string) => { mine.mounted.push(id); return { stop: () => { mine.stopped.push(id); } }; };
      mine.timed = timed({ read: async () => undefined });
      let kept: unknown;
      return {
        page: {
          held: () => ({ changes: [], lines: [] }),
          subscribe: (listener: NewsListener) => { mine.listeners.push(listener); return () => { mine.listeners.splice(mine.listeners.indexOf(listener), 1); }; },
          stop: () => { mine.stopped.push("page"); },
        } as unknown as ProjectParts["page"],
        states: { part: () => "planned", add() {} },
        kept: { read: () => mine.kept, write: (written) => { mine.kept = written; } },
        drawing: { read: () => kept as never, write: (written) => { kept = written; } },
        arcs: (host, on) => { mine.events.push("arcs mounted"); mine.hosts.arcs = host; mine.waiting = on.onWaiting; mine.opened = on.onOpened; mine.arcsStart = on.startAfter; return surface("arcs"); },
        treeSpace: (on) => {
          mine.mounted.push("capability-tree");
          mine.treeChoose = on.choose;
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
        sessions: (_view, host) => { mine.hosts.sessions = host; return surface("sessions"); },
        take() {},
        libraryCard: () => () => {},
        teaching: (locate, readingNear, islands) => {
          mine.locate = locate;
          mine.readingNear = readingNear;
          mine.islands = islands;
          return { take: (reading) => { mine.teaching.push({ factory: reading.factory }); }, stop: () => { mine.stopped.push("teaching"); } };
        },
        plugins: (on) => answers.plugins!(on),
        // The forest's reading hears the page's reading and asks its tree on its first news, as forestReading does.
        reading: (options) => {
          mine.reading = options;
          let asked = false;
          mine.listeners.push({ onNews: () => { if (!asked) mine.events.push("tree asked"); asked = true; }, onError: () => {} });
          return { stop: () => { mine.stopped.push("reading"); } };
        },
        space: (_frame, _surface, choose) => {
          const space = { opened: 0, placed: [] as unknown[], view: { at: mine.spaces.length }, choose };
          mine.spaces.push(space);
          return { get view() { return space.view; }, place: (view: unknown) => { space.placed.push(view); }, open: () => { space.opened++; }, stop() {} };
        },
        renderPanel: (drilledPanel, selected, options) => {
          mine.rendered.push(selected);
          mine.gates.push(options.gate);
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
    /** The page's reading handing news, or failing, to everyone who hears it, in the order they subscribed. */
    heard: (on = drawn.at(-1)!) => { for (const listener of [...on.listeners]) void listener.onNews({ changes: [], lines: [] }); },
    readFailed: (error: Error, on = drawn.at(-1)!) => { for (const listener of [...on.listeners]) listener.onError?.(error); },
    /** The fresh tree landing for the project last drawn. */
    land: (on = drawn.at(-1)!) => on.reading!.onTree(tree, { changes: [], lines: [] }, {}),
    heading: () => content.querySelector("h1")?.textContent,
    line: () => content.querySelector("p")?.textContent,
  };
}

test("2.17 · the factory's stand-in views are mounted, each while its surface is on, and none is asked for when the factory offers none", async (t) => {
  const asked: string[][] = [];
  const views = (on: (surface: string) => boolean) => {
    asked.push(["arcs", "standin"].filter(on));
    return Promise.resolve({ stop() {}, failed: [] as [] });
  };
  page(t, { plugins: views });
  await settled();
  assert.deepEqual(asked, [], "a factory with no views is not asked");
  page(t, { pluginViews: 2, plugins: views, readSurfaces: async () => ({ ok: true, value: [{ id: "standin", on: false, settings: [] }] as never }) });
  await settled();
  assert.deepEqual(asked, [["arcs"]], "each view mounts while its surface is on");
});

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
  on.heard();
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
  on.heard();
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
    pluginViews: 1,
    plugins: () => ++pluginsAsked === 1 ? plugins.promise : Promise.resolve({ stop() {}, failed: [] }),
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

test("2.37 · a start with a kept forest is marked settled only once the globe has drawn a frame of what is on show after the fresh tree", async (t) => {
  const kept = page(t, { kept: tree });
  await settled();
  const project = kept.last();
  await kept.land();
  project.reading!.onSettled!();
  await settled();
  assert.notEqual(kept.body.dataset.start, "settled", "the forest reading settled, but the globe has drawn no frame of it yet");
  project.view.painted.resolve();
  await settled();
  assert.equal(kept.body.dataset.start, "settled");

  const fresh = page(t);
  await settled();
  await fresh.land();
  fresh.last().reading!.onSettled!();
  await settled();
  assert.equal(fresh.body.dataset.start, "settled", "a start with nothing kept settles with its reading, as before");
});

test("2.40 · the arcs read nothing until the page's start is settled, or until the forest's first read fails", async (t) => {
  const told = (start: PromiseLike<unknown> | undefined) => {
    let heard = false;
    void start?.then(() => { heard = true; });
    return () => heard;
  };
  const kept = page(t, { kept: tree });
  await settled();
  const project = kept.last();
  kept.heard();
  const started = told(project.arcsStart);
  await kept.land();
  project.reading!.onSettled!();
  await settled();
  assert.equal(started(), false, "the forest reading settled, but the globe has drawn no frame of it yet");
  project.view.painted.resolve();
  await settled();
  assert.equal(kept.body.dataset.start, "settled");
  assert.equal(started(), true, "told once the start is settled");

  const failing = page(t);
  await settled();
  failing.heard();
  const fails = told(failing.last().arcsStart);
  await settled();
  assert.equal(fails(), false);
  failing.last().reading!.onError(new Error("the library is away"));
  await settled();
  assert.equal(fails(), true, "a first read that fails lets the arcs read for themselves");
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
  assert.ok(none.document.getElementById("read-error") === null, "no read error is said");
  assert.equal(none.body.dataset.fresh, undefined);
  assert.equal(none.last().kept, tree, "the fresh tree is kept for the next start");
  none.last().reading!.onError(new Error("the library stopped answering"));
  assert.equal(none.body.dataset.state, "ready");
  assert.ok(none.document.getElementById("read-error") === null, "no read error is said");
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

test("2.28 · a capability picked in the panel's tree, or in the popped-out tree, opens on it and is handed to the map to ring (forest 3.91)", async (t) => {
  const on = page(t);
  await settled();
  on.land();
  const project = on.last();
  const [first, second] = story.capabilities;
  project.view.onSelect({ kind: "story", id: story.id, capability: first!.id });
  assert.deepEqual(project.view.chosen, [], "a map pick needs no telling back");
  project.spaces.at(-1)!.choose(second!.id);
  assert.equal(project.rendered.at(-1), second!.id, "the panel opens on the capability picked in its tree");
  assert.deepEqual(project.view.chosen, [second!.id], "and the map is told, so it rings it");
  project.treeChoose!(first!.id);
  assert.equal(project.rendered.at(-1), first!.id, "the popped-out tree's pick opens the panel on it too");
  assert.deepEqual(project.view.chosen, [second!.id, first!.id], "and the map is told");
});

test("2.50 · a gate picked on the map opens its story's panel on the pair it joins, kept on a redraw; a territory or tree pick after it opens on that capability", async (t) => {
  const on = page(t);
  await settled();
  on.land();
  const project = on.last();
  const [first, second] = story.capabilities;
  project.view.onSelect({ kind: "story", id: story.id, gate: [first!.id, second!.id] });
  assert.equal(on.body.dataset.selected, story.id);
  assert.deepEqual(project.gates.at(-1), [first!.id, second!.id], "the panel is handed the pair the gate joins");
  on.land();
  assert.deepEqual(project.gates.at(-1), [first!.id, second!.id], "a redraw keeps the gate");
  project.view.onSelect({ kind: "story", id: story.id, capability: second!.id });
  assert.equal(project.gates.at(-1), undefined, "a territory click puts the gate down");
  assert.equal(project.rendered.at(-1), second!.id);
  project.view.onSelect({ kind: "story", id: story.id, gate: [first!.id, second!.id] });
  project.spaces.at(-1)!.choose(first!.id);
  assert.equal(project.gates.at(-1), undefined, "so does a pick in the panel's tree");
  assert.equal(project.rendered.at(-1), first!.id);
});

test("2.29 · teaching cards hear whether the project on show is the factory, and each card is placed beside its target", async (t) => {
  const islands = [{ story: story.id, x: 10, y: 20, visible: true, box: { left: 0, top: 10, right: 20, bottom: 30 } }, { story: "story_unboxed", x: 1, y: 2, visible: true },
    { story: "story_behind", x: 40, y: 50, visible: false, box: { left: 30, top: 40, right: 50, bottom: 60 } }, { story: "story_near", x: 70, y: 80, visible: true, box: { left: 60, top: 70, right: 80, bottom: 90 } }];
  const on = page(t, {
    projectSelection: async () => ({ projects: ["site"], current: "site", factory: { place: "factory", product: undefined } }),
    globe: () => ({ islands: () => islands, notes: () => [{ note: "note_1", x: 5, y: 6, visible: false }] }),
  });
  await settled();
  on.land();
  assert.deepEqual(on.last().teaching, [{ factory: true }]);

  const locate = on.last().locate!;
  assert.deepEqual(locate({ kind: "capability", story: story.id }), { x: 10, y: 20, visible: true, box: { left: 0, top: 10, right: 20, bottom: 30 } }, "with its island's box, which the card keeps clear of");
  assert.deepEqual(locate({ kind: "story", story: "story_unboxed" }), { x: 1, y: 2, visible: true }, "an island the globe gives no box for has none");
  assert.deepEqual(locate({ kind: "note", note: "note_1" }), { x: 5, y: 6, visible: false });
  assert.equal(locate({ kind: "switch" }), undefined, "no factory tab on show");
  const tab = on.document.createElement("button");
  tab.className = "app-factory";
  tab.getBoundingClientRect = () => ({ left: 100, right: 140, top: 4, width: 40, height: 40 }) as DOMRect;
  const arcs = on.document.createElement("div");
  arcs.innerHTML = '<button data-rail-tab="arcs"></button>';
  arcs.querySelector<HTMLElement>('[data-rail-tab="arcs"]')!.getBoundingClientRect = () => ({ left: 8, right: 300, top: 48, width: 292, height: 48 }) as DOMRect;
  on.document.body.append(tab, arcs);
  on.content.querySelector(".side-rail")?.remove();
  assert.deepEqual(locate({ kind: "switch" }), { x: 140, y: 24, visible: true });
  assert.deepEqual(locate({ kind: "question" }), { x: 300, y: 72, visible: true }, "at the right of the rail's Arcs tab");
  assert.equal(locate({ kind: "map" }), undefined);
  assert.deepEqual(on.last().islands!(), [{ left: 0, top: 10, right: 20, bottom: 30 }, { left: 60, top: 70, right: 80, bottom: 90 }],
    "every island on show with a box, which a card covers as little of as it can; not one round the back of the globe");

  // What is being read near a card's target, which the card keeps clear of: the open story panel and the target's nameplates.
  const reading = on.last().readingNear!;
  const boxed = (element: HTMLElement, box: { left: number; top: number; right: number; bottom: number }) => {
    element.getBoundingClientRect = () => ({ ...box, width: box.right - box.left, height: box.bottom - box.top }) as DOMRect;
    on.document.body.append(element);
    return element;
  };
  const plate = (attribute: string, id: string, left: number) => {
    const element = on.document.createElement("div");
    element.className = "planet-nameplate";
    element.setAttribute(attribute, id);
    return boxed(element, { left, top: 30, right: left + 50, bottom: 50 });
  };
  plate("data-story-id", story.id, 0); plate("data-story-id", "story_other", 100); plate("data-capability-id", "cap_a", 200);
  const shut = on.document.createElement("aside");
  shut.className = "story-panel";
  shut.hidden = true;
  boxed(shut, { left: 500, top: 12, right: 900, bottom: 588 });
  assert.deepEqual(reading({ kind: "capability", story: story.id, capability: "cap_a" }).map(box => box.left), [0, 200], "its story's and capability's nameplates, not another's");
  shut.hidden = false;
  assert.deepEqual(reading({ kind: "arc" }).map(box => box.left), [500], "the story panel once it is open");
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

test("2.39 · the sessions list and the arcs each mount in their tab of one left rail, Arcs on show at first, the tab chosen kept per project, and the Arcs tab badges what waits on the owner", async (t) => {
  const on = page(t);
  await settled();
  const rail = () => on.content.querySelector<HTMLElement>(".side-rail")!;
  const tabs = () => [...rail().querySelectorAll<HTMLButtonElement>("[role=tab]")];
  const shown = () => tabs().filter((tab) => tab.getAttribute("aria-selected") === "true").map((tab) => tab.dataset.railTab);
  assert.ok(on.content.firstElementChild === rail(), "the rail leads the page, down its left");
  assert.deepEqual(tabs().map((tab) => tab.textContent), ["Sessions", "Arcs"]);
  assert.deepEqual(shown(), ["arcs"], "a project with no tab kept opens on Arcs");
  on.heard();
  const first = on.last();
  assert.ok(first.hosts.arcs === rail().querySelector("#rail-arcs"), "the arcs mount in their tab");
  assert.ok(first.hosts.sessions === rail().querySelector("#rail-sessions"), "the sessions list mounts in its tab");
  assert.equal(first.hosts.sessions!.hidden, true);

  const badge = () => rail().querySelector<HTMLElement>("[data-rail-badge]")!;
  assert.equal(badge().hidden, true);
  first.waiting!(3);
  assert.equal(badge().hidden, false);
  assert.equal(badge().textContent, "3");
  assert.equal(tabs()[1]!.getAttribute("aria-label"), "Arcs, 3 waiting on you");
  first.waiting!(0);
  assert.equal(badge().hidden, true, "nothing waiting, no badge");

  assert.equal(rail().dataset.surfaceId, "arcs", "the rail is the surface of the tab on show");
  tabs()[0]!.click();
  assert.deepEqual(shown(), ["sessions"]);
  assert.equal(rail().dataset.surfaceId, "sessions");
  assert.equal(first.hosts.sessions!.hidden, false);
  assert.equal(first.hosts.arcs!.hidden, true);
  tabs()[0]!.dispatchEvent(new (on.document.defaultView as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.deepEqual(shown(), ["arcs"], "the arrow keys move between the tabs");
  tabs()[0]!.click();

  await on.page.surfacesChanged();
  assert.deepEqual(shown(), ["sessions"], "drawn again, the project keeps the tab chosen");
  assert.equal(on.content.querySelectorAll(".side-rail").length, 1, "the old drawing's rail is let go");
  on.choose({ projects: ["site", "shop"], current: "shop" });
  await on.page.refresh();
  assert.deepEqual(shown(), ["arcs"], "another project keeps its own");

  on.surfaces({ ok: true, value: [{ id: "arcs", on: false, settings: [] }] as never });
  await on.page.surfacesChanged();
  assert.deepEqual(tabs().map((tab) => tab.dataset.railTab), ["sessions"], "a surface switched off has no tab");
  assert.deepEqual(shown(), ["sessions"]);
  on.surfaces({ ok: true, value: [{ id: "arcs", on: false, settings: [] }, { id: "sessions", on: false, settings: [] }] as never });
  await on.page.surfacesChanged();
  assert.ok(on.content.querySelector(".side-rail") === null, "with both off there is no rail");
});

test("2.41 · the arcs mount once the forest has asked its first tree read, at its first news or its first failed read, so their drawing never holds that read back", async (t) => {
  const on = page(t);
  await settled();
  const project = on.last();
  assert.ok(project.reading !== undefined, "the forest's reading has started");
  assert.ok(project.hosts.arcs === undefined, "nothing mounts the arcs while the forest's first read is on the way");
  on.heard();
  await settled();
  assert.deepEqual(project.events, ["tree asked", "arcs mounted"], "the forest asks its tree before the arcs draw");
  assert.ok(project.hosts.arcs === on.content.querySelector("#rail-arcs"), "the arcs mount in their tab");
  on.heard();
  await settled();
  assert.deepEqual(project.mounted.filter((id) => id === "arcs"), ["arcs"], "later news mounts nothing again");

  const failing = page(t);
  await settled();
  failing.readFailed(new Error("the library is away"));
  await settled();
  assert.deepEqual(failing.last().mounted.filter((id) => id === "arcs"), ["arcs"], "a first read that fails mounts the arcs, which keep their own reading");

  const left = page(t);
  await settled();
  const site = left.last();
  left.choose({ projects: ["site", "shop"], current: "shop" });
  await left.page.refresh();
  assert.notEqual(left.last(), site, "another project is on show");
  left.heard(site);
  await settled();
  assert.ok(site.hosts.arcs === undefined, "news reaching a project the user has left mounts no arcs in it");
});

test("2.47 · the arc opened in the Arcs tab rings its open work on the map, and closing it rings none", async (t) => {
  const on = page(t);
  await settled();
  on.heard();
  await settled();
  const project = on.last();
  project.opened!(["cap_a", "cap_b"], ["contract_a"]);
  project.opened!(undefined, undefined);
  assert.deepEqual(project.view.circled, [["cap_a", "cap_b"], undefined]);
  assert.deepEqual(project.view.circledContracts, [["contract_a"], undefined], "the contracts its open work links, whose edges' gates the map rings");
});
