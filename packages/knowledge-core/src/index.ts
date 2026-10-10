// Capability 1 · Knowledge under its shelves. @storytree/knowledge-core: the knowledge inside the planet (the knowledge core story). It reads
// the library only through the change history its public API gives, and Session management only
// through its activity log's lines.
export { knowledge } from "./ghosts/ghosts.js";
export type { Ghost, GhostEvidence, Knowledge } from "./ghosts/ghosts.js";
export { EMPTY_SHELF, LOOP_LABEL, underShelves } from "./shelves/shelves.js";
export type { Core, Loop, Placement, Shelf } from "./shelves/shelves.js";
export { NO_RECORDED_READS, ReadRecord } from "./reads/reads.js";
export type { AgentReplay, Jump, Lit, Replay } from "./reads/reads.js";
export { codeKey, codePathKey, curvePoint, fileStop, hopPoint, IN_VIEW, stepPoint, traversalTrails, growthPlan, heldNotes, legend, lighting, trails, noteCard, noteTitle, windowView } from "./look-inside/look-inside.js";
export type { Card, TraversalStep, LegendEntry, Point, RosterEntry, Trail, Lighting, WindowView, CodePlaces, WindowState } from "./look-inside/look-inside.js";
export { globePoints, LOOSE_BALL_RADIUS, LOOSE_MIN_SEPARATION } from "./shelves/positions.js";
export { isStoryText } from "./shelves/story-text.js";
export { noteMoments, noteShown } from "./shelves/growing.js";
export type { GlobePoint } from "./shelves/positions.js";
