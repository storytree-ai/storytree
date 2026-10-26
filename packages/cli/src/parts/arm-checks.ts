/**
 * Capability 1 · Front door. The arm checks its story packages contribute (experiments' arm switch, ADR-1064 D2), as
 * `#parts/armChecks` names them run unbundled: composed from the manifests of this package's dependencies by the plugin
 * loader (ADR-1021). The command line's bundle gets the same list from the loader's build plugin instead.
 */
import { composeParts } from "@storytree/plugin-loader";

import type { ArmCheck } from "../mount.js";

export default await composeParts<ArmCheck>(import.meta.url, "armChecks");
