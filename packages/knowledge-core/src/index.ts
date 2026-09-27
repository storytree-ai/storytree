// @storytree/knowledge-core: the knowledge inside the planet (stories/knowledge-core.md). It reads
// the library only through the change history its public API gives, and the agent link only
// through its activity log's lines.
export { knowledge } from "./ghosts/ghosts.js";
export type { Ghost, GhostEvidence, Knowledge } from "./ghosts/ghosts.js";
export { EMPTY_SHELF, LOOP_LABEL, underShelves } from "./shelves/shelves.js";
export type { Core, Loop, Placement, Shelf } from "./shelves/shelves.js";
