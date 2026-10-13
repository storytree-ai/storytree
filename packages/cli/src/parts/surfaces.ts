/**
 * Capability 1 · Front door. The app's surfaces, as `#parts/surfaces` names them run unbundled: composed from the
 * manifests of this package's dependencies by the plugin loader (ADR-1021). The command line's bundle gets the same list
 * from the loader's build plugin instead (src/bins/build.ts), which answers `#parts/surfaces` before this module is reached.
 */
import type { SurfaceDeclaration } from "@storytree/app";
import { composeParts } from "@storytree/plugin-loader";

export default await composeParts<SurfaceDeclaration>(import.meta.url, "surfaces");
