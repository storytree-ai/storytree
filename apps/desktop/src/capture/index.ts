/**
 * The capture kit: what a renderer evidence capture imports instead of copying the last one's
 * harness. A fake bridge typed against the desktop app's StorytreeBridge, a launch that finds
 * Playwright and Chromium from this checkout on any machine, and seeded work states.
 */
export { fakeBridge } from "./fake-bridge.js";
export type { FakeBridge } from "./fake-bridge.js";
export { launch, launchPlan } from "./launch.js";
export type { LaunchPlan, Machine } from "./launch.js";
export { seedWorkStates } from "./seed.js";
