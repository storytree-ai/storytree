// Capability 4 · Work model
export { attachedLines, attachedTo, shelfOf, type Attached, type ShelfEntry } from "./attached.js";
export { bareSaid } from "./bare.js";
export { filedOnSaid } from "./filed.js";
export { CONTRACT_DEFINITION, CONTRACT_PLACEMENT, LONG_CONTRACT_TITLE, planGuidance } from "./guidance.js";
export { CONTRACT_PROOFS, PIN_ICONS, PLAN_KINDS, PLAN_PENDING_CHANGE, STORE_LINK_DIRECTIONS, type PendingPlanChange } from "./kinds.js";
export { recordPin, type PinNote } from "./pin.js";
export type { ImportedPluginPlan, PluginImportOptions, PluginPlan, PluginPlanCapability, PluginPlanHeld } from "./plugin-plan.js";
export { beforeCutover, pullRepository, pullSaid, type PrCutover } from "./pr-cutover.js";
export {
  ANCHOR_ID,
  anchorGaps,
  type Anchor,
  type AnchorGaps,
  type ArcNode,
  type CapabilityNode,
  type CodeEdge,
  type ContractNode,
  type EdgeFile,
  type EdgeNode,
  type FileImport,
  type PartClash,
  type ProjectTree,
  type SharedStore,
  type StoreLink,
  type StoreTable,
  type StoryNode,
  type StorySurvey,
  type SurveyedFile,
  type SurveyedPart,
  type SurveyedParts,
  type SurveyedTest,
} from "./tree.js";
export {
  WorkModel,
  type AnchorEdit,
  type CapabilityEdit,
  type CapabilityWriteOptions,
  type ContractEdit,
  type ContractWriteOptions,
  type EdgeEdit,
  type MappedPackage,
  type MappedStories,
  type MovedToEdges,
  type NewCapability,
  type NewContract,
  type NewEdge,
  type NewStory,
  type StoryEdit,
} from "./work-model.js";
