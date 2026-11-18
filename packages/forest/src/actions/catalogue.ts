// Capability 3 · Story node render
import { KEPT_DRAWING_KEY, KEPT_TREE_KEY } from "../render/kept-keys.js";

export { sheetDrag } from "../view/sheet-drag.js";

export type Budget = { responseMs: number; frameMs: number; settledMs: number };
export const DEFAULT_BUDGET: Budget = { responseMs: 100, frameMs: 50, settledMs: 1000 };

export type IslandChoice = "fewest" | "most" | { story: string };

export type Step =
  | { kind: "island"; island: IslandChoice }
  | { kind: "part"; island: IslandChoice }
  | { kind: "note" }
  | { kind: "click"; selector: string; optional?: true }
  | { kind: "key"; key: string }
  | { kind: "hover-sweep" }
  | { kind: "turn" }
  | { kind: "idle"; ms: number }
  | { kind: "wait"; until: Settled }
  | { kind: "start"; forget: readonly string[] };

export type Settled = {
  selected?: "island" | "none";
  panel?: "open" | "closed";
  note?: "any";
  mode?: "forest" | "library";
  session?: "selected";
  still?: true;
  start?: "settled";
  fold?: string;
};

export type PageState = {
  selected: string | undefined;
  note: string | undefined;
  panelOpen: boolean;
  mode: string | undefined;
  sessionSelected: boolean;
  still: boolean;
  progress: boolean;
  startSettled: boolean;
  folds?: readonly string[];
};

export interface LagAction {
  name: string;
  setup: Step[];
  perform: Step[];
  settled: Settled;
  budget: Budget;
  limitMs: number;
  field?: string;
  owner: Owner;
  turns?: "forest" | "library";
  keptThroughNews?: true;
}

export type Owner = { capability: string; contract: string };

const DRILL_DOWN: Owner = { capability: "capability_f0ffead428df", contract: "contract_f93fcab7b3c3" };
const PANEL_FOLDS: Owner = { capability: "capability_f0ffead428df", contract: "contract_e2f4b79c7350" };
const STORY_NODE_RENDER: Owner = { capability: "capability_8ffc78a4bad2", contract: "contract_c1a39674d85d" };
const INSPECT_ARTIFACT: Owner = { capability: "capability_062b84e5c6b0", contract: "contract_7c6061e3f4cf" };
const RUNNING_SESSIONS: Owner = { capability: "capability_6133809a4139", contract: "contract_b36003348949" };
const OPENING_THE_APP: Owner = { capability: "capability_8ffc78a4bad2", contract: "contract_67d023b8c77f" };
const TURNING_THE_MAP: Owner = { capability: "capability_8ffc78a4bad2", contract: "contract_42255f86bb07" };
const THE_CANVAS: Owner = { capability: "capability_cd7ea3b6ca01", contract: "contract_c58268454e54" };

const RESET: Step[] = [{ kind: "key", key: "Escape" }, { kind: "click", selector: "[data-globe-switch=stories][aria-pressed=false]", optional: true },
  { kind: "wait", until: { mode: "forest", panel: "closed", still: true } }];
const openIsland = (name: string, island: IslandChoice): LagAction => ({ name, setup: RESET, perform: [{ kind: "island", island }],
  settled: { selected: "island", panel: "open", still: true }, budget: DEFAULT_BUDGET, limitMs: 10_000, field: "open-island", owner: DRILL_DOWN });

export const NAMED_STORY = "The library";

const NAMED_OPEN: Step[] = [{ kind: "island", island: { story: NAMED_STORY } }, { kind: "wait", until: { selected: "island", panel: "open", still: true } }];
const NAMED_CAPABILITY: Step[] = [...NAMED_OPEN, { kind: "click", selector: ".story-panel .panel-story-name", optional: true },
  { kind: "wait", until: { selected: "island", panel: "open", still: true } }, { kind: "click", selector: ".story-panel .panel-pick" },
  { kind: "wait", until: { selected: "island", panel: "open", still: true } }];
