/**
 * Capability 1 · Front door. The project records its story packages contribute (ADR-1170 D2), as `#parts/projectRecords`
 * names them run unbundled: composed from the manifests of this package's dependencies by the plugin loader (ADR-1021).
 * The command line's bundle gets the same list from the loader's build plugin instead (src/bins/build.ts).
 */
import { composeParts } from "@storytree/plugin-loader";

import type { ProjectRecords } from "../mount.js";

export default await composeParts<ProjectRecords>(import.meta.url, "projectRecords");
