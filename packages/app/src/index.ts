// @storytree/app: the app story. The parts of storytree 0.3's app that are plain
// logic, apart from Electron, so they are tested without it: what the app answers when the page
// asks, and the smoke check's judgement. apps/desktop is the app itself, and wires them to the page.
export { pageReads } from "./surfaces/reads.js";
export type { PageReads, PageReadsOptions } from "./surfaces/reads.js";
export { smokeProblems } from "./surfaces/smoke.js";
export type { Drawn } from "./surfaces/smoke.js";
export { background, TRAY_MENU } from "./lifecycle/background.js";
export type { Background, TrayItem } from "./lifecycle/background.js";
export { appDirIn, buildApp, electronIn, setUpRuntime, slotOf, slotSha, updateToMain } from "./updates/follow-main.js";
export type { Build, RunningBuild, Slot } from "./updates/follow-main.js";
