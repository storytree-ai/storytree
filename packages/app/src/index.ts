// Capability 3 · Surfaces. @storytree/app: the app story. The parts of storytree 0.3's app that are plain
// logic, apart from Electron, so they are tested without it: what the app answers when the page
// asks, and the smoke check's judgement. apps/desktop is the app itself, and wires them to the page.
export { pageReads } from "./surfaces/reads.js";
export { projectSelection } from "./projects/selection.js";
export type { ProjectSelection } from "./projects/selection.js";
export type { PageReads, PageReadsOptions } from "./surfaces/reads.js";
export { smokeProblems } from "./surfaces/smoke.js";
export { readSurfaces, setSurface, surfacesActions } from "./surfaces/switches.js";
export { PAGE_READS_CHANNELS, SURFACES_CHANNELS, surfaceOn, type PageReadsBridge, type SurfacesBridge, type SurfacesResult } from "./surfaces/bridge.js";
export type { SurfaceChoice, SurfaceDeclaration, SurfaceReading, SurfaceSettingDeclaration, SurfaceSettingReading } from "./surfaces/switches.js";
export type { Drawn } from "./surfaces/smoke.js";
export { background, thisBuild, TRAY_MENU } from "./lifecycle/background.js";
export type { Background, Launch, TrayItem } from "./lifecycle/background.js";
export { BACKUP_EVERY_MS, BACKUPS_KEPT, backUp, keepBackups } from "./lifecycle/backups.js";
export type { BackUpOptions } from "./lifecycle/backups.js";
export { noUpdates } from "./updates/update-state.js";
export type { UpdateAction, UpdateState } from "./updates/update-state.js";
export { seedWriting } from "./updates/seed-writing.js";
export { ReleaseUpdater } from "./updates/releases.js";
export { releaseChannel, releaseChannelChoice } from "./updates/release-channel.js";
export { installation, installedAppDir } from "./updates/installation.js";
export type { Installation } from "./updates/installation.js";
export { pinRelease } from "./updates/stable-github.js";
export { QUIET_MS, quietMoment, SETTLE_MS, whenToInstall } from "./updates/install-moment.js";
export type { InstallMoment } from "./updates/install-moment.js";
export { installChoice } from "./updates/install-choice-file.js";
export type { InstallChoice, InstallChoiceState } from "./updates/install-choice.js";
export { agentActiveAt } from "./updates/agent-activity.js";
export type { ReleaseOptions } from "./updates/releases.js";
export { buildLabel, checkoutSha, launchToRecord } from "./lifecycle/launch.js";
export type { LaunchRecord } from "./lifecycle/launch.js";
export { openAppLibrary } from "./lifecycle/open-where-set.js";
export type { AppLibrary, AppLibraryOptions, StartedPostgres } from "./lifecycle/open-where-set.js";
export { quitApp } from "./lifecycle/quit.js";
export { loginItemsFor, SIGN_IN_LABEL, SIGN_IN_NAME, signIn } from "./lifecycle/sign-in.js";
export type { LoginItem, SignInState } from "./lifecycle/sign-in.js";
export type { QuitResult } from "./lifecycle/quit.js";
