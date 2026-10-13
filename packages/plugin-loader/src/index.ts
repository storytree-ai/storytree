/** Capability 1 · Manifests. The plugin loader (ADR-1021): storytree's own story packages say in a manifest what they add, and a host mounts it. */
export { storyParts, type StoryPart } from "./manifests/manifests.js";
export { partsPlugin, type PartsPlugin } from "./compose/parts-plugin.js";
export { composeParts } from "./runtime/compose-parts.js";
