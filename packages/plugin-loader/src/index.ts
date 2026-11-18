// Capability 1 · Manifests
export { hostOf, isServiceRun, partsGraph, partsGraphOf, storyParts, storyServices, type FoundPackage, type PackageJson, type ServiceRun, type StoryPart, type StoryService } from "./manifests/manifests.js";
export { composeParts } from "./runtime/compose-parts.js";
export { PLUGIN_INTERFACE, pluginExport, pluginServices, recordKinds, standIn, type PluginService, type ServiceHost, type StandIns } from "./factory/factory.js";
export { CORE, mount, offSaid, partName, switchedOff, type Composition, type PartsGraph, type SwitchedOff } from "./switch/switch.js";