const CONTRACT = ".story-panel .panel-fold[data-fold=contract] > .panel-handle";

export const CATALOGUE: readonly LagAction[] = [
  openIsland("open-fewest-island", "fewest"),
  openIsland("open-most-island", "most"),
  openIsland("open-named-island", { story: NAMED_STORY }),
  { ...openIsland("open-part-after-arc", { story: NAMED_STORY }), perform: [{ kind: "part", island: { story: NAMED_STORY } }],
    setup: [...RESET, { kind: "click", selector: "[data-rail-tab=arcs][aria-selected=false]", optional: true },
      { kind: "click", selector: ".arc-lane[aria-pressed=true]", optional: true }, { kind: "idle", ms: 500 },
      { kind: "click", selector: ".arc-lane[aria-pressed=false]" }, { kind: "idle", ms: 300 }] },
  { name: "open-app-kept", setup: [], perform: [{ kind: "start", forget: [] }], settled: { start: "settled" }, budget: DEFAULT_BUDGET, limitMs: 60_000, owner: OPENING_THE_APP },
  { name: "open-app-fresh", setup: [], perform: [{ kind: "start", forget: [KEPT_TREE_KEY, KEPT_DRAWING_KEY] }], settled: { start: "settled" }, budget: DEFAULT_BUDGET,
    limitMs: 60_000, owner: OPENING_THE_APP },
  { name: "close-panel", setup: [...RESET, { kind: "island", island: "most" }, { kind: "wait", until: { selected: "island", panel: "open", still: true } }],
    perform: [{ kind: "click", selector: ".story-panel .panel-close" }], settled: { selected: "none", panel: "closed" }, budget: DEFAULT_BUDGET, limitMs: 10_000, field: "close-panel", owner: DRILL_DOWN },
  { name: "click-fold", setup: [...RESET, ...NAMED_CAPABILITY],
    perform: [{ kind: "click", selector: ".story-panel [data-fold] > .panel-handle" }], settled: { panel: "open" }, budget: DEFAULT_BUDGET, limitMs: 10_000, owner: DRILL_DOWN },
  { name: "drill-microscope", setup: [...RESET, ...NAMED_OPEN, { kind: "click", selector: ".story-panel .panel-story-name", optional: true },
    { kind: "wait", until: { selected: "island", panel: "open", still: true } }, { kind: "idle", ms: 5000 }],
    perform: [{ kind: "click", selector: ".story-panel .panel-microscope [data-pick-capability]" }], settled: { panel: "open", still: true },
    budget: DEFAULT_BUDGET, limitMs: 10_000, owner: DRILL_DOWN },
  { name: "open-fold", setup: [...RESET, ...NAMED_CAPABILITY],
    perform: [{ kind: "click", selector: CONTRACT }], settled: { fold: "contract" }, budget: DEFAULT_BUDGET, limitMs: 10_000, owner: PANEL_FOLDS },
  { name: "open-contract", setup: [...RESET, ...NAMED_CAPABILITY],
    perform: [{ kind: "click", selector: CONTRACT }], settled: { fold: "contract" }, budget: DEFAULT_BUDGET,
    limitMs: 10_000, keptThroughNews: true, owner: PANEL_FOLDS },
  { name: "library-and-back", setup: RESET,
    perform: [{ kind: "click", selector: "[data-globe-switch=library]" }, { kind: "wait", until: { mode: "library" } }, { kind: "click", selector: "[data-globe-switch=stories]" }],
    settled: { mode: "forest", still: true }, budget: DEFAULT_BUDGET, limitMs: 10_000, owner: STORY_NODE_RENDER },
  { name: "open-library-note", setup: [...RESET, { kind: "click", selector: "[data-globe-switch=library]" }, { kind: "wait", until: { mode: "library", still: true } }],
    perform: [{ kind: "note" }], settled: { note: "any", panel: "open" }, budget: DEFAULT_BUDGET, limitMs: 10_000, field: "open-library-note", owner: INSPECT_ARTIFACT },
  { name: "open-session-row", setup: [...RESET, { kind: "click", selector: "[data-rail-tab=sessions][aria-selected=false]", optional: true },
    { kind: "click", selector: ".session-row[data-selected]", optional: true }],
    perform: [{ kind: "click", selector: ".session-row" }], settled: { session: "selected" }, budget: DEFAULT_BUDGET, limitMs: 10_000, field: "open-session-row", owner: RUNNING_SESSIONS },
  { name: "hover-sweep", setup: RESET, perform: [{ kind: "hover-sweep" }], settled: {}, budget: DEFAULT_BUDGET, limitMs: 10_000, owner: STORY_NODE_RENDER },
  { name: "turn-forest", setup: RESET, perform: [{ kind: "turn" }], settled: {}, budget: DEFAULT_BUDGET, limitMs: 10_000, field: "turn-forest", turns: "forest",
    owner: TURNING_THE_MAP },
  { name: "turn-library", setup: [...RESET, { kind: "click", selector: "[data-globe-switch=library]" }, { kind: "wait", until: { mode: "library", still: true } }],
    perform: [{ kind: "turn" }], settled: {}, budget: DEFAULT_BUDGET, limitMs: 10_000, field: "turn-library", turns: "library", owner: TURNING_THE_MAP },
  { name: "whole-map", setup: [...RESET, { kind: "key", key: "ArrowRight" }, { kind: "wait", until: { still: true } }],
    perform: [{ kind: "click", selector: "button.whole-map" }], settled: { still: true }, budget: DEFAULT_BUDGET, limitMs: 10_000, owner: TURNING_THE_MAP },
  { name: "idle", setup: RESET, perform: [{ kind: "idle", ms: 10_000 }], settled: {}, budget: DEFAULT_BUDGET, limitMs: 10_000, owner: THE_CANVAS },
];

