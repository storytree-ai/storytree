// @storytree/app: the app story. The parts of storytree 0.3's app that are plain
// logic, apart from Electron, so they are tested without it: what the app answers when the page
// asks, and the smoke check's judgement. apps/desktop is the app itself, and wires them to the page.
export { pageReads } from "./surfaces/reads.js";
export { projectSelection } from "./projects/selection.js";
export type { ProjectSelection } from "./projects/selection.js";
export type { PageReads, PageReadsOptions } from "./surfaces/reads.js";
export { smokeProblems } from "./surfaces/smoke.js";
export { readSurfaces, setSurface, surfacesActions } from "./surfaces/switches.js";
export { SURFACES_CHANNELS, surfaceOn, type SurfacesBridge, type SurfacesResult } from "./surfaces/bridge.js";
export type { SurfaceChoice, SurfaceDeclaration, SurfaceReading, SurfaceSettingDeclaration, SurfaceSettingReading } from "./surfaces/switches.js";
export type { Drawn } from "./surfaces/smoke.js";
export { background, TRAY_MENU } from "./lifecycle/background.js";
export type { Background, Launch, TrayItem } from "./lifecycle/background.js";
export { BACKUP_EVERY_MS, BACKUPS_KEPT, backUp } from "./lifecycle/backups.js";
export type { BackUpOptions } from "./lifecycle/backups.js";
export { appDirIn, buildApp, electronIn, setUpRuntime, slotOf, slotSha, updateToMain } from "./updates/follow-main.js";
export type { Build, RunningBuild, Slot } from "./updates/follow-main.js";
export { mainUpdates } from "./updates/main-updates.js";
export type { UpdateAction, UpdateState } from "./updates/main-updates.js";
export { refreshOwnHealth } from "./updates/build-health.js";
export type { OwnHealthOptions } from "./updates/build-health.js";
export { SEED_CONNECTION, seedWriting } from "./updates/seed-writing.js";
export { ReleaseUpdater } from "./updates/releases.js";
export { QUIET_MS, SETTLE_MS, whenToInstall } from "./updates/install-moment.js";
export type { InstallMoment } from "./updates/install-moment.js";
export { agentActiveAt } from "./updates/agent-activity.js";
export type { ReleaseOptions } from "./updates/releases.js";
export { buildLabel, launchToRecord } from "./lifecycle/launch.js";
export type { LaunchRecord } from "./lifecycle/launch.js";
export { openAppLibrary } from "./lifecycle/open-where-set.js";
export type { AppLibrary, AppLibraryOptions, StartedPostgres } from "./lifecycle/open-where-set.js";
export { quitApp } from "./lifecycle/quit.js";
export { SIGN_IN_NAME, signIn } from "./lifecycle/sign-in.js";
export type { LoginItem, SignInState } from "./lifecycle/sign-in.js";
export type { QuitResult } from "./lifecycle/quit.js";
