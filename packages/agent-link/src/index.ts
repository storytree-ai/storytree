// Capability 2 · Agent activity log. @storytree/agent-link: the record of what the user's own Claude Code or Codex does with storytree
// (the agent link story). It reaches the library only through the library's public API. The MCP server's wrapper calls
// what it exports to name a call's session, record the call and end merged claims (ADR-0969 D1).
export { findProject, inMainCheckout, locateApp, locateLibrary, locateStorytree, MARKER_FILE, NOT_A_PROJECT, NOT_RUNNING, openNamedProject, requireApproval, route, storytreeHome, withConnectTimeout } from "./routing/index.js";
export { approveTrunk, forgetTrunk, machineOf, ProjectFolderError, registerTrunk, rememberApproval, trunksOn } from "./routing/index.js";
export type { LocateOptions, ProjectLookup, Route, StorytreeAddress, Trunk } from "./routing/index.js";
export { keepOnThisComputer, readProjectChoice, recordProjectChoice, recordRemovedProjects, removedProjects, type HiddenProject } from "./routing/project-choice.js";
export { idleAfterMs, leaveAfterMs, readLibrary, readSettings, readSurfaceChoices, setLibrary, setSetting, setSurfaceChoice } from "./settings/settings.js";
export type { LibraryLocation, LibraryReading, SettingReading, SettingsReading, SurfaceChoices } from "./settings/settings.js";
export { ACTIVITY_DATABASE, cachedLines, currentBranch, forgetProjectActivity, fullLineText, lineText, NEW_LINE, openActivityLog, thisMachine } from "./activity/index.js";
export type { ActivityLog, Agent, Line, LineKind, LinesCache, LinesSince, LockedLog, NewLine, OpenOptions } from "./activity/index.js";
export { closeOut, labelOf, nameRefusal, nameSession, SESSION_NAME_LIMIT, lookAsApp, projectFolder, QUIET_MS, readSessions, sessionsFrom, sessionsListing } from "./sessions/index.js";
export type { CloseOut, CloseOutContext, Session, SessionOptions, SessionState } from "./sessions/index.js";
export { attachWorkspace, attributeFrom, boardClaims, claim, claimFrom, claimsFrom, closed, land, makeWorkspace, readAttribution, readClaim, readClaims, release, releaseAsked, releaseFor, staleClaims, CLAIM_REASON_LIMIT, claimRefusal, endMergedClaims, increments } from "./claims/index.js";
export type { Attributed, Claim, ClaimAnswer, ClaimContext, ClaimsOptions, LandAnswer, ReleaseAnswer, ReleaseForAnswer, StaleClaim, StaleWorklist, MergeWatch, ClaimedWorkspace, OpenPullForWork, WorkspaceAnswer, WorkspaceAttachment, WorkspaceRefusal } from "./claims/index.js";
export { agentOf, callLines, lineOf, requestOf, seenCaller } from "./sessions/caller.js";
export type { Caller, CallMeta } from "./sessions/caller.js";
export { ASK_SETUP, BACKGROUND, CLOSE_OUT_REMINDER, codexHookTrust, EDIT_GATE, noteCodexHookRan, STORYTREE_TOOLS } from "./hooks/index.js";
export { defaultHomes, registeredHookScripts, scriptsIn } from "./hooks/registered.js";
export type { Homes } from "./hooks/registered.js";
export { ask, pathEnv } from "./sessions/ask.js";
export type { Answer } from "./sessions/ask.js";
export { readAppRecords } from "./sessions/app-records.js";
export type { AppPlaces, AppReading } from "./sessions/app-records.js";
export { hookFailures, noteHookFailure } from "./hooks/failures.js";
export type { HookFailure } from "./hooks/failures.js";
export type { CodexHookTrust } from "./hooks/index.js";
export { decisionRights } from "./settings/decision-rights.js";
export type { DecisionRights } from "./settings/decision-rights.js";
export { STANDING_DELEGATION, standingDelegations } from "./settings/delegations.js";
export { contextCommand, contextReading, readContext, sessionWindow } from "./context/index.js";
export { guidanceSentence } from "./context/guidance.js";
export { pruneTranscripts, RETAIN_MS, scrub, shipTranscript, storedContextReading, storedSessionWindow } from "./transcripts/index.js";
export { TranscriptCache } from "./transcripts/index.js";
export type { Arrival, ContextCommandAnswer, ContextCommandOptions, ContextReading, SessionWindow, WindowOpen, WindowReading, WindowTarget } from "./context/index.js";
export { CaptureError, hasConcreteEvidence, recordFriction, recordResteer, reinforceFriction } from "./capture/index.js";
export type { NewFriction, NewResteer, Reinforcement } from "./capture/index.js";
