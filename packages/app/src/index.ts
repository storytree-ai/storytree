// @storytree/app: the app story. The parts of storytree 0.3's app that are plain
// logic, apart from Electron, so they are tested without it: what the app answers when the page
// asks, and the smoke check's judgement. apps/desktop is the app itself, and wires them to the page.
export { pageReads } from "./surfaces/reads.js";
export { projectSelection } from "./projects/selection.js";
export type { ProjectSelection } from "./projects/selection.js";
export type { PageReads, PageReadsOptions } from "./surfaces/reads.js";
export { smokeProblems } from "./surfaces/smoke.js";
export type { Drawn } from "./surfaces/smoke.js";
export { background, TRAY_MENU } from "./lifecycle/background.js";
export type { Background, Launch, TrayItem } from "./lifecycle/background.js";
export { BACKUP_EVERY_MS, BACKUPS_KEPT, backUp } from "./lifecycle/backups.js";
export type { BackUpOptions } from "./lifecycle/backups.js";
export { appDirIn, buildApp, electronIn, setUpRuntime, slotOf, slotSha, updateToMain } from "./updates/follow-main.js";
export type { Build, RunningBuild, Slot } from "./updates/follow-main.js";
export { refreshOwnHealth } from "./updates/own-health.js";
export type { OwnHealthOptions } from "./updates/own-health.js";
export { SEED_CONNECTION, seedWriting } from "./updates/seed-writing.js";
export { ReleaseUpdater } from "./updates/releases.js";
export type { ReleaseOptions } from "./updates/releases.js";
export { buildLabel, launchToRecord } from "./lifecycle/launch.js";
export type { LaunchRecord } from "./lifecycle/launch.js";
export { quitApp } from "./lifecycle/quit.js";
export type { QuitResult } from "./lifecycle/quit.js";
