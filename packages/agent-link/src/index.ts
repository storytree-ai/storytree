// Capability 6 · Agent tools (the MCP server). @storytree/agent-link: the user's own Claude Code or Codex using storytree by itself
// (the agent link story). It reaches the library only through the library's public API.
export { findProject, locateApp, locateLibrary, locateStorytree, MARKER_FILE, NOT_A_PROJECT, NOT_RUNNING, openNamedProject, requireApproval, route, setUpProject, storytreeHome, suggestProjectName, withConnectTimeout } from "./routing/index.js";
export { forgetTrunk, machineOf, ProjectFolderError, trunksOn, unusedName } from "./routing/index.js";
export type { LocateOptions, ProjectLookup, Route, SetUpOptions, StorytreeAddress } from "./routing/index.js";
export { keepOnThisComputer, readProjectChoice, recordProjectChoice, recordRemovedProjects, removedProjects, type HiddenProject } from "./routing/project-choice.js";
export { idleAfterMs, leaveAfterMs, readLibrary, readSettings, readSurfaceChoices, setLibrary, setSetting, setSurfaceChoice } from "./settings/settings.js";
export type { LibraryLocation, LibraryReading, SettingReading, SettingsReading, SurfaceChoices } from "./settings/settings.js";
export { ACTIVITY_DATABASE, cachedLines, currentBranch, forgetProjectActivity, fullLineText, lineText, NEW_LINE, openActivityLog, thisMachine } from "./activity/index.js";
export type { ActivityLog, Agent, Line, LineKind, LinesCache, LinesSince, LockedLog, NewLine, OpenOptions } from "./activity/index.js";
export { closeOut, labelOf, nameRefusal, nameSession, SESSION_NAME_LIMIT, lookAsApp, projectFolder, QUIET_MS, readSessions, sessionsFrom, sessionsListing } from "./sessions/index.js";
export type { CloseOut, CloseOutContext, Session, SessionOptions, SessionState } from "./sessions/index.js";
export { attachWorkspace, attributeFrom, boardClaims, claim, claimFrom, claimsFrom, closed, land, makeWorkspace, readAttribution, readClaim, readClaims, release } from "./claims/index.js";
export type { Attributed, Claim, ClaimAnswer, ClaimContext, ClaimsOptions, LandAnswer, ReleaseAnswer, ClaimedWorkspace, OpenPullForWork, WorkspaceAnswer, WorkspaceAttachment, WorkspaceRefusal } from "./claims/index.js";
export { createAgentTools, NOT_A_PROJECT_ANSWER, NOT_RUNNING_ANSWER } from "./tools/index.js";
export type { AgentToolOptions, AgentTools, ToolExtension, ToolCall, DefineTool, ToolAnswer } from "./tools/index.js";
export { codexHookTrust, noteCodexHookRan } from "./hooks/index.js";
export type { CodexHookTrust } from "./hooks/index.js";
export { CHECK_COMMAND, CHECK_FILE, CODEX_TRUST_STEP, defaultHomes, launcherFile, launcherFiles, launcherFor, launcherRuns, markDisconnected, openStorytree, registerHooks, removeHooks, removeLauncher, runSetupCheck, runsElevated, suggestedName, verifyHooks, writeLauncher } from "./setup/index.js";
export type { HookCommand, HookRegistration, Homes, HooksReport, LauncherRuns, RemovalReport, SetupLine, SetupOptions, SetupReport, StorytreeOpened, Verification } from "./setup/index.js";
export { decisionRights, habitsCard, removeCodexInstructions, STANDING_DELEGATION, standingDelegations, writeCodexInstructions } from "./instructions/index.js";
export type { DecisionRights } from "./instructions/index.js";
export { contextCommand, contextReading, readContext, sessionWindow } from "./context/index.js";
export { pruneTranscripts, RETAIN_MS, scrub, shipTranscript, storedContextReading, storedSessionWindow } from "./transcripts/index.js";
export { TranscriptCache } from "./transcripts/index.js";
export type { Arrival, ContextCommandAnswer, ContextCommandOptions, ContextReading, SessionWindow, WindowOpen, WindowReading, WindowTarget } from "./context/index.js";
export { CaptureError, hasConcreteEvidence, recordFriction, recordResteer, reinforceFriction } from "./capture/index.js";
export type { NewFriction, NewResteer, Reinforcement } from "./capture/index.js";
