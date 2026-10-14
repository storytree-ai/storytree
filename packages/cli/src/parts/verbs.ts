/**
 * Capability 1 · Front door. The command families its story packages declare (ADR-1033), as `#parts/verbs` names them
 * run unbundled: composed from the manifests of this package's dependencies by the plugin loader (ADR-1021). The
 * command line's bundle gets the same list from the loader's build plugin instead (src/bins/build.ts).
 */
import type { VerbFamily } from "@storytree/project-and-caller/verbs";
import type { SessionVerbContext } from "@storytree/session-management/verbs";
import { composeParts } from "@storytree/plugin-loader";

import type { CommandPlace } from "../mount.js";

export default await composeParts<VerbFamily<SessionVerbContext & CommandPlace>>(import.meta.url, "verbs");
