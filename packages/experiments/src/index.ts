/** Capability 1 · Arm switch: the Experiments story's public API (ADR-1064). */
export { ARMS, verdictOf, type ArmRecord, type Verdict } from "./arms.js";
/** Capability 3 · Arm repositories. */
export {
  ARM_WORKFLOW_PATH, HIDDEN_TESTS_ENVIRONMENT, ORGANISATION, archiveArmRepositories, armRepositoryName, armWorkflow, armWorkflowText, ghCli, makeArmRepository,
  type ArmCi, type ArmRepositorySpec, type Gh,
} from "./repositories.js";
