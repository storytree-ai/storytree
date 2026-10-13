/**
 * Capability 6 · Agent tools. The other stories' tool parts, as `#parts/tools` names them run unbundled: composed from
 * the manifests of this package's dependencies by the plugin loader (ADR-1021). A bundle gets the same list from the
 * loader's build plugin instead, which answers `#parts/tools` before this module is reached.
 */
import { composeParts } from "@storytree/plugin-loader";

import type { ToolPart } from "../tools/server.js";

export default await composeParts<ToolPart>(import.meta.url, "tools");
