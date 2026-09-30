// @storytree/knowledge-core: the knowledge inside the planet (the knowledge core story). It reads
// the library only through the change history its public API gives, and the agent link only
// through its activity log's lines.
export { knowledge } from "./ghosts/ghosts.js";
export type { Ghost, GhostEvidence, Knowledge } from "./ghosts/ghosts.js";
export { EMPTY_SHELF, LOOP_LABEL, underShelves } from "./shelves/shelves.js";
export type { Core, Loop, Placement, Shelf } from "./shelves/shelves.js";
export { NO_RECORDED_READS, ReadRecord } from "./reads/reads.js";
export type { AgentReplay, Jump, Lit, Replay } from "./reads/reads.js";
export { agentPaths, codeKey, codePathKey, curvePoint, fileStop, hopPoint, IN_VIEW, stepPoint, traversalTrails, glowAt, growthPlan, heldNotes, legend, lighting, tailSpan, trails, noteCard, noteTitle, windowView } from "./look-inside/look-inside.js";
export type { Card, TraversalStep, LegendEntry, Point, RosterEntry, Trail, Lighting, AgentPath, WindowView, CodePlaces, CodeState } from "./look-inside/look-inside.js";
export { globePoints, LOOSE_BALL_RADIUS, LOOSE_MIN_SEPARATION } from "./shelves/positions.js";
export { isStoryText } from "./shelves/story-text.js";
export type { GlobePoint } from "./shelves/positions.js";
