// Capability 17 · Friction
export { CaptureError, hasConcreteEvidence, recordFriction, recordResteer, reinforceFriction } from "./filing/capture.js";
export type { NewFriction, NewResteer, Reinforcement } from "./filing/capture.js";
export { DRAIN, frictionDrain, LEASE_MINUTES, leaseFriction, LOOKALIKE_DAYS, lookalikes, openFriction, route, RouteRefusal } from "./drain/drain.js";
export type { DrainOptions, Route, RouteOptions } from "./drain/drain.js";
