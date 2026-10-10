/**
 * Capability 2 · Storytree projects. The capture kit: what a renderer evidence capture imports instead of copying the last one's
 * harness. A fake bridge typed against the desktop app's StorytreeBridge, a launch that finds
 * Playwright and Chromium from this checkout on any machine, seeded work states, and an output
 * folder that leaves the committed evidence alone unless the run is named to re-take it.
 */
export { fakeBridge } from "./fake-bridge.js";
export type { FakeBridge } from "./fake-bridge.js";
export { launch, launchPlan, loadPlaywright } from "./launch.js";
export type { LaunchPlan, Machine } from "./launch.js";
export { captureOutput, outputFolder } from "./output.js";
export type { CaptureRun } from "./output.js";
export { seedWorkStates } from "./testing/seed.js";
export { runCapture, withCapture, settle } from "./runner.js";
export type { CaptureContext, CapturePage, CaptureSeed, CaptureView, SeededCaptureOptions } from "./runner.js";
export { buildCapture } from "./build.js";
export { captureSeed, seedFile } from "./seeds.js";
export type { CaptureSeedName } from "./seeds.js";
export { visibleGlobeTargets, zoomGlobe } from "./globe.js";
export type { GlobeTarget, GlobeTargets } from "./globe.js";
