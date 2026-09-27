// @storytree/agent-link: the user's own Claude Code or Codex using storytree by itself
// (the agent link story). It reaches the library only through the library's public API.
export { findProject, locateStorytree, MARKER_FILE, NOT_A_PROJECT, NOT_RUNNING, route, setUpProject, storytreeHome } from "./routing/index.js";
export type { LocateOptions, ProjectLookup, Route, SetUpOptions, StorytreeAddress } from "./routing/index.js";
export { readProjectChoice, recordProjectChoice } from "./routing/project-choice.js";
export { ACTIVITY_DATABASE, NEW_LINE, openActivityLog } from "./activity/index.js";
export type { ActivityLog, Agent, Line, LineKind, LinesSince, LockedLog, NewLine, OpenOptions } from "./activity/index.js";
export { labelOf, QUIET_MS, readSessions, sessionsFrom } from "./sessions/index.js";
export type { Session, SessionOptions, SessionState } from "./sessions/index.js";
export { attachWorkspace, attributeFrom, claim, claimFrom, claimsFrom, land, makeWorkspace, readAttribution, readClaim, readClaims, release } from "./claims/index.js";
export type { Attributed, Claim, ClaimAnswer, ClaimContext, ClaimsOptions, LandAnswer, ReleaseAnswer, ClaimedWorkspace, WorkspaceAnswer, WorkspaceAttachment, WorkspaceRefusal } from "./claims/index.js";
export { createAgentTools, NOT_A_PROJECT_ANSWER, NOT_RUNNING_ANSWER } from "./tools/index.js";
export type { AgentToolOptions, AgentTools, ToolExtension, ToolCall, DefineTool, ToolAnswer } from "./tools/index.js";
export { CHECK_COMMAND, CHECK_FILE, defaultHomes, openStorytree, registerHooks, removeHooks, runSetupCheck, suggestedName, verifyHooks } from "./setup/index.js";
export type { HookCommand, HookRegistration, Homes, HooksReport, RemovalReport, SetupLine, SetupOptions, SetupReport, StorytreeOpened, Verification } from "./setup/index.js";
export { habitsCard } from "./instructions/index.js";
export { CaptureError, hasConcreteEvidence, recordFriction, recordResteer, reinforceFriction } from "./capture/index.js";
export type { NewFriction, NewResteer, Reinforcement } from "./capture/index.js";
