// Capability 3 · The caller. Which session, which of its agents and which harness made a call, and the harnesses
// storytree watches (ADR-1025 D2). Browser-safe: Session management's readings entry and the pages load it.
export { agentOf, callOf, lineOf, requestOf, seenCaller, type Caller, type CallMeta } from "./caller.js";
export { harnessOfClient, HARNESS_IDS, NAME_A_SESSION, SESSION_ENV, tierOf, watchedHarness, WATCHED_HARNESSES, type Harness, type Tier, type WatchedHarness } from "./harnesses.js";
