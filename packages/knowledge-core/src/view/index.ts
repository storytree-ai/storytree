// @storytree/knowledge-core/view: the knowledge core's surface, for the app to mount (ADR-0649 D2).
// It needs React and a browser; the package's main entry stays plain logic.
export { createKnowledgeCore, KnowledgeGlobePoints, KnowledgeCoreInside, KnowledgeCorePanel } from "./surface.js";
export type { KnowledgeCore } from "./surface.js";
