/** Capability 8 · Setup check. */
export { builtFromMain, codexHooksState, defaultHomes, disconnectedHarnesses, ghState, installedCodexVersion, markDisconnected, machineState, NODE_FLOOR, openStorytree, putCommandOnPath, registerHooks, setupGuidance, removeCommand, removeHooks, runSetupCheck, runsElevated } from "./setup.js";
export type { AgentCliState, CommandInstall, FollowMainOptions, CommandPath, GhState, Harness, HookCommand, MachineOptions, MachineState, ToolState, HookRegistration, Homes, HooksReport, RemovalReport, ServerEntry, SetupLine, SetupOptions, SetupReport, StorytreeOpened } from "./setup.js";
export { launcherFile, launcherFiles, launcherFor, launcherRuns, removeLauncher, writeLauncher } from "./command.js";
export type { LauncherRuns } from "./command.js";
export { CODEX_TRUST_STEP } from "../connect/codex.js";
export { CHECK_COMMAND, checkFile, checkFilesWritten, FIX_SENTENCES, fixSentence, HOOK_TESTS, verifyHooks } from "./verify.js";
export type { Fix, HookTest, Verification } from "./verify.js";
