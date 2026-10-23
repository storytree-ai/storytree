/**
 * Capability 3 · Surfaces. The canvases the stories name that are not the Surfaces menu's switches (a gear menu tab, a
 * dialog), as `#parts/namedSurfaces` names them run unbundled: composed from the manifests of this app's dependencies by
 * the plugin loader (ADR-1021). The app's bundle gets the same list from the loader's build plugin instead (build.mjs).
 */
import { composeParts } from "@storytree/plugin-loader";

/** A named canvas as a manifest declares it: the frame's own copy of the fields it reads (ADR-1017 D2). */
export interface NamedSurface {
  readonly id: string;
  readonly name: string;
}

export default await composeParts<NamedSurface>(import.meta.url, "namedSurfaces");
