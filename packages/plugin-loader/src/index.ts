/** Capability 1 · Manifests. The plugin loader (ADR-1021): storytree's own story packages say in a manifest what they add, and a host mounts it. */
export { hostOf, isServiceRun, partsGraph, storyParts, storyServices, type ServiceRun, type StoryPart, type StoryService } from "./manifests/manifests.js";
export { partsPlugin, type PartsPlugin } from "./compose/parts-plugin.js";
export { composeParts } from "./runtime/compose-parts.js";
export { PLUGIN_INTERFACE, pluginExport, pluginServices, recordKinds, standIn, type PluginService, type ServiceHost, type StandIns } from "./factory/factory.js";
export { CORE, mount, offSaid, partName, switchedOff, type Composition, type PartsGraph, type SwitchedOff } from "./switch/switch.js";
