/** Capability 1 · Arm switch, and capability 2 · Arm workspaces: the Experiments story's public API (ADR-1064). */
export { ARMS, verdictOf, type ArmRecord, type Verdict } from "./arms.js";
export { armWorkspace, dropArm, makeArm, type Admin, type ArmWorkspace, type MadeArm } from "./workspaces.js";
