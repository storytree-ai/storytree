// @storytree/arc-surface: the arc surface story. Its Work states and live
// reading are shared with the forest, which reads them (ADR-0632 D3). Everything exported here is
// safe to bundle into the page: it imports nothing from Node.
export { workStates } from "./work-states/work-states.js";
export type { PartState, WorkStates } from "./work-states/work-states.js";
export { ASK_EVERY_MS, CLOCK_EVERY_MS, liveReading } from "./live-reading/live-reading.js";
export type { LiveReading, LiveReadingOptions, LiveReads, News, Timers } from "./live-reading/live-reading.js";
