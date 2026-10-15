/**
 * Capability 3 · Story node render. The lag catalogue (ADR-1001 D1, D2): the actions a user takes on the forest's page, each named,
 * with how it is performed (by name, never a point on the screen), what settled looks like and its budget. It is data and two
 * small readings of it, so the lab run (`pnpm lag:desktop`, which performs each with a real mouse) and the app's own recorder
 * read the same catalogue. Measuring a new action is adding an entry.
 */
import { KEPT_DRAWING_KEY, KEPT_TREE_KEY } from "../render/kept-keys.js";

/** ADR-1001 D2: an answer on screen within `responseMs`, no frame over `frameMs` until settled, and settled within `settledMs`
 * unless progress is on show within the response budget and stays until settled. Tuned here; an entry may carry its own. */
export type Budget = { responseMs: number; frameMs: number; settledMs: number };
export const DEFAULT_BUDGET: Budget = { responseMs: 100, frameMs: 50, settledMs: 1000 };

/** An island by its capability count (the fewest or the most) or by its story's id or title. */
export type IslandChoice = "fewest" | "most" | { story: string };

/**
 * One step of an action, performed through the page's real input:
 * `island`, turn the chosen island to face (unmeasured) and click its middle; `note`, click a Library note in view;
 * `click`, click an element's middle (`optional` skips it when the page has none); `key`, press a key; `hover-sweep`,
 * move the mouse across the globe; `idle`, touch nothing for `ms`; `wait`, until the page shows `until`; `start`, open the page
 * again from the start, as opening the app does, having first forgotten the page's kept keys that begin with any of `forget`.
 */
export type Step =
  | { kind: "island"; island: IslandChoice }
  | { kind: "note" }
  | { kind: "click"; selector: string; optional?: true }
  | { kind: "key"; key: string }
  | { kind: "hover-sweep" }
  | { kind: "idle"; ms: number }
  | { kind: "wait"; until: Settled }
  | { kind: "start"; forget: readonly string[] };

/** What settled looks like; every field given must hold. `selected: "island"` is the island the action clicked. */
export type Settled = {
  selected?: "island" | "none";
  panel?: "open" | "closed";
  note?: "any";
  mode?: "forest" | "library";
  session?: "selected";
  /** No camera glide under way. */
  still?: true;
  /** The start is settled: the fresh tree and the start's first code survey drawn (7.31). */
  start?: "settled";
};

/** What the page shows, as the lag run reads it each frame. */
export type PageState = {
  /** The story selected (`document.body.dataset.selected`), and the Library note (`dataset.note`). */
  selected: string | undefined;
  note: string | undefined;
  /** The story panel's slot (`.story-panel`), which the Library card shares, is on show. */
  panelOpen: boolean;
  mode: string | undefined;
  sessionSelected: boolean;
  still: boolean;
  /** A loading bar or circle is on show. */
  progress: boolean;
  /** The page's start is settled (`document.body.dataset.start` is "settled"). */
  startSettled: boolean;
};

export interface LagAction {
  name: string;
  /** Puts the page where the action starts; not measured. */
  setup: Step[];
  perform: Step[];
  settled: Settled;
  budget: Budget;
  /** How long to wait for settled before the round reads NOT RUN. */
  limitMs: number;
  /**
   * The name the app's own recorder (Lag in real use) files this action under when its user takes it, or none when the field cannot
   * tell it from what the page shows. The lab's sizes of one action share it: the field records the size beside it.
   */
  field?: string;
  /**
   * The capability that owns the action and the contract on it that states its budget in the user's terms (ADR-1001 D5). The Mint
   * box's lag run writes that contract's verified verdict, so a slowdown that reproduced makes the capability read not healthy.
   */
  owner: Owner;
}

/** A capability and its budget contract, by their ids in the library. */
export type Owner = { capability: string; contract: string };

/** 4 · Drill-down, 4.16: opening an island, and closing its panel. */
const DRILL_DOWN: Owner = { capability: "capability_f0ffead428df", contract: "contract_f93fcab7b3c3" };
/** 3 · Story node render, 3.47: the Library and back, and a sweep across the globe. */
const STORY_NODE_RENDER: Owner = { capability: "capability_8ffc78a4bad2", contract: "contract_c1a39674d85d" };
/** The knowledge core's 4 · Look inside and inspect an artifact, 4.22: opening a Library note. */
const INSPECT_ARTIFACT: Owner = { capability: "capability_062b84e5c6b0", contract: "contract_7c6061e3f4cf" };
/** 7 · Running sessions, 7.29: opening a session's row. */
const RUNNING_SESSIONS: Owner = { capability: "capability_6133809a4139", contract: "contract_b36003348949" };
/** 3 · Story node render, 3.49: opening the app, with a kept forest and without one. */
const OPENING_THE_APP: Owner = { capability: "capability_8ffc78a4bad2", contract: "contract_67d023b8c77f" };
/** The world's 5 · The canvas, 5.8: a globe left alone. */
const THE_CANVAS: Owner = { capability: "capability_cd7ea3b6ca01", contract: "contract_c58268454e54" };

