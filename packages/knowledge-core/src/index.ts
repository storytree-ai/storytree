// @storytree/knowledge-core: the knowledge inside the planet (stories/knowledge-core.md). It reads
// the library only through the change history its public API gives, and the agent link only
// through its activity log's lines.
export { knowledge } from "./ghosts/ghosts.js";
export type { Ghost, GhostEvidence, Knowledge } from "./ghosts/ghosts.js";
export { EMPTY_SHELF, LOOP_LABEL, underShelves } from "./shelves/shelves.js";
export type { Core, Loop, Placement, Shelf } from "./shelves/shelves.js";
export { NO_RECORDED_READS, ReadRecord } from "./reads/reads.js";
export type { AgentReplay, Jump, Lit, Replay } from "./reads/reads.js";
export { coreScene, legend, noteCard, noteTitle, pinnedLinks, replayFrame, SIZE_LABELS } from "./look-inside/look-inside.js";
export type { Card, CoreInput, CoreScene, DrawnNote, Entrance, LegendEntry, Link, Point, ReplayFrame, SizeBy } from "./look-inside/look-inside.js";
export { lookInside, returnToGlobe, shown, toForest } from "./look-inside/view-state.js";
export type { CoreViewState, Shown } from "./look-inside/view-state.js";
export { globePoints } from "./shelves/positions.js";
export type { GlobePoint } from "./shelves/positions.js";
