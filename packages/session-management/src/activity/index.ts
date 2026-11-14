/** Capability 2 · Agent activity log. */
export { ACTIVITY_DATABASE, forgetProjectActivity, openActivityLog, thisMachine } from "./activity-log.js";
export { currentBranch } from "./branch.js";
export { callLines } from "./call-lines.js";
export { cachedLines } from "./lines-cache.js";
export type { LinesCache } from "./lines-cache.js";
export type { ActivityLog, AppendOptions, BranchFacts, DeliveredEvent, DoorTally, Earlier, LinesStart, LockedLog, OpenOptions, StartOptions } from "./activity-log.js";
export type { LineFilter } from "./bounded.js";
export type { StampedRecord, StoredSession, TranscriptRecord, TranscriptRecords } from "./transcript-records.js";
export type { SessionBeats } from "./session-beats.js";
export type { LaneMessage, LaneMessages, QueuedMode, TakenAt } from "./lane-messages.js";
export type { DayRead, LibraryReads } from "./library-reads.js";
export { fullLineText, lineText } from "./text.js";
