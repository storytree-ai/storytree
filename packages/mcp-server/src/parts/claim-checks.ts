/**
 * Capability 6 · Agent tools. The claim checks the other stories contribute (ADR-1170 D2), as `#parts/claimChecks` names
 * them run unbundled: composed from the manifests of this package's dependencies by the plugin loader (ADR-1021). A
 * bundle gets the same list from the loader's build plugin instead, which answers `#parts/claimChecks` first.
 */
import { composeParts } from "@storytree/plugin-loader";

import type { ClaimCheck } from "../tools/server.js";

export default await composeParts<ClaimCheck>(import.meta.url, "claimChecks");
