/** The Experiments story's public API (ADR-1064): capability 1 · Arm switch, capability 2 · Arm workspaces. */
export { ARMS, verdictOf, type ArmRecord, type Verdict } from "./arms.js";
export { armWorkspace, dropArm, makeArm, type Admin, type ArmWorkspace, type MadeArm } from "./workspaces.js";
