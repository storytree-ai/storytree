// Capability 1 · Knowledge under its shelves
export { knowledge } from "./ghosts/ghosts.js";
export type { Ghost, GhostEvidence, Knowledge } from "./ghosts/ghosts.js";
export { EMPTY_SHELF, LOOP_LABEL, underShelves } from "./shelves/shelves.js";
export type { Core, Loop, Placement, Shelf } from "./shelves/shelves.js";
export { NO_RECORDED_READS, ReadRecord } from "./reads/reads.js";
export type { AgentReplay, Jump, Lit, Replay } from "./reads/reads.js";
export { curvePoint, IN_VIEW, traversalTrails, growthPlan, heldNotes, legend, lighting, trails, noteCard, noteTitle, windowView } from "./look-inside/look-inside.js";
export type { Card, TraversalStep, LegendEntry, Point, RosterEntry, Trail, Lighting, WindowView, CodePlaces, WindowState } from "./look-inside/look-inside.js";
export { sheetLayout, sheetLit, sheetPoints, sheetRoots, sheetSteps, whole, type SheetHanging, type SheetLayout, type SheetPoint } from "./shelves/sheet.js";
export { noteMoments, noteShown } from "./shelves/growing.js";
export type { GlobePoint } from "./shelves/positions.js";