/** Nothing selected, the panel closed and the glass sheet on its Stories face (the islands on show), still. */
const RESET: Step[] = [{ kind: "key", key: "Escape" }, { kind: "click", selector: "[data-globe-switch=stories][aria-pressed=false]", optional: true },
  { kind: "wait", until: { mode: "forest", panel: "closed", still: true } }];
const openIsland = (name: string, island: IslandChoice): LagAction => ({ name, setup: RESET, perform: [{ kind: "island", island }],
  settled: { selected: "island", panel: "open", still: true }, budget: DEFAULT_BUDGET, limitMs: 10_000, field: "open-island", owner: DRILL_DOWN });

/** The library's island is the owner's case (ADR-1001's context); `lag:desktop --story` names another. */
export const NAMED_STORY = "The library";

export const CATALOGUE: readonly LagAction[] = [
  openIsland("open-fewest-island", "fewest"),
  openIsland("open-most-island", "most"),
  openIsland("open-named-island", { story: NAMED_STORY }),
  // Opening the app is a real start of the page: the kept forest the last start left, or none, until the globe is settled. A start
  // has no input, so the field recorder cannot tell one from what the page shows, and files none.
  { name: "open-app-kept", setup: [], perform: [{ kind: "start", forget: [] }], settled: { start: "settled" }, budget: DEFAULT_BUDGET, limitMs: 60_000, owner: OPENING_THE_APP },
  { name: "open-app-fresh", setup: [], perform: [{ kind: "start", forget: [KEPT_TREE_KEY, KEPT_DRAWING_KEY] }], settled: { start: "settled" }, budget: DEFAULT_BUDGET,
    limitMs: 60_000, owner: OPENING_THE_APP },
  { name: "close-panel", setup: [...RESET, { kind: "island", island: "most" }, { kind: "wait", until: { selected: "island", panel: "open", still: true } }],
    perform: [{ kind: "click", selector: ".story-panel .panel-close" }], settled: { selected: "none", panel: "closed" }, budget: DEFAULT_BUDGET, limitMs: 10_000, field: "close-panel", owner: DRILL_DOWN },
  { name: "library-and-back", setup: RESET,
    perform: [{ kind: "click", selector: "[data-globe-switch=library]" }, { kind: "wait", until: { mode: "library" } }, { kind: "click", selector: "[data-globe-switch=stories]" }],
    settled: { mode: "forest", still: true }, budget: DEFAULT_BUDGET, limitMs: 10_000, owner: STORY_NODE_RENDER },
  { name: "open-library-note", setup: [...RESET, { kind: "click", selector: "[data-globe-switch=library]" }, { kind: "wait", until: { mode: "library", still: true } }],
    perform: [{ kind: "note" }], settled: { note: "any", panel: "open" }, budget: DEFAULT_BUDGET, limitMs: 10_000, field: "open-library-note", owner: INSPECT_ARTIFACT },
  { name: "open-session-row", setup: [...RESET, { kind: "click", selector: ".sessions-handle[aria-expanded=false]", optional: true },
    { kind: "click", selector: ".session-row[data-selected]", optional: true }],
    perform: [{ kind: "click", selector: ".session-row" }], settled: { session: "selected" }, budget: DEFAULT_BUDGET, limitMs: 10_000, field: "open-session-row", owner: RUNNING_SESSIONS },
  { name: "hover-sweep", setup: RESET, perform: [{ kind: "hover-sweep" }], settled: {}, budget: DEFAULT_BUDGET, limitMs: 10_000, owner: STORY_NODE_RENDER },
  { name: "idle", setup: RESET, perform: [{ kind: "idle", ms: 10_000 }], settled: {}, budget: DEFAULT_BUDGET, limitMs: 10_000, owner: THE_CANVAS },
];

/** The story whose island `choice` names among those drawn, or undefined when none is. Ties go to the first drawn. */
export function chooseIsland(choice: IslandChoice, islands: readonly { story: string; title?: string; capabilities: number }[]): string | undefined {
  if (typeof choice === "object") return islands.find(island => island.story === choice.story || island.title === choice.story)?.story;
  const better = (a: number, b: number) => choice === "fewest" ? a < b : a > b;
  return islands.reduce<(typeof islands)[number] | undefined>((best, island) => best === undefined || better(island.capabilities, best.capabilities) ? island : best, undefined)?.story;
}

/** Whether `page` shows what `want` says settled looks like; `island` is the story the action clicked. */
export function isSettled(want: Settled, page: PageState, island?: string): boolean {
  if (want.selected === "island" && (island === undefined || page.selected !== island)) return false;
  if (want.selected === "none" && page.selected !== undefined) return false;
  if (want.panel !== undefined && page.panelOpen !== (want.panel === "open")) return false;
  if (want.note === "any" && page.note === undefined) return false;
  if (want.mode !== undefined && page.mode !== want.mode) return false;
  if (want.session === "selected" && !page.sessionSelected) return false;
  if (want.start === "settled" && !page.startSettled) return false;
  return !want.still || page.still;
}
