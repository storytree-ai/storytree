// @storytree/arc-surface: the arc surface story (stories/arc-surface.md). Its Work states and live
// reading are shared with the forest, which reads them (ADR-0632 D3). Everything exported here is
// safe to bundle into the page: it imports nothing from Node.
export { workStates } from "./work-states/work-states.js";
export type { PartState, WorkStates } from "./work-states/work-states.js";
export { ASK_EVERY_MS, CLOCK_EVERY_MS, liveReading } from "./live-reading/live-reading.js";
export type { LiveReading, LiveReadingOptions, LiveReads, News, Timers } from "./live-reading/live-reading.js";
export { arcState, incrementState } from "./work-states/board-states.js";
export type { ArcFacts, ArcState, IncrementFacts, IncrementReading, IncrementState } from "./work-states/board-states.js";
export { agentsOnBoard } from "./agents/agents.js";
export type { ArcWork, BoardAgent, BoardAgents } from "./agents/agents.js";
export { arcQueues, queueRun, waitsOnBoard } from "./waits/waits.js";
export type { ArcQueue, BoardWaits, NamedWait, QueueArc, QueueChip, QueueRun, WorkName } from "./waits/waits.js";
export { briefing, firstBriefing, questionReading } from "./briefing/briefing.js";
export type { Briefing, Option, Question, QuestionReading } from "./briefing/briefing.js";
export { boardView } from "./board/board.js";
export type { Bar, BoardScope, BoardSnapshot, BoardView, Lane } from "./board/board.js";
export { readBoard } from "./board/reads.js";
export type { BoardReads } from "./board/reads.js";
export { watchBoard } from "./board/live-board.js";
export type { BoardState, WatchBoardOptions } from "./board/live-board.js";
export { arcSmokeProblems } from "./board/smoke.js";
export type { ArcDrawn } from "./board/smoke.js";
export { smokeArcSurface } from "./view/smoke.js";
