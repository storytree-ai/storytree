// Capability 2 · Agent activity log. @storytree/session-management: the record of what the user's own Claude Code or Codex does with storytree
// (the Session management story). It reaches the library only through the library's public API. The MCP server's wrapper calls
// what it exports to name a call's session, record the call and end merged claims (ADR-0969 D1).
export { ACTIVITY_DATABASE, cachedLines, currentBranch, forgetProjectActivity, fullLineText, lineText, openActivityLog, thisMachine } from "./activity/index.js";
export type { ActivityLog, LinesCache, LockedLog, OpenOptions } from "./activity/index.js";
export { closeOut, labelOf, nameRefusal, nameSession, SESSION_NAME_LIMIT, lookAsApp, projectFolder, QUIET_MS, readSessions, sessionsFrom, sessionsListing } from "./sessions/index.js";
export type { CloseOut, CloseOutContext, Session, SessionOptions, SessionState } from "./sessions/index.js";
export { allowCommand, allowIncrement, attachWorkspace, attributeFrom, boardClaims, claim, claimAll, claimFrom, claimsFrom, closed, land, makeWorkspace, presentersOf, presentQuestion, readAttribution, readClaim, readClaims, release, releaseAsked, releaseFor, staleClaims, stopPresenting, CLAIM_REASON_LIMIT, claimRefusal, claimsGuidance, endMergedClaims, increments } from "./claims/index.js";
export type { AllowAnswer, Attributed, Claim, ClaimAnswer, ClaimAllAnswer, ClaimContext, ClaimsOptions, LandAnswer, PresentAnswer, Presenter, ReleaseAnswer, ReleaseForAnswer, StaleClaim, StaleWorklist, MergeWatch, ClaimedWorkspace, OpenPullForWork, WorkspaceAnswer, WorkspaceAttachment, WorkspaceRefusal } from "./claims/index.js";
export { callLines } from "./activity/index.js";
export { AFTER_TOOL, ASK_SETUP, BACKGROUND, CLOSE_OUT_REMINDER, CODEX_DELIVERS_FROM, CODEX_TOOL_EVENTS, codexDelivers, codexHookTrust, codexToolArguments, EDIT_GATE, EVENT, noteCodexHookRan, HOOK_EVENT_TOOL, MOD_TOOLS, SHELL_GUARD, STORYTREE_TOOLS } from "./hooks/index.js";
export { ANTIGRAVITY_HOOKS, defaultHomes, PI_EXTENSION, PI_EXTENSION_SCRIPT, piExtensionScript, registeredHookScripts, scriptsIn } from "./hooks/registered.js";
export type { Homes } from "./hooks/registered.js";
export { ask, pathEnv } from "./sessions/ask.js";
export type { Answer } from "./sessions/ask.js";
export { readAppRecords } from "./sessions/app-records.js";
export type { AppPlaces, AppReading } from "./sessions/app-records.js";
export { hookFailures, noteHookFailure } from "./hooks/failures.js";
export type { HookFailure } from "./hooks/failures.js";
export type { CodexHookTrust } from "./hooks/index.js";
export { contextCommand, contextReading, readContext, readingLines, reportedUsageOf, sessionWindow, tokensSpent, type ReportedUsage } from "./context/index.js";
export { guidanceSentence } from "./context/guidance.js";
export { pruneTranscripts, RETAIN_MS, scrub, shipTranscript, storedContextReading, storedSessionWindow } from "./transcripts/index.js";
export { TranscriptCache } from "./transcripts/index.js";
export type { Arrival, ContextCommandAnswer, ContextCommandOptions, ContextReading, SessionWindow, WindowOpen, WindowReading, WindowTarget } from "./context/index.js";
export { hookToolParts } from "./hooks/tools.js";
