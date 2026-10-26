/**
 * Capability 6 · Agent tools. The command families the other stories declare, as `#parts/verbs` names them run unbundled:
 * composed from the manifests of this package's dependencies by the plugin loader (ADR-1021), so a verb that declares a
 * tool is served from the part that owns it and goes when that part is switched off (ADR-1095). A bundle gets the same
 * list from the loader's build plugin instead, which answers `#parts/verbs` before this module is reached.
 */
import type { VerbFamily } from "@storytree/library/verbs";
import { composeParts } from "@storytree/plugin-loader";

import type { ToolContext } from "../tools/mount.js";

export default await composeParts<VerbFamily<ToolContext>>(import.meta.url, "verbs");
