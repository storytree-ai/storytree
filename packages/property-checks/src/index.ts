/** Capability 1 · Writing a check: the package's one entry, with fast-check itself, the quick tier's seeds and the nightly run. */
export { default as fc } from "fast-check";
export { propertyCheck, type CheckIo, type CheckOptions, type Why } from "./check.js";
export { DEFAULT_SEEDS } from "./quick-tier.js";
export { findCheckFiles, runNightly, type NightlyOptions } from "./nightly.js";
