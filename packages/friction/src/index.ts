// Capability 1 · Filing. @storytree/friction: filing friction and re-steers, the drain a landing's pass judges, and routing
// each report to its remedy (the Friction story, ADR-1077 D1). It reaches the library only through its public API.
export { CaptureError, hasConcreteEvidence, recordFriction, recordResteer, reinforceFriction } from "./filing/capture.js";
export type { NewFriction, NewResteer, Reinforcement } from "./filing/capture.js";
export { DRAIN, frictionDrain, LEASE_MINUTES, leaseFriction, openFriction, route, RouteRefusal } from "./drain/drain.js";
export type { DrainOptions, Route, RouteOptions } from "./drain/drain.js";