export function chooseIsland(choice: IslandChoice, islands: readonly { story: string; title?: string; capabilities: number }[]): string | undefined {
  if (typeof choice === "object") return islands.find(island => island.story === choice.story || island.title === choice.story)?.story;
  const better = (a: number, b: number) => choice === "fewest" ? a < b : a > b;
  return islands.reduce<(typeof islands)[number] | undefined>((best, island) => best === undefined || better(island.capabilities, best.capabilities) ? island : best, undefined)?.story;
}

export function isSettled(want: Settled, page: PageState, island?: string): boolean {
  if (want.selected === "island" && (island === undefined || page.selected !== island)) return false;
  if (want.selected === "none" && page.selected !== undefined) return false;
  if (want.panel !== undefined && page.panelOpen !== (want.panel === "open")) return false;
  if (want.note === "any" && page.note === undefined) return false;
  if (want.mode !== undefined && page.mode !== want.mode) return false;
  if (want.session === "selected" && !page.sessionSelected) return false;
  if (want.start === "settled" && !page.startSettled) return false;
  if (want.fold !== undefined && page.folds?.includes(want.fold) !== true) return false;
  return !want.still || page.still;
}

export function turnFrames(frameTimes: readonly number[], frameMs: number): { p50: number; p95: number; max: number; over: number } {
  const intervals = frameTimes.slice(1).map((at, n) => at - frameTimes[n]!).sort((a, b) => a - b);
  if (intervals.length === 0) return { p50: 0, p95: 0, max: 0, over: 0 };
  const rank = (p: number) => intervals[Math.max(0, Math.ceil(p * intervals.length) - 1)]!;
  return { p50: rank(0.5), p95: rank(0.95), max: intervals.at(-1)!, over: intervals.filter((ms) => ms > frameMs).length };
}
