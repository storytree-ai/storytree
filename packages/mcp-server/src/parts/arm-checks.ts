/**
 * Capability 6 · Agent tools. The arm checks the other stories contribute (experiments' arm switch, ADR-1064 D2), as
 * `#parts/armChecks` names them run unbundled: composed from the manifests of this package's dependencies by the plugin
 * loader (ADR-1021). A bundle gets the same list from the loader's build plugin instead, which answers `#parts/armChecks` first.
 */
import { composeParts } from "@storytree/plugin-loader";

import type { ArmCheck } from "../tools/server.js";

export default await composeParts<ArmCheck>(import.meta.url, "armChecks");
