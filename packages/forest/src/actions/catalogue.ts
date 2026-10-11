/**
 * Capability 3 · Story node render. The lag catalogue (ADR-1001 D1, D2): the actions a user takes on the forest's page, each named,
 * with how it is performed (by name, never a point on the screen), what settled looks like and its budget. It is data and two
 * small readings of it, so the lab run (`pnpm lag:desktop`, which performs each with a real mouse) and the app's own recorder
 * read the same catalogue. Measuring a new action is adding an entry.
 */

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
 * move the mouse across the globe; `idle`, touch nothing for `ms`; `wait`, until the page shows `until`.
 */
export type Step =
  | { kind: "island"; island: IslandChoice }
  | { kind: "note" }
  | { kind: "click"; selector: string; optional?: true }
  | { kind: "key"; key: string }
  | { kind: "hover-sweep" }
  | { kind: "idle"; ms: number }
  | { kind: "wait"; until: Settled };

/** What settled looks like; every field given must hold. `selected: "island"` is the island the action clicked. */
export type Settled = {
  selected?: "island" | "none";
  panel?: "open" | "closed";
  note?: "any";
  mode?: "forest" | "library";
  session?: "selected";
  /** No camera glide under way. */
  still?: true;
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
}

/** Nothing selected, the panel closed and the globe on Forest, still. */
const RESET: Step[] = [{ kind: "key", key: "Escape" }, { kind: "click", selector: "[data-forest-mode=forest][aria-pressed=false]", optional: true },
  { kind: "wait", until: { panel: "closed", still: true } }];
const openIsland = (name: string, island: IslandChoice): LagAction => ({ name, setup: RESET, perform: [{ kind: "island", island }],
  settled: { selected: "island", panel: "open", still: true }, budget: DEFAULT_BUDGET, limitMs: 10_000 });

/** The library's island is the owner's case (ADR-1001's context); `lag:desktop --story` names another. */
export const NAMED_STORY = "The library";

export const CATALOGUE: readonly LagAction[] = [
  openIsland("open-fewest-island", "fewest"),
  openIsland("open-most-island", "most"),
  openIsland("open-named-island", { story: NAMED_STORY }),
  { name: "close-panel", setup: [...RESET, { kind: "island", island: "most" }, { kind: "wait", until: { selected: "island", panel: "open", still: true } }],
    perform: [{ kind: "click", selector: ".story-panel .panel-close" }], settled: { selected: "none", panel: "closed" }, budget: DEFAULT_BUDGET, limitMs: 10_000 },
  { name: "library-and-back", setup: RESET,
    perform: [{ kind: "click", selector: "[data-forest-mode=library]" }, { kind: "wait", until: { mode: "library" } }, { kind: "click", selector: "[data-forest-mode=forest]" }],
    settled: { mode: "forest", still: true }, budget: DEFAULT_BUDGET, limitMs: 10_000 },
  { name: "open-library-note", setup: [...RESET, { kind: "click", selector: "[data-forest-mode=library]" }, { kind: "wait", until: { mode: "library", still: true } }],
    perform: [{ kind: "note" }], settled: { note: "any", panel: "open" }, budget: DEFAULT_BUDGET, limitMs: 10_000 },
  { name: "open-session-row", setup: [...RESET, { kind: "click", selector: ".sessions-handle[aria-expanded=false]", optional: true },
    { kind: "click", selector: ".session-row[data-selected]", optional: true }],
    perform: [{ kind: "click", selector: ".session-row" }], settled: { session: "selected" }, budget: DEFAULT_BUDGET, limitMs: 10_000 },
  { name: "hover-sweep", setup: RESET, perform: [{ kind: "hover-sweep" }], settled: {}, budget: DEFAULT_BUDGET, limitMs: 10_000 },
  { name: "idle", setup: RESET, perform: [{ kind: "idle", ms: 10_000 }], settled: {}, budget: DEFAULT_BUDGET, limitMs: 10_000 },
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
  return !want.still || page.still;
}
