/**
 * Capability 3 · Surfaces. The canvases the stories name that are not the Surfaces menu's switches (a gear menu tab, a
 * dialog), as `#parts/namedSurfaces` names them run unbundled: composed from the manifests of this app's dependencies by
 * the plugin loader (ADR-1021). The app's bundle gets the same list from the loader's build plugin instead (build.mjs).
 */
import type { NamedSurface } from "@storytree/surface-feedback/naming";
import { composeParts } from "@storytree/plugin-loader";

export default await composeParts<NamedSurface>(import.meta.url, "namedSurfaces");
