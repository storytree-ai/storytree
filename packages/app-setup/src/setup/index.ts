/** Capability 8 · Setup check. */
export { builtFromMain, codexHooksState, defaultHomes, disconnectedHarnesses, ghState, markDisconnected, machineState, NODE_FLOOR, openStorytree, putCommandOnPath, registerHooks, removeCommand, removeHooks, runSetupCheck, runsElevated } from "./setup.js";
export type { AgentCliState, CommandInstall, FollowMainOptions, CommandPath, GhState, Harness, HookCommand, MachineOptions, MachineState, ToolState, HookRegistration, Homes, HooksReport, RemovalReport, SetupLine, SetupOptions, SetupReport, StorytreeOpened } from "./setup.js";
export { launcherFile, launcherFiles, launcherFor, launcherRuns, removeLauncher, writeLauncher } from "./command.js";
export type { LauncherRuns } from "./command.js";
export { CHECK_COMMAND, CHECK_FILE, checkFilesWritten, CODEX_TRUST_STEP, FIX_SENTENCES, HOOK_TESTS, verifyHooks } from "./verify.js";
export type { Fix, HookTest, Verification } from "./verify.js";
